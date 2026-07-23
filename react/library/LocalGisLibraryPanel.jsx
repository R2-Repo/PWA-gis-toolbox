import { useCallback, useEffect, useState } from 'react';
import bus from '../../js/core/event-bus.js';
import {
    formatBytes,
    isGisLibraryAvailable,
    listGisLibraryItems,
    openGisLibrary,
    readGisLibraryPreview,
    removeGisLibraryItem
} from '../../js/library/gis-library.js';
import { getPlatformBundle } from '../../js/platform/create-platform.js';

/**
 * Desktop-only Local GIS Library list (GIS workspace — not Atlas).
 */
export function LocalGisLibraryPanel({ onAddPreviewToMap, showToast }) {
    const [available, setAvailable] = useState(() => isGisLibraryAvailable());
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState(null);

    const refresh = useCallback(async () => {
        if (!isGisLibraryAvailable()) {
            setAvailable(false);
            setItems([]);
            return;
        }
        setAvailable(true);
        setLoading(true);
        setError('');
        try {
            await openGisLibrary();
            setItems(await listGisLibraryItems());
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

    const onOpenFolder = useCallback(async () => {
        try {
            const { services } = getPlatformBundle();
            await services.gisCatalog?.openLibraryFolder?.();
        } catch (err) {
            showToast?.(err?.message || 'Could not open library folder', 'error');
        }
    }, [showToast]);

    const onAddToMap = useCallback(async (item) => {
        if (!item?.id || !onAddPreviewToMap) return;
        setBusyId(item.id);
        try {
            const result = await readGisLibraryPreview(item.id);
            if (!result?.geojson) throw new Error('No preview available');
            await onAddPreviewToMap(result.item, result.geojson);
            showToast?.(`Added preview: ${item.displayName}`, 'success');
        } catch (err) {
            showToast?.(err?.message || 'Failed to add preview', 'error');
        } finally {
            setBusyId(null);
        }
    }, [onAddPreviewToMap, showToast]);

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
            </div>
            {error ? <p className="gis-library-error text-sm">{error}</p> : null}
            {loading && !items.length ? <p className="text-sm text-muted">Loading library…</p> : null}
            {!loading && !items.length && !error ? (
                <p className="text-sm text-muted">
                    No library items yet. Drag a large GeoJSON from Explorer to import a preview and save it here.
                </p>
            ) : null}
            <ul className="gis-library-list">
                {items.map((item) => {
                    const count = item.featureCount != null
                        ? Number(item.featureCount).toLocaleString()
                        : '—';
                    const sampled = item.sampledFeatureCount != null
                        ? Number(item.sampledFeatureCount).toLocaleString()
                        : null;
                    const busy = busyId === item.id;
                    return (
                        <li key={item.id} className="gis-library-card">
                            <div className="gis-library-card-main">
                                <div className="gis-library-card-title" title={item.displayName}>
                                    {item.displayName}
                                </div>
                                <div className="gis-library-card-meta text-sm text-muted">
                                    {item.format || 'vector'}
                                    {' · '}
                                    {item.previewOnly && sampled
                                        ? `preview ${sampled} of ${count}`
                                        : `${count} features`}
                                    {item.byteSize != null ? ` · ${formatBytes(item.byteSize)}` : ''}
                                </div>
                            </div>
                            <div className="gis-library-card-actions">
                                <button
                                    type="button"
                                    className="btn btn-sm btn-primary"
                                    disabled={busy || !item.previewPath}
                                    onClick={() => void onAddToMap(item)}
                                >
                                    Add to map
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
