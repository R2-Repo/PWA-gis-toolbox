import { useEffect, useMemo, useState } from 'react';
import bus from '../../js/core/event-bus.js';
import { getAtlasSnapshot } from '../../js/atlas/store.js';
import { searchAtlasDetailed } from '../../js/atlas/search.js';
import { buildHierarchyTree } from '../../js/atlas/hierarchy.js';
import { formatPingWhen } from '../../js/atlas/ping-format.js';
import { listAtlasImportBatches, reloadAtlasFromDb, runAtlasCutExtent, scanAtlasIpRange, setAtlasEditMode } from '../../js/atlas/controller.js';
import { AtlasMapLayersPanel } from './AtlasMapLayersPanel.jsx';
import {
    describeImportBatch,
    formatImportBatchCounts,
    formatImportBatchDiff
} from '../../js/atlas/import/batch-format.js';
import { showAtlasShortcutsHelp } from '../../js/atlas/hotkeys.js';
import { confirm } from '../../js/ui/modals.js';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';

function containsSelection(node, selection) {
    if (!selection || selection.kind === 'area') return false;
    if (node.kind === selection.kind && node.id === selection.id) return true;
    return (node.children || []).some((c) => containsSelection(c, selection));
}

function PingDot({ status }) {
    if (!status) return null;
    return (
        <span
            className={`atlas-ping-dot atlas-ping-dot--${status}`}
            title={status}
            aria-label={status}
        />
    );
}

function HierarchyNode({ node, depth, onSelect, selection }) {
    const isSelected = !!selection
        && selection.kind !== 'area'
        && node.kind === selection.kind
        && node.id === selection.id;
    const inPath = containsSelection(node, selection);
    // Collapsed by default; only auto-open ancestors of the current selection.
    const [open, setOpen] = useState(inPath);
    const secondary = node.secondary || node.meta || null;
    const title = node.title
        || [node.label, secondary].filter(Boolean).join(' · ')
        || node.label;

    useEffect(() => {
        if (inPath) setOpen(true);
    }, [inPath, selection?.id, selection?.kind]);

    const hasKids = node.children?.length > 0;
    return (
        <div className="atlas-tree-node" style={{ '--atlas-tree-depth': depth }}>
            <div className={`atlas-tree-row${isSelected ? ' atlas-tree-row--selected' : ''}`}>
                {hasKids ? (
                    <button type="button" className="atlas-tree-twist" onClick={() => setOpen((v) => !v)}>
                        {open ? '▾' : '▸'}
                    </button>
                ) : (
                    <span className="atlas-tree-twist spacer" />
                )}
                <button
                    type="button"
                    className="atlas-tree-label"
                    title={title}
                    onClick={() => {
                        // Regions are grouping-only (not selectable); toggle like the caret.
                        if (node.kind === 'region') {
                            if (hasKids) setOpen((v) => !v);
                            return;
                        }
                        onSelect?.({ kind: node.kind, id: node.id });
                    }}
                >
                    <PingDot status={node.pingStatus} />
                    <span className="atlas-tree-text">
                        <strong className="atlas-tree-primary">{node.label}</strong>
                        {secondary ? (
                            <span className="atlas-tree-secondary">{secondary}</span>
                        ) : null}
                    </span>
                </button>
            </div>
            {open && hasKids && node.children.map((child) => (
                <HierarchyNode
                    key={`${child.kind}-${child.id}`}
                    node={child}
                    depth={depth + 1}
                    onSelect={onSelect}
                    selection={selection}
                />
            ))}
        </div>
    );
}

