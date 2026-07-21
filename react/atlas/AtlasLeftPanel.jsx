import { useEffect, useMemo, useState } from 'react';
import bus from '../../js/core/event-bus.js';
import { getAtlasSnapshot } from '../../js/atlas/store.js';
import { searchAtlas } from '../../js/atlas/search.js';
import { buildHierarchyTree } from '../../js/atlas/hierarchy.js';
import { formatPingWhen, isPingStale } from '../../js/atlas/ping-format.js';
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
    const [open, setOpen] = useState(depth < 2 || inPath);

    useEffect(() => {
        if (inPath) setOpen(true);
    }, [inPath, selection?.id, selection?.kind]);

    const hasKids = node.children?.length > 0;
    return (
        <div className="atlas-tree-node" style={{ marginLeft: depth * 10 }}>
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
                    onClick={() => {
                        if (node.kind !== 'region') onSelect?.({ kind: node.kind, id: node.id });
                    }}
                >
                    <PingDot status={node.pingStatus} />
                    {node.label}
                    {node.meta ? <span className="atlas-muted"> · {node.meta}</span> : null}
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

export function AtlasLeftPanel({ onSelect, onOpenImport }) {
    const [tick, setTick] = useState(0);
    const [query, setQuery] = useState('');

    useEffect(() => {
        const unsub = [
            bus.on('atlas:changed', () => setTick((t) => t + 1)),
            bus.on('atlas:selection', () => setTick((t) => t + 1)),
            bus.on('atlas:ping', () => setTick((t) => t + 1))
        ];
        return () => unsub.forEach((u) => u?.());
    }, []);

    const snap = useMemo(() => getAtlasSnapshot(), [tick]);
    const hits = useMemo(() => searchAtlas(query), [query, tick]);
    const tree = useMemo(() => buildHierarchyTree(), [tick]);
    const selection = snap.selection;

    return (
        <div className="atlas-panel atlas-panel-left">
            <div className="atlas-toolbar">
                <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenImport}>
                    Import data
                </button>
                <span className="atlas-muted atlas-stat">
                    {snap.loaded
                        ? `${snap.channels.length} ch · ${snap.drops.length} drops`
                        : 'Not loaded'}
                </span>
            </div>
            {snap.lastImport && (
                <div
                    className={`atlas-freshness-banner${
                        isPingStale(snap.lastImport.importedAt, 168) ? ' atlas-freshness-banner--stale' : ''
                    }`}
                >
                    <strong>Last import</strong>
                    <span>
                        {snap.lastImport.workbookName || 'workbook'}
                        {snap.lastImport.atmsName ? ` + ${snap.lastImport.atmsName}` : ''}
                    </span>
                    <span className="atlas-muted">
                        {snap.lastImport.batchDate || formatPingWhen(snap.lastImport.importedAt)}
                        {snap.lastImport.importedAt ? ` · ${formatPingWhen(snap.lastImport.importedAt)}` : ''}
                    </span>
                    {isPingStale(snap.lastImport.importedAt, 168) ? (
                        <span className="atlas-stale-warn">Older than 7 days — consider re-importing.</span>
                    ) : null}
                </div>
            )}

            <CollapsibleSection title="Search" bodyId="atlas-search">
                <input
                    type="search"
                    className="input-sm atlas-search-input"
                    placeholder="Channel, hub, site, IP, drop…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <ul className="atlas-search-results">
                    {hits.map((h) => {
                        const selected = selection?.kind === h.kind && selection?.id === h.id;
                        return (
                            <li key={`${h.kind}-${h.id}`} className={selected ? 'atlas-search-hit--selected' : ''}>
                                <button type="button" onClick={() => onSelect?.(h)}>
                                    <PingDot status={h.pingStatus} />
                                    <strong>{h.label}</strong>
                                    {h.meta ? <span className="atlas-muted"> — {h.meta}</span> : null}
                                </button>
                            </li>
                        );
                    })}
                    {query && !hits.length && <li className="atlas-muted">No matches</li>}
                </ul>
            </CollapsibleSection>

            <CollapsibleSection title="Hierarchy" bodyId="atlas-hierarchy">
                {tree.map((node) => (
                    <HierarchyNode
                        key={node.id}
                        node={node}
                        depth={0}
                        onSelect={onSelect}
                        selection={selection}
                    />
                ))}
                {!snap.hubs.length && !snap.channels.length && (
                    <p className="atlas-muted">Import FiberSwitchLocation + ATMS to populate the tree.</p>
                )}
            </CollapsibleSection>
        </div>
    );
}
