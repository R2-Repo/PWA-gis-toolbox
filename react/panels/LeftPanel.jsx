import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    isSpatialLayer,
    isLiveVectorLayer,
    isServiceLayer,
    isWorkspaceLayer,
    getLayerFeatureCount
} from '../../js/core/data-model.js';
import { isLayerDisplayReady, layerCrsWarning } from '../../js/crs/layer-crs.js';
import { buildLayerPanelRows, isGroupFullyVisible, isGroupPartiallyVisible } from '../../js/core/layer-groups.js';
import { LayerDataToolsPanel } from './LayerDataToolsPanel.jsx';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';

function getDropIndex(clientY, itemElements) {
    for (let i = 0; i < itemElements.length; i++) {
        const rect = itemElements[i].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return i;
    }
    return Math.max(0, itemElements.length - 1);
}

function LayerItemRow({
    layer,
    idx,
    activeLayerId,
    selectedIds,
    draggingId,
    dragOverIndex,
    actions,
    onToggleSelected,
    onDragPointerDown,
    onDragPointerMove,
    onFinishDrag,
    nested = false
}) {
    const isActive = layer.id === activeLayerId;
    const isSelected = selectedIds.has(layer.id);
    const isDragging = layer.id === draggingId;
    const isDropTarget = dragOverIndex === idx && draggingId && draggingId !== layer.id;
    const isSpatial = isSpatialLayer(layer);
    const isLive = isLiveVectorLayer(layer);
    const isService = isServiceLayer(layer);
    const icon = isLive ? '🛰️' : isSpatial ? '🗺️' : isService ? '📡' : '📊';
    const count = isLive
        ? `${getLayerFeatureCount(layer).toLocaleString()} in view`
        : isSpatial
            ? `${getLayerFeatureCount(layer).toLocaleString()} features`
            : isService
                ? 'Live overlay'
                : `${getLayerFeatureCount(layer).toLocaleString()} rows`;
    const fieldCount = layer.schema?.fields?.length || 0;
    const geomType = layer.schema?.geometryType;
    const isVisible = layer.visible !== false;
    const isLocked = layer.locked === true;
    const outOfScale = layer._outOfScaleRange;
    const crsWarning = isSpatial && !isLayerDisplayReady(layer) ? layerCrsWarning(layer) : '';

    return (
        <div
            className={[
                'layer-item',
                nested ? 'layer-item-nested' : '',
                isActive ? 'active' : '',
                outOfScale ? 'layer-item-scale-hidden' : '',
                !isVisible ? 'layer-item-hidden' : '',
                isLocked ? 'layer-item-locked' : '',
                isDragging ? 'layer-item-dragging' : '',
                isDropTarget ? 'layer-item-drop-target' : ''
            ].filter(Boolean).join(' ')}
            data-id={layer.id}
            data-flat-index={idx}
            onClick={() => actions.setActiveLayer(layer.id)}
        >
            <button
                type="button"
                className="layer-drag-handle"
                title="Drag to reorder"
                aria-label="Drag to reorder layer"
                onPointerDown={(e) => onDragPointerDown(e, layer.id, idx)}
                onPointerMove={onDragPointerMove}
                onPointerUp={(e) => onFinishDrag(e, layer.id)}
                onPointerCancel={(e) => onFinishDrag(e, layer.id)}
            >
                <span aria-hidden>⋮⋮</span>
            </button>
            <input
                type="checkbox"
                className="layer-select-cb"
                checked={isSelected}
                aria-label={`Select ${layer.name}`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onToggleSelected(layer.id, e.target.checked)}
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
                    {layer._displayMode ? (
                        <button
                            type="button"
                            className={[
                                'layer-filter-badge',
                                'layer-display-mode-badge',
                                layer._displayMode.mode === 'tiled'
                                    ? 'layer-display-mode-tiled'
                                    : 'layer-display-mode-viewport'
                            ].join(' ')}
                            title={`${layer._displayMode.shortLabel} — click for details`}
                            aria-label={`${layer._displayMode.shortLabel}. More information about how this layer is drawn on the map.`}
                            onClick={(e) => {
                                e.stopPropagation();
                                actions.openLayerDisplayModeInfo?.(layer.id);
                            }}
                        >
                            {layer._displayMode.badge}
                            <span className="layer-display-mode-info" aria-hidden="true">i</span>
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className={['btn-icon', 'layer-lock-btn', isLocked ? 'layer-lock-btn-active' : ''].filter(Boolean).join(' ')}
                        title={isLocked ? 'Unlock layer (enable map interaction)' : 'Lock layer (reference only — no selection or popups)'}
                        onClick={(e) => {
                            e.stopPropagation();
                            actions.toggleLock(layer.id);
                        }}
                    >
                        {isLocked ? '🔒' : '🔓'}
                    </button>
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
}

export function LayerListPanel({
    layers = [],
    layerGroups = [],
    activeLayerId = null,
    actions
}) {
    const listRef = useRef(null);
    const dragRef = useRef(null);
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [draggingId, setDraggingId] = useState(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);
    const [draggingGroupId, setDraggingGroupId] = useState(null);

    const layerIdSet = useMemo(() => new Set(layers.map((layer) => layer.id)), [layers]);
    const panelRows = useMemo(() => buildLayerPanelRows(layers, layerGroups), [layers, layerGroups]);

    useEffect(() => {
        setSelectedIds((prev) => {
            const next = new Set([...prev].filter((id) => layerIdSet.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [layerIdSet]);

    const selectedCount = selectedIds.size;
    const allSelected = layers.length > 0 && selectedCount === layers.length;
    const canGroupSelection = selectedCount >= 2;

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

    const handleGroupSelected = useCallback(async () => {
        const ok = await actions.groupSelectedLayers([...selectedIds]);
        if (ok) setSelectedIds(new Set());
    }, [actions, selectedIds]);

    const handleDragPointerDown = useCallback((e, layerId, fromIndex) => {
        e.stopPropagation();
        e.preventDefault();
        dragRef.current = { kind: 'layer', layerId, fromIndex, overIndex: fromIndex, pointerId: e.pointerId };
        setDraggingId(layerId);
        setDraggingGroupId(null);
        setDragOverIndex(fromIndex);
        e.currentTarget.setPointerCapture(e.pointerId);
    }, []);

    const handleGroupDragPointerDown = useCallback((e, groupId, startIndex) => {
        e.stopPropagation();
        e.preventDefault();
        dragRef.current = { kind: 'group', groupId, fromIndex: startIndex, overIndex: startIndex, pointerId: e.pointerId };
        setDraggingGroupId(groupId);
        setDraggingId(null);
        setDragOverIndex(startIndex);
        e.currentTarget.setPointerCapture(e.pointerId);
    }, []);

    const handleDragPointerMove = useCallback((e) => {
        const drag = dragRef.current;
        if (!drag || e.pointerId !== drag.pointerId) return;
        const selector = drag.kind === 'group'
            ? '.layer-list-items > .layer-group > .layer-group-header, .layer-list-items > .layer-item'
            : '.layer-item';
        const items = listRef.current?.querySelectorAll(selector);
        if (!items?.length) return;
        const hoverIndex = getDropIndex(e.clientY, items);
        const targetEl = items[hoverIndex];
        const flatIndex = Number(targetEl?.dataset?.flatIndex ?? hoverIndex);
        drag.overIndex = flatIndex;
        setDragOverIndex(flatIndex);
    }, []);

    const finishDrag = useCallback((e) => {
        const drag = dragRef.current;
        if (!drag || e.pointerId !== drag.pointerId) return;
        const { kind, fromIndex, overIndex, layerId, groupId } = drag;
        dragRef.current = null;
        setDraggingId(null);
        setDraggingGroupId(null);
        setDragOverIndex(null);
        if (fromIndex !== overIndex) {
            if (kind === 'group') actions.moveGroupToIndex(groupId, overIndex);
            else actions.moveLayerToIndex(layerId, overIndex);
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
                    className="btn btn-sm btn-secondary"
                    disabled={!canGroupSelection}
                    onClick={handleGroupSelected}
                    title="Group selected layers"
                >
                    Group{canGroupSelection ? ` (${selectedCount})` : ''}
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
                {panelRows.map((row) => {
                    if (row.type === 'layer') {
                        return (
                            <LayerItemRow
                                key={row.layer.id}
                                layer={row.layer}
                                idx={row.index}
                                activeLayerId={activeLayerId}
                                selectedIds={selectedIds}
                                draggingId={draggingId}
                                dragOverIndex={dragOverIndex}
                                actions={actions}
                                onToggleSelected={toggleSelected}
                                onDragPointerDown={handleDragPointerDown}
                                onDragPointerMove={handleDragPointerMove}
                                onFinishDrag={finishDrag}
                            />
                        );
                    }

                    const { group, children, startIndex } = row;
                    const isDraggingGroup = draggingGroupId === group.id;
                    const isDropTarget = dragOverIndex === startIndex && draggingGroupId && draggingGroupId !== group.id;
                    const groupVisible = isGroupFullyVisible(group.id, layers);
                    const groupPartial = isGroupPartiallyVisible(group.id, layers);

                    return (
                        <div key={group.id} className="layer-group">
                            <div
                                className={[
                                    'layer-group-header',
                                    isDraggingGroup ? 'layer-item-dragging' : '',
                                    isDropTarget ? 'layer-item-drop-target' : ''
                                ].filter(Boolean).join(' ')}
                                data-group-id={group.id}
                                data-flat-index={startIndex}
                            >
                                <button
                                    type="button"
                                    className="layer-drag-handle"
                                    title="Drag to reorder group"
                                    aria-label="Drag to reorder group"
                                    onPointerDown={(e) => handleGroupDragPointerDown(e, group.id, startIndex)}
                                    onPointerMove={handleDragPointerMove}
                                    onPointerUp={finishDrag}
                                    onPointerCancel={finishDrag}
                                >
                                    <span aria-hidden>⋮⋮</span>
                                </button>
                                <button
                                    type="button"
                                    className={['layer-group-toggle', group.collapsed ? 'collapsed' : ''].filter(Boolean).join(' ')}
                                    title={group.collapsed ? 'Expand group' : 'Collapse group'}
                                    aria-expanded={!group.collapsed}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        actions.toggleGroupCollapsed(group.id);
                                    }}
                                >
                                    ▼
                                </button>
                                <span className="layer-group-icon" aria-hidden>📁</span>
                                <div className="layer-group-main">
                                    <div className="layer-name-row">
                                        <div
                                            className="layer-name layer-group-name"
                                            title={group.name}
                                            onDoubleClick={(e) => {
                                                e.stopPropagation();
                                                actions.renameLayerGroupInline(group.id, e.currentTarget);
                                            }}
                                        >
                                            {group.name}
                                        </div>
                                        <span className="layer-group-count badge badge-info">
                                            {children.length} layers
                                        </span>
                                        <button
                                            type="button"
                                            className="btn-icon layer-visibility-btn"
                                            title={groupVisible ? 'Hide all layers in group' : 'Show all layers in group'}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                actions.toggleGroupVisibility(group.id);
                                            }}
                                        >
                                            {groupVisible ? '👁️' : groupPartial ? '👁️‍🗨️' : '👁️‍🗨️'}
                                        </button>
                                    </div>
                                    <div className="layer-bottom-row">
                                        <div className="layer-meta layer-group-meta">
                                            {group.source === 'import' ? 'Imported together' : 'Layer group'}
                                        </div>
                                        <div className="layer-actions">
                                            <button
                                                type="button"
                                                className="btn-icon"
                                                title="Export group as KMZ"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    actions.exportLayerGroup(group.id, 'kmz');
                                                }}
                                            >
                                                📤
                                            </button>
                                            <button
                                                type="button"
                                                className="btn-icon"
                                                title="Ungroup"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    actions.dissolveLayerGroup(group.id);
                                                }}
                                            >
                                                📂
                                            </button>
                                            <button
                                                type="button"
                                                className={[
                                                    'btn-icon',
                                                    group.source === 'import' ? 'layer-group-delete-btn' : ''
                                                ].filter(Boolean).join(' ')}
                                                title={
                                                    group.source === 'import'
                                                        ? 'Delete import and all layers'
                                                        : 'Remove group and all layers'
                                                }
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    actions.removeLayerGroup(group.id);
                                                }}
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {!group.collapsed ? (
                                <div className="layer-group-children">
                                    {children.map((layer) => {
                                        const idx = layers.findIndex((entry) => entry.id === layer.id);
                                        return (
                                            <LayerItemRow
                                                key={layer.id}
                                                layer={layer}
                                                idx={idx}
                                                activeLayerId={activeLayerId}
                                                selectedIds={selectedIds}
                                                draggingId={draggingId}
                                                dragOverIndex={dragOverIndex}
                                                actions={actions}
                                                onToggleSelected={toggleSelected}
                                                onDragPointerDown={handleDragPointerDown}
                                                onDragPointerMove={handleDragPointerMove}
                                                onFinishDrag={finishDrag}
                                                nested
                                            />
                                        );
                                    })}
                                </div>
                            ) : null}
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
            {isWorkspaceLayer(activeLayer) && typeof actions.detachUnselectedFieldsForExport === 'function' && (
                <div style={{ marginBottom: 8 }}>
                    <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        title="Move unchecked fields to cold storage; export still includes them"
                        onClick={() => actions.detachUnselectedFieldsForExport()}
                    >
                        Detach for export
                    </button>
                </div>
            )}
            <div className="field-list-items">
                {filteredFields.map((field) => (
                    <div key={field.name} className="field-item" data-field={field.name}>
                        <input
                            type="checkbox"
                            checked={!!field.selected}
                            disabled={!!field.cold}
                            onChange={(e) => actions.toggleField(field.name, e.target.checked)}
                        />
                        <span
                            className="field-name"
                            title="Double-click to rename"
                            onDoubleClick={(e) => actions.renameFieldInline(field.name, e.currentTarget)}
                        >
                            {field.outputName || field.name}
                        </span>
                        <span className="field-type">{field.cold ? 'cold' : field.type}</span>
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
