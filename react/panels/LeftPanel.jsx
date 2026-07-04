import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSpatialLayer, getLayerFeatureCount } from '../../js/core/data-model.js';
import { isLayerDisplayReady, layerCrsWarning } from '../../js/crs/layer-crs.js';
import { LayerDataToolsPanel } from './LayerDataToolsPanel.jsx';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';

function getDropIndex(clientY, itemElements) {
    for (let i = 0; i < itemElements.length; i++) {
        const rect = itemElements[i].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return i;
    }
    return Math.max(0, itemElements.length - 1);
}

export function LayerListPanel({
    layers = [],
    activeLayerId = null,
    actions
}) {
    const listRef = useRef(null);
    const dragRef = useRef(null);
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [draggingId, setDraggingId] = useState(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);

    const layerIdSet = useMemo(() => new Set(layers.map((layer) => layer.id)), [layers]);

    useEffect(() => {
        setSelectedIds((prev) => {
            const next = new Set([...prev].filter((id) => layerIdSet.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [layerIdSet]);

    const selectedCount = selectedIds.size;
    const allSelected = layers.length > 0 && selectedCount === layers.length;

    const toggleSelected = useCallback((layerId, checked) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(layerId);
            else next.delete(layerId);
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        setSelectedIds(new Set(layers.map((layer) => layer.id)));
    }, [layers]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    const handleBulkDelete = useCallback(async () => {
        const ids = [...selectedIds];
        const removed = await actions.removeLayers(ids);
        if (removed) setSelectedIds(new Set());
    }, [actions, selectedIds]);

    const handleDragPointerDown = useCallback((e, layerId, fromIndex) => {
        e.stopPropagation();
        e.preventDefault();
        dragRef.current = { layerId, fromIndex, overIndex: fromIndex, pointerId: e.pointerId };
        setDraggingId(layerId);
        setDragOverIndex(fromIndex);
        e.currentTarget.setPointerCapture(e.pointerId);
    }, []);

    const handleDragPointerMove = useCallback((e) => {
        const drag = dragRef.current;
        if (!drag || e.pointerId !== drag.pointerId) return;
        const items = listRef.current?.querySelectorAll('.layer-item');
        if (!items?.length) return;
        const overIndex = getDropIndex(e.clientY, items);
        drag.overIndex = overIndex;
        setDragOverIndex(overIndex);
    }, []);

    const finishDrag = useCallback((e, layerId) => {
        const drag = dragRef.current;
        if (!drag || e.pointerId !== drag.pointerId) return;
        const { fromIndex, overIndex } = drag;
        dragRef.current = null;
        setDraggingId(null);
        setDragOverIndex(null);
        if (fromIndex !== overIndex) {
            actions.moveLayerToIndex(layerId, overIndex);
        }
    }, [actions]);

    if (!layers.length) {
        return (
            <div className="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.5 }}>
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                </svg>
                <p>No layers loaded. Import or drag and drop a file to start.</p>
            </div>
        );
    }

    return (
        <div className="layer-list">
            <div className="layer-bulk-toolbar">
                <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={allSelected ? clearSelection : selectAll}
                >
                    {allSelected ? 'Clear' : 'Select all'}
                </button>
                <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={selectedCount === 0}
                    onClick={handleBulkDelete}
                >
                    Delete{selectedCount > 0 ? ` (${selectedCount})` : ''}
                </button>
            </div>
            <div ref={listRef} className="layer-list-items">
                {layers.map((layer, idx) => {
                    const isActive = layer.id === activeLayerId;
                    const isSelected = selectedIds.has(layer.id);
                    const isDragging = layer.id === draggingId;
                    const isDropTarget = dragOverIndex === idx && draggingId && draggingId !== layer.id;
                    const isSpatial = isSpatialLayer(layer);
                    const icon = isSpatial ? '🗺️' : '📊';
                    const count = isSpatial
                        ? `${getLayerFeatureCount(layer).toLocaleString()} features`
                        : `${getLayerFeatureCount(layer).toLocaleString()} rows`;
                    const fieldCount = layer.schema?.fields?.length || 0;
                    const geomType = layer.schema?.geometryType;
                    const isVisible = layer.visible !== false;

                    const outOfScale = layer._outOfScaleRange;
                    const crsWarning = isSpatial && !isLayerDisplayReady(layer) ? layerCrsWarning(layer) : '';

                    return (
                        <div
                            key={layer.id}
                            className={[
                                'layer-item',
                                isActive ? 'active' : '',
                                outOfScale ? 'layer-item-scale-hidden' : '',
                                !isVisible ? 'layer-item-hidden' : '',
                                isDragging ? 'layer-item-dragging' : '',
                                isDropTarget ? 'layer-item-drop-target' : ''
                            ].filter(Boolean).join(' ')}
                            data-id={layer.id}
                            onClick={() => actions.setActiveLayer(layer.id)}
                        >
                            <button
                                type="button"
                                className="layer-drag-handle"
                                title="Drag to reorder"
                                aria-label="Drag to reorder layer"
                                onPointerDown={(e) => handleDragPointerDown(e, layer.id, idx)}
                                onPointerMove={handleDragPointerMove}
                                onPointerUp={(e) => finishDrag(e, layer.id)}
                                onPointerCancel={(e) => finishDrag(e, layer.id)}
                            >
                                <span aria-hidden>⋮⋮</span>
                            </button>
                            <input
                                type="checkbox"
                                className="layer-select-cb"
                                checked={isSelected}
                                aria-label={`Select ${layer.name}`}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => toggleSelected(layer.id, e.target.checked)}
                            />
                            <span className="layer-icon">{icon}</span>
                            <div className="layer-main">
                                <div className="layer-name-row">
                                    <div
                                        className="layer-name"
                                        title={layer.name}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            actions.renameLayerInline(layer.id, e.currentTarget);
                                        }}
                                    >
                                        {layer.name}
                                    </div>
                                    {layer._activeFilter ? (
                                        <span
                                            className="layer-filter-badge"
                                            title="Filter active – click to edit"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                actions.openFilterBuilder(layer.id);
                                            }}
                                        >
                                            FILTERED
                                        </span>
                                    ) : null}
                                    {layer.scaleRangeEnabled ? (
                                        <span
                                            className="layer-filter-badge layer-scale-badge"
                                            title={outOfScale ? 'Outside visible scale range at current zoom' : 'Scale range active'}
                                        >
                                            SCALE
                                        </span>
                                    ) : null}
                                    {crsWarning ? (
                                        <span
                                            className="layer-filter-badge layer-crs-badge"
                                            title={crsWarning}
                                        >
                                            CRS
                                        </span>
                                    ) : null}
                                    <button
                                        type="button"
                                        className="btn-icon layer-visibility-btn"
                                        title={isVisible ? 'Hide layer' : 'Show layer'}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            actions.toggleVisibility(layer.id);
                                        }}
                                    >
                                        {isVisible ? '👁️' : '👁️‍🗨️'}
                                    </button>
                                </div>
                                <div className="layer-bottom-row">
                                    <div className="layer-meta">
                                        {count} · {fieldCount} fields {geomType ? <span className="badge badge-info">{geomType}</span> : null}
                                    </div>
                                    <div className="layer-actions">
                                        <button
                                            type="button"
                                            className="btn-icon"
                                            title="Rename"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                actions.renameLayer(layer.id);
                                            }}
                                        >
                                            ✏️
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-icon"
                                            title="Zoom to layer"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                actions.zoomToLayer(layer.id);
                                            }}
                                        >
                                            🔍
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-icon"
                                            title="Remove"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                actions.removeLayer(layer.id);
                                            }}
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function FieldListPanel({
    activeLayer = null,
    fields = [],
    actions
}) {
    const [query, setQuery] = useState('');

    const filteredFields = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return fields;
        return fields.filter((field) => {
            const name = String(field.name || '').toLowerCase();
            const outputName = String(field.outputName || '').toLowerCase();
            return name.includes(q) || outputName.includes(q);
        });
    }, [fields, query]);

    if (!activeLayer) {
        return <div className="text-muted text-sm p-8">Select a layer to view fields</div>;
    }

    return (
        <>
            <div className="input-with-btn" style={{ marginBottom: 8 }}>
                <input
                    type="search"
                    id="field-search"
                    placeholder="Search fields..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <button className="btn btn-sm btn-secondary" onClick={() => actions.selectAllFields(true)}>All</button>
                <button className="btn btn-sm btn-secondary" onClick={() => actions.selectAllFields(false)}>None</button>
                <button className="btn btn-sm btn-primary" title="Add new field" onClick={() => actions.addField()}>+ Field</button>
            </div>
            <div className="field-list-items">
                {filteredFields.map((field) => (
                    <div key={field.name} className="field-item" data-field={field.name}>
                        <input
                            type="checkbox"
                            checked={!!field.selected}
                            onChange={(e) => actions.toggleField(field.name, e.target.checked)}
                        />
                        <span
                            className="field-name"
                            title="Double-click to rename"
                            onDoubleClick={(e) => actions.renameFieldInline(field.name, e.currentTarget)}
                        >
                            {field.outputName || field.name}
                        </span>
                        <span className="field-type">{field.type}</span>
                        <button
                            className="btn-icon"
                            style={{ fontSize: 10, padding: 2 }}
                            title="Rename field"
                            onClick={() => actions.renameField(field.name)}
                        >
                            ✏️
                        </button>
                    </div>
                ))}
            </div>
        </>
    );
}

export function DataPrepToolsPanel({ activeLayer = null, gisTools = null, hasLayers = false }) {
    return (
        <>
            <LayerDataToolsPanel activeLayer={activeLayer} hasLayers={hasLayers} />
            <CollapsibleSection title="GIS Tools" defaultOpen={false} expandWhen={hasLayers}>
                {gisTools}
            </CollapsibleSection>
        </>
    );
}