export function AtlasLeftPanel({ onSelect, onOpenImport, onAddMapLayer, gisLayers, onReorderGisLayer, onToggleGisLayer }) {
    const [tick, setTick] = useState(0);
    const [query, setQuery] = useState('');
    const [reloadBusy, setReloadBusy] = useState(false);
    const [searchLimit, setSearchLimit] = useState(50);
    const [importBatches, setImportBatches] = useState([]);
    const [batchesBusy, setBatchesBusy] = useState(false);

    const refreshImportBatches = () => {
        setBatchesBusy(true);
        void listAtlasImportBatches({ limit: 50 })
            .then((rows) => setImportBatches(rows || []))
            .catch(() => setImportBatches([]))
            .finally(() => setBatchesBusy(false));
    };

    useEffect(() => {
        refreshImportBatches();
        const unsub = [
            bus.on('atlas:changed', () => {
                setTick((t) => t + 1);
                refreshImportBatches();
            }),
            bus.on('atlas:selection', () => setTick((t) => t + 1)),
            bus.on('atlas:ping', () => setTick((t) => t + 1)),
            bus.on('atlas:focus-search', () => {
                const el = document.getElementById('atlas-search-input');
                el?.focus?.();
                el?.select?.();
            }),
            bus.on('atlas:search-blur', () => {
                setQuery('');
            })
        ];
        return () => unsub.forEach((u) => u?.());
    }, []);

    const snap = useMemo(() => getAtlasSnapshot(), [tick]);
    const searchResult = useMemo(
        () => searchAtlasDetailed(query, searchLimit),
        [query, tick, searchLimit]
    );
    const hits = searchResult.hits;
    const tree = useMemo(() => buildHierarchyTree(), [tick]);
    const selection = snap.selection;
    const isEmptyDb = snap.loaded
        && !(snap.hubs?.length || snap.channels?.length || snap.drops?.length);

    return (
        <div className="atlas-panel atlas-panel-left">
            <div className="atlas-toolbar">
                <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenImport}>
                    {isEmptyDb ? 'Import data to begin' : 'Import data'}
                </button>
                <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!snap.loaded || reloadBusy}
                    title="Reload hubs/channels/drops/findings from SQLite"
                    onClick={() => {
                        const run = () => {
                            setReloadBusy(true);
                            void reloadAtlasFromDb({ forceStopMonitor: !!snap.activeSession })
                                .finally(() => setReloadBusy(false));
                        };
                        if (snap.activeSession) {
                            void confirm(
                                'Reload from database',
                                'An active monitor will be stopped first (no CSV export). Continue?'
                            ).then((ok) => {
                                if (ok) run();
                            });
                            return;
                        }
                        run();
                    }}
                >
                    {reloadBusy ? 'Reloading…' : 'Reload DB'}
                </button>
                <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Keyboard shortcuts (?)"
                    onClick={() => void showAtlasShortcutsHelp()}
                >
                    ?
                </button>
                <span className="atlas-muted atlas-stat">
                    {snap.loaded
                        ? `${snap.channels.length} ch · ${snap.drops.length} drops`
                        : 'Not loaded'}
                </span>
            </div>
            <CollapsibleSection title="Search" bodyId="atlas-search" defaultOpen>
                <input
                    id="atlas-search-input"
                    type="search"
                    className="input-sm atlas-search-input"
                    placeholder="Channel, hub, site, IP, drop… (press /)"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setSearchLimit(50);
                    }}
                />
                <ul className="atlas-search-results">
                    {hits.map((h) => {
                        const selected = selection?.kind === h.kind && selection?.id === h.id;
                        const secondary = h.secondary || h.meta || null;
                        const title = h.title || [h.label, secondary].filter(Boolean).join(' · ');
                        return (
                            <li key={`${h.kind}-${h.id}`} className={selected ? 'atlas-search-hit--selected' : ''}>
                                <button type="button" title={title} onClick={() => onSelect?.(h)}>
                                    <PingDot status={h.pingStatus} />
                                    <span className="atlas-search-hit-text">
                                        <strong>{h.label}</strong>
                                        {secondary ? <span className="atlas-muted">{secondary}</span> : null}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                    {query && !hits.length && <li className="atlas-muted">No matches</li>}
                </ul>
                {searchResult.truncated ? (
                    <div className="atlas-toolbar">
                        <span className="atlas-muted">
                            Showing first {searchResult.limit} matches
                        </span>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setSearchLimit((n) => n + 50)}
                        >
                            Show more
                        </button>
                    </div>
                ) : null}
            </CollapsibleSection>

            <AtlasMapLayersPanel
                gisLayers={gisLayers || []}
                onAddMapLayer={onAddMapLayer}
                onReorderGisLayer={onReorderGisLayer}
                onToggleGisLayer={onToggleGisLayer}
            />

            <CollapsibleSection title="Map edit" bodyId="atlas-edit-mode" defaultOpen={false}>
                <p className="atlas-muted">Enable to drag hub, drop, and building pins to new locations.</p>
                <button
                    type="button"
                    className={`btn btn-sm${getAtlasSnapshot().editMode ? ' btn-primary' : ' btn-secondary'}`}
                    onClick={() => setAtlasEditMode(!getAtlasSnapshot().editMode)}
                >
                    {getAtlasSnapshot().editMode ? 'Edit mode ON' : 'Edit mode OFF'}
                </button>
            </CollapsibleSection>

            <CollapsibleSection title="Network" bodyId="atlas-hierarchy">
                {isEmptyDb ? (
                    <div className="atlas-empty-cta">
                        <p><strong>No network data yet</strong></p>
                        <p className="atlas-muted">
                            Copy FiberSwitchLocation + ATMS into the Atlas import folder, then Import data.
                        </p>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenImport}>
                            Import data
                        </button>
                    </div>
                ) : (
                    tree.map((node) => (
                        <HierarchyNode
                            key={node.id}
                            node={node}
                            depth={0}
                            onSelect={onSelect}
                            selection={selection}
                        />
                    ))
                )}
            </CollapsibleSection>

            <CollapsibleSection title="Import history" bodyId="atlas-import-history" defaultOpen={false}>
                <p className="atlas-muted atlas-import-history-note">
                    Counts and diff from each Apply (not restorable). Network tables always reflect the latest Apply.
                </p>
                {!importBatches.length ? (
                    <p className="atlas-muted">
                        {batchesBusy ? 'Loading…' : 'No import batches yet.'}
                    </p>
                ) : (
                    <ul className="atlas-session-list">
                        {importBatches.map((batch) => {
                            const { title, files } = describeImportBatch(batch);
                            const isCurrent = batch.id === snap.lastImport?.id;
                            const countsLine = formatImportBatchCounts(batch);
                            const diffLine = formatImportBatchDiff(batch);
                            return (
                                <li key={batch.id} className="atlas-session-item">
                                    <div
                                        className={`atlas-session-row${isCurrent ? ' atlas-session-row--selected' : ''}`}
                                    >
                                        <strong>
                                            {title}
                                            {isCurrent ? <span className="atlas-tag"> current</span> : null}
                                        </strong>
                                        {files && files !== title ? (
                                            <span className="atlas-muted">{files}</span>
                                        ) : null}
                                        {countsLine ? <span>{countsLine}</span> : null}
                                        {diffLine ? <span className="atlas-muted">{diffLine}</span> : null}
                                        <span className="atlas-muted">
                                            {formatPingWhen(batch.importedAt)}
                                        </span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
                <div className="atlas-toolbar">
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={batchesBusy}
                        onClick={refreshImportBatches}
                    >
                        {batchesBusy ? 'Refreshing…' : 'Refresh'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenImport}>
                        Import data
                    </button>
                </div>
            </CollapsibleSection>
        </div>
    );
}
