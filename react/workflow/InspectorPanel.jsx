import React, { useCallback, useEffect, useMemo, useState } from 'react';
import bus from '../../js/core/event-bus.js';
import { getNodeInspector } from './inspectors/index.js';
import { UNKNOWN_PLACEHOLDER_NODE_TYPE } from '../../js/workflow/nodes/unknown-placeholder-node.js';
function fieldTypeClass(type) {
    if (!type) return '';
    const t = type.toLowerCase();
    if (t === 'number' || t === 'integer' || t === 'float' || t === 'double') return 'wf-type-num';
    if (t === 'date' || t === 'datetime') return 'wf-type-date';
    if (t === 'boolean') return 'wf-type-bool';
    return 'wf-type-str';
}

function DataSummary({ node, engine, getLayers }) {
    const layersFn = useCallback(() => getLayers?.() || [], [getLayers]);

    const portData = useMemo(() => {
        return node.inputPorts.map((port) => {
            const data = engine.getUpstreamOutputForPort(node.id, port.id, { getLayers: layersFn })
                || engine.getUpstreamOutput(node.id, { getLayers: layersFn });
            return { port, data };
        });
    }, [node, engine, layersFn]);

    const hasAny = portData.some((pd) => pd.data?.schema);
    if (!hasAny) {
        return (
            <div className="wf-data-summary wf-data-empty">
                <div className="wf-data-summary-hint">⚡ Connect an input to see available fields</div>
            </div>
        );
    }

    return (
        <div className="wf-data-summary">
            {portData.map(({ port, data }) => {
                if (!data?.schema) return null;
                const schema = data.schema;
                const fields = schema.fields || [];
                const label = node.inputPorts.length > 1 ? port.label : 'Incoming Data';
                const isSpatial = data.type === 'spatial';
                const count = isSpatial
                    ? (data.geojson?.features?.length ?? schema.featureCount ?? '?')
                    : (data.rows?.length ?? schema.featureCount ?? '?');
                const countLabel = isSpatial ? 'features' : 'rows';
                const geomBadge = isSpatial && schema.geometryType
                    ? <span className="wf-schema-badge wf-schema-geom">{schema.geometryType}</span>
                    : null;

                return (
                    <details key={port.id} className="wf-data-section" open>
                        <summary className="wf-data-section-header">
                            <span>{label}</span>
                            <span className="wf-schema-meta">
                                {count} {countLabel} · {fields.length} fields {geomBadge}
                            </span>
                        </summary>
                        <div className="wf-schema-table-wrap">
                            <table className="wf-schema-table">
                                <thead>
                                    <tr><th>Field</th><th>Type</th><th>Sample</th></tr>
                                </thead>
                                <tbody>
                                    {fields.map((f) => {
                                        const samples = (f.sampleValues || []).slice(0, 3)
                                            .map((v) => (v == null ? 'null' : String(v)))
                                            .map((v) => (v.length > 20 ? `${v.slice(0, 18)}…` : v))
                                            .join(', ');
                                        return (
                                            <tr key={f.name}>
                                                <td className="wf-schema-fname">{f.name}</td>
                                                <td>
                                                    <span className={`wf-schema-type ${fieldTypeClass(f.type)}`}>
                                                        {f.type || '?'}
                                                    </span>
                                                </td>
                                                <td className="wf-schema-sample" title={samples}>
                                                    {samples || '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </details>
                );
            })}
        </div>
    );
}

export function InspectorPanel({ engine, getLayers, importFile }) {
    const [nodeId, setNodeId] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const node = nodeId ? engine.nodes.get(nodeId) : null;

    const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

    useEffect(() => {
        const unsubs = [
            bus.on('workflow:node-selected', ({ nodeId: id }) => setNodeId(id || null)),
            bus.on('workflow:node-inspect', ({ nodeId: id }) => setNodeId(id || null)),
            bus.on('workflow:node-deselected', () => setNodeId(null)),
            bus.on('workflow:node-data-ready', ({ nodeId: changedId }) => {
                if (!nodeId) return;
                if (changedId === nodeId || engine.isUpstreamOf(nodeId, changedId)) bumpRefresh();
            }),
            bus.on('workflow:wire-added', (wire) => {
                if (!nodeId) return;
                if (wire.to === nodeId || wire.from === nodeId) bumpRefresh();
            }),
            bus.on('workflow:wire-removed', (wire) => {
                if (!nodeId) return;
                if (wire.to === nodeId || wire.from === nodeId) bumpRefresh();
            })
        ];
        return () => unsubs.forEach((off) => { try { off(); } catch { /* noop */ } });
    }, [engine, nodeId, bumpRefresh]);

    const onConfigChange = useCallback((partial) => {
        if (!node) return;
        Object.assign(node.config, partial);
        bumpRefresh();
        bus.emit('workflow:engine-changed');
    }, [node, bumpRefresh]);

    const onCommentChange = useCallback((comment) => {
        if (!node) return;
        node.comment = comment;
        bus.emit('workflow:engine-changed');
    }, [node]);

    const onDelete = useCallback(() => {
        if (!nodeId) return;
        bus.emit('workflow:delete-node', { nodeId });
    }, [nodeId]);

    const InspectorComponent = node ? getNodeInspector(node.type) : null;
    const validation = node?.validate?.() || { valid: true, message: '' };

    // refreshKey forces re-validation after config changes
    void refreshKey;

    return (
        <div className="wf-inspector">
            <div className="wf-inspector-title">Node Configuration</div>
            <div className="wf-inspector-form">
                {!node ? (
                    <p className="wf-inspector-empty">Select a node to configure</p>
                ) : (
                    <>
                        <div className="wf-inspector-header">
                            <span className="wf-inspector-icon">{node.icon}</span>
                            <span className="wf-inspector-name">{node.name}</span>
                        </div>

                        <button
                            type="button"
                            className="wf-btn-sm wf-btn-danger"
                            style={{ marginBottom: 12 }}
                            onClick={onDelete}
                        >
                            🗑 Delete Node
                        </button>

                        {node.inputPorts.length > 0 && (
                            <DataSummary node={node} engine={engine} getLayers={getLayers} />
                        )}

                        <div className="wf-inspector-config">
                            {node.type === UNKNOWN_PLACEHOLDER_NODE_TYPE ? (
                                <p className="wf-val-warn">
                                    This node type (
                                    {node.config?.originalType || 'unknown'}
                                    ) is not available in this app. Replace it from the palette or delete it.
                                    Wires are preserved; running this branch will fail.
                                </p>
                            ) : InspectorComponent ? (
                                <InspectorComponent
                                    node={node}
                                    config={node.config}
                                    onConfigChange={onConfigChange}
                                    engine={engine}
                                    getLayers={getLayers}
                                    importFile={importFile}
                                />
                            ) : (
                                <p style={{ color: 'var(--text-muted)' }}>No configuration needed.</p>
                            )}
                        </div>

                        <div className="wf-inspector-validation">
                            {!validation.valid && (
                                <span className="wf-val-warn">⚠ {validation.message}</span>
                            )}
                        </div>

                        <div className="wf-inspector-comment">
                            <label className="wf-inspector-label">Comment</label>
                            <textarea
                                className="wf-inspector-comment-input"
                                placeholder="Add a note about this node…"
                                rows={3}
                                value={node.comment || ''}
                                onChange={(e) => onCommentChange(e.target.value)}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
