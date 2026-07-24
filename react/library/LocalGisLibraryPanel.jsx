import { useCallback, useEffect, useMemo, useState } from 'react';
import bus from '../../js/core/event-bus.js';
import {
    exportGisLibraryPack,
    filterGisLibraryItems,
    formatBytes,
    generateGisLibraryPmTiles,
    getGisLibraryStorageStats,
    importGisLibraryPack,
    isGisLibraryAvailable,
    listGisLibraryItems,
    openGisLibrary,
    isGisLibraryRasterItem,
    optimizeGisLibraryItemToCog,
    optimizeGisLibraryItemToGeoParquet,
    readGisLibraryPreview,
    removeGisLibraryItem,
    updateGisLibraryMeta
} from '../../js/library/gis-library.js';
import { hasCapability } from '../../js/platform/contracts.js';
import { getPlatformBundle } from '../../js/platform/create-platform.js';

/**
 * Desktop-only Local GIS Library list (GIS workspace — not Atlas).
 */
export function LocalGisLibraryPanel({ onAddPreviewToMap, onAddItemToMap, showToast }) {
    const [available, setAvailable] = useState(() => isGisLibraryAvailable());
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [query, setQuery] = useState('');
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [folderFilter, setFolderFilter] = useState('');
    const [stats, setStats] = useState(null);

    const refresh = useCallback(async () => {
        if (!isGisLibraryAvailable()) {
            setAvailable(false);
            setItems([]);
            setStats(null);
            return;
        }
        setAvailable(true);
        setLoading(true);
        setError('');
        try {
            await openGisLibrary();
            setItems(await listGisLibraryItems());
            try {
                setStats(await getGisLibraryStorageStats());
            } catch {
                setStats(null);
            }
        } catch (err) {
            setError(err?.message || String(err));
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
        const unsub = bus.on('gis-library:changed', () => {
            void refresh();
        });
        return () => {
            unsub?.();
        };
    }, [refresh]);

    const folders = useMemo(() => {
        const set = new Set();
        for (const item of items) {
            if (item.folder) set.add(String(item.folder));
        }
        return [...set].sort((a, b) => a.localeCompare(b));
    }, [items]);

    const visible = useMemo(
        () => filterGisLibraryItems(items, {
            query,
            favoritesOnly,
            folder: folderFilter || undefined
        }),
        [items, query, favoritesOnly, folderFilter]
    );

    const onOpenFolder = useCallback(async () => {
        try {
            const { services } = getPlatformBundle();
            await services.gisCatalog?.openLibraryFolder?.();
        } catch (err) {
            showToast?.(err?.message || 'Could not open library folder', 'error');
        }
    }, [showToast]);

    const onImportPack = useCallback(async () => {
        try {
            const { services } = getPlatformBundle();
            const picked = await services.files?.open?.({
                title: 'Import GIS Library pack',
                filters: [{ name: 'GIS Pack', extensions: ['gispack', 'zip'] }]
            });
            if (picked?.canceled || !picked?.path) return;
            setLoading(true);
            const result = await importGisLibraryPack(picked.path);
            showToast?.(`Imported pack: ${result?.item?.displayName || 'item'}`, 'success');
            await refresh();
        } catch (err) {
            showToast?.(err?.message || 'Import pack failed', 'error');
        } finally {
            setLoading(false);
        }
    }, [refresh, showToast]);

    const onExportPack = useCallback(async (item) => {
        if (!item?.id) return;
        setBusyId(item.id);
        try {
            const { services } = getPlatformBundle();
            const safeName = String(item.displayName || 'library-item')
                .replace(/[^\w\-]+/g, '_')
                .slice(0, 60);
            const saved = await services.files?.save?.({
                title: 'Export GIS Library pack',
                defaultPath: `${safeName}.gispack`,
                filters: [{ name: 'GIS Pack', extensions: ['gispack'] }]
            });
            if (saved?.canceled || !saved?.path) return;
            const result = await exportGisLibraryPack(item.id, saved.path);
            showToast?.(
                `Exported pack (${formatBytes(result?.byteSize || 0)})`,
                'success'
            );
        } catch (err) {
            showToast?.(err?.message || 'Export pack failed', 'error');
        } finally {
            setBusyId(null);
        }
    }, [showToast]);

    const onAddToMap = useCallback(async (item) => {
        if (!item?.id) return;
        setBusyId(item.id);
        try {
            if (item.tilePath && onAddItemToMap) {
                await onAddItemToMap(item);
                showToast?.(`Added tiled layer: ${item.displayName}`, 'success');
            } else if (onAddPreviewToMap) {
                const result = await readGisLibraryPreview(item.id);
                if (!result?.geojson) throw new Error('No preview available');
                await onAddPreviewToMap(result.item, result.geojson);
                showToast?.(`Added preview: ${item.displayName}`, 'success');
            } else if (onAddItemToMap) {
                await onAddItemToMap(item);
                showToast?.(`Added: ${item.displayName}`, 'success');
            }
        } catch (err) {
            showToast?.(err?.message || 'Failed to add to map', 'error');
        } finally {
            setBusyId(null);
        }
    }, [onAddItemToMap, onAddPreviewToMap, showToast]);

    const onRemove = useCallback(async (item) => {
        if (!item?.id) return;
        if (!window.confirm(`Remove “${item.displayName}” from the Local GIS Library? Managed copies will be deleted.`)) {
            return;
        }
        setBusyId(item.id);
        try {
            await removeGisLibraryItem(item.id, { deleteFiles: true });
            showToast?.('Removed from library', 'info');
        } catch (err) {
            showToast?.(err?.message || 'Failed to remove item', 'error');
        } finally {
            setBusyId(null);
        }
    }, [showToast]);

    const canOptimize = (() => {
        const { platform } = getPlatformBundle();
        return hasCapability(platform, 'duckdb');
    })();
    const canOptimizeCog = (() => {
        const { platform } = getPlatformBundle();
        return hasCapability(platform, 'pythonCompute');
    })();

    const onOptimize = useCallback(async (item) => {
        if (!item?.id) return;
        setBusyId(item.id);
        try {
            await optimizeGisLibraryItemToGeoParquet(item);
            showToast?.(`Optimized ${item.displayName} → GeoParquet`, 'success');
            await refresh();
        } catch (err) {
            showToast?.(err?.message || 'Optimize failed', 'error');
        } finally {
            setBusyId(null);
        }
    }, [refresh, showToast]);

    const onOptimizeCog = useCallback(async (item) => {
        if (!item?.id) return;
        setBusyId(item.id);
        try {
            await optimizeGisLibraryItemToCog(item);
            showToast?.(`Optimized ${item.displayName} → COG`, 'success');
            await refresh();
        } catch (err) {
            showToast?.(err?.message || 'COG optimize failed', 'error');
        } finally {
            setBusyId(null);
        }
    }, [refresh, showToast]);

    const onCreateTiles = useCallback(async (item) => {
        if (!item?.id) return;
        setBusyId(item.id);
        try {
            await generateGisLibraryPmTiles(item);
            showToast?.(`Created PMTiles for ${item.displayName}`, 'success');
            await refresh();
        } catch (err) {
            showToast?.(err?.message || 'Create tiles failed', 'error');
        } finally {
            setBusyId(null);
        }
    }, [refresh, showToast]);

    const onToggleFavorite = useCallback(async (item) => {
        if (!item?.id) return;
        setBusyId(item.id);
        try {
            await updateGisLibraryMeta(item.id, { favorite: !item.favorite });
        } catch (err) {
            showToast?.(err?.message || 'Could not update favorite', 'error');
        } finally {
            setBusyId(null);
        }
    }, [showToast]);

    const onEditTags = useCallback(async (item) => {
        if (!item?.id) return;
        const current = Array.isArray(item.tags) ? item.tags.join(', ') : '';
        const next = window.prompt('Tags (comma-separated)', current);
        if (next == null) return;
        const tags = next
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 12);
        setBusyId(item.id);
        try {
            await updateGisLibraryMeta(item.id, { tags });
            showToast?.('Tags updated', 'success');
        } catch (err) {
            showToast?.(err?.message || 'Could not update tags', 'error');
        } finally {
            setBusyId(null);
        }
    }, [showToast]);

    const onEditFolder = useCallback(async (item) => {
        if (!item?.id) return;
        const next = window.prompt('Folder name (blank to clear)', item.folder || '');
        if (next == null) return;
        setBusyId(item.id);
        try {
            await updateGisLibraryMeta(item.id, { folder: next.trim() });
            showToast?.('Folder updated', 'success');
        } catch (err) {
            showToast?.(err?.message || 'Could not update folder', 'error');
        } finally {
            setBusyId(null);
        }
    }, [showToast]);

    if (!available) return null;

    return (
        <div className="gis-library-panel">
            <div className="gis-library-toolbar">
                <button type="button" className="btn btn-sm" onClick={() => void refresh()} disabled={loading}>
                    Refresh
                </button>
                <button type="button" className="btn btn-sm" onClick={() => void onOpenFolder()}>
                    Open folder
                </button>
                <button type="button" className="btn btn-sm" onClick={() => void onImportPack()} disabled={loading}>
                    Import pack
                </button>
            </div>

            {stats ? (
                <p className="gis-library-storage text-sm text-muted">
                    {stats.itemCount ?? 0} items
                    {stats.favoriteCount ? ` · ${stats.favoriteCount} ★` : ''}
                    {stats.totalBytes != null ? ` · ${formatBytes(stats.totalBytes)} on disk` : ''}
                </p>
            ) : null}

            <div className="gis-library-filters">
                <input
                    type="search"
                    className="gis-library-search"
                    placeholder="Search name, tag, folder…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <label className="gis-library-fav-filter">
                    <input
                        type="checkbox"
                        checked={favoritesOnly}
                        onChange={(e) => setFavoritesOnly(e.target.checked)}
                    />
                    Favorites
                </label>
                {folders.length ? (
                    <select
                        className="gis-library-folder-filter"
                        value={folderFilter}
                        onChange={(e) => setFolderFilter(e.target.value)}
                    >
                        <option value="">All folders</option>
                        {folders.map((f) => (
                            <option key={f} value={f}>{f}</option>
                        ))}
                    </select>
                ) : null}
            </div>

            {error ? <p className="gis-library-error text-sm">{error}</p> : null}
            {loading && !items.length ? <p className="text-sm text-muted">Loading library…</p> : null}
            {!loading && !items.length && !error ? (
                <p className="text-sm text-muted">
                    No library items yet. Drag a large GeoJSON from Explorer to import a preview and save it here.
                </p>
            ) : null}
            {!loading && items.length && !visible.length ? (
                <p className="text-sm text-muted">No items match this filter.</p>
            ) : null}

            <ul className="gis-library-list">
                {visible.map((item) => {
                    const count = item.featureCount != null
                        ? Number(item.featureCount).toLocaleString()
                        : '—';
                    const sampled = item.sampledFeatureCount != null
                        ? Number(item.sampledFeatureCount).toLocaleString()
                        : null;
                    const busy = busyId === item.id;
                    const tags = Array.isArray(item.tags) ? item.tags : [];
                    return (
                        <li key={item.id} className="gis-library-card">
                            <div className="gis-library-card-main">
                                <div className="gis-library-card-title" title={item.displayName}>
                                    <button
                                        type="button"
                                        className={`gis-library-star${item.favorite ? ' is-on' : ''}`}
                                        title={item.favorite ? 'Unfavorite' : 'Favorite'}
                                        disabled={busy}
                                        onClick={() => void onToggleFavorite(item)}
                                    >
                                        {item.favorite ? '★' : '☆'}
                                    </button>
                                    {item.displayName}
                                </div>
                                <div className="gis-library-card-meta text-sm text-muted">
                                    {item.folder ? `${item.folder} · ` : ''}
                                    {item.format || 'vector'}
                                    {' · '}
                                    {item.previewOnly && sampled
                                        ? `preview ${sampled} of ${count}`
                                        : `${count} features`}
                                    {item.byteSize != null ? ` · ${formatBytes(item.byteSize)}` : ''}
                                    {item.format === 'cog' || item.workingPath?.toLowerCase?.().includes('_cog')
                                        ? ' · COG'
                                        : item.workingPath
                                            ? ' · GeoParquet'
                                            : ''}
                                    {item.tilePath ? ' · PMTiles' : ''}
                                    {item.derivedOp ? ` · derived (${item.derivedOp})` : ''}
                                </div>
                                {tags.length ? (
                                    <div className="gis-library-tags">
                                        {tags.map((t) => (
                                            <span key={t} className="gis-library-tag">{t}</span>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                            <div className="gis-library-card-actions">
                                <button
                                    type="button"
                                    className="btn btn-sm btn-primary"
                                    disabled={busy || (!item.previewPath && !item.tilePath && !(item.format === 'cog' || item.workingPath))}
                                    onClick={() => void onAddToMap(item)}
                                >
                                    {item.tilePath ? 'Add tiles' : item.format === 'cog' ? 'Add COG' : 'Add to map'}
                                </button>
                                {!item.tilePath && !isGisLibraryRasterItem(item) ? (
                                    <button
                                        type="button"
                                        className="btn btn-sm"
                                        disabled={busy}
                                        onClick={() => void onCreateTiles(item)}
                                    >
                                        Create tiles
                                    </button>
                                ) : null}
                                {canOptimizeCog && isGisLibraryRasterItem(item) && item.format !== 'cog' ? (
                                    <button
                                        type="button"
                                        className="btn btn-sm"
                                        disabled={busy}
                                        onClick={() => void onOptimizeCog(item)}
                                    >
                                        Optimize to COG
                                    </button>
                                ) : null}
                                {canOptimize && !item.workingPath && !isGisLibraryRasterItem(item) ? (
                                    <button
                                        type="button"
                                        className="btn btn-sm"
                                        disabled={busy}
                                        onClick={() => void onOptimize(item)}
                                    >
                                        Optimize
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    className="btn btn-sm"
                                    disabled={busy}
                                    onClick={() => void onEditTags(item)}
                                >
                                    Tags
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-sm"
                                    disabled={busy}
                                    onClick={() => void onEditFolder(item)}
                                >
                                    Folder
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-sm"
                                    disabled={busy}
                                    onClick={() => void onExportPack(item)}
                                >
                                    Export pack
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-sm"
                                    disabled={busy}
                                    onClick={() => void onRemove(item)}
                                >
                                    Remove
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
