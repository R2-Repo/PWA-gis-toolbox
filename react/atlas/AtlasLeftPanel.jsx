import { useEffect, useMemo, useState } from 'react';
import bus from '../../js/core/event-bus.js';
import { getAtlasSnapshot } from '../../js/atlas/store.js';
import { searchAtlas } from '../../js/atlas/search.js';
import { buildHierarchyTree } from '../../js/atlas/hierarchy.js';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';

function HierarchyNode({ node, depth, onSelect }) {
    const [open, setOpen] = useState(depth < 2);
    const hasKids = node.children?.length > 0;
    return (
        <div className="atlas-tree-node" style={{ marginLeft: depth * 10 }}>
            <div className="atlas-tree-row">
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
                    {node.label}
                    {node.meta ? <span className="atlas-muted"> · {node.meta}</span> : null}
                </button>
            </div>
            {open && hasKids && node.children.map((child) => (
                <HierarchyNode key={child.id} node={child} depth={depth + 1} onSelect={onSelect} />
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

            <CollapsibleSection title="Search" bodyId="atlas-search">
                <input
                    type="search"
                    className="input-sm atlas-search-input"
                    placeholder="Channel, hub, site, IP, drop…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <ul className="atlas-search-results">
                    {hits.map((h) => (
                        <li key={`${h.kind}-${h.id}`}>
                            <button type="button" onClick={() => onSelect?.(h)}>
                                <strong>{h.label}</strong>
                                {h.meta ? <span className="atlas-muted"> — {h.meta}</span> : null}
                            </button>
                        </li>
                    ))}
                    {query && !hits.length && <li className="atlas-muted">No matches</li>}
                </ul>
            </CollapsibleSection>

            <CollapsibleSection title="Hierarchy" bodyId="atlas-hierarchy">
                {tree.map((node) => (
                    <HierarchyNode key={node.id} node={node} depth={0} onSelect={onSelect} />
                ))}
                {!snap.hubs.length && !snap.channels.length && (
                    <p className="atlas-muted">Import FiberSwitchLocation + ATMS to populate the tree.</p>
                )}
            </CollapsibleSection>
        </div>
    );
}
