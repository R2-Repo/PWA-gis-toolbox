/**
 * Post box-select actions: menu items + handlers (new layer, clip, copy/move, export).
 */
import bus from '../core/event-bus.js';
import { createSpatialDataset, analyzeSchema, isSpatialLayer, isAnalyzableLayer, isWorkspaceLayer } from '../core/data-model.js';
import { getAvailableFormats, exportDataset } from '../export/exporter.js';
import { getWorkspaceFeaturesByIndices } from '../workspace/workspace-store.js';
import { bboxClipFeatures } from './gis-tools.js';
import { saveSnapshot } from '../dataprep/transform-history.js';

/**
 * @param {object} feature
 * @returns {object}
 */
export function stripInternalFeatureProps(feature) {
    if (!feature) return feature;
    const props = {};
    for (const [k, v] of Object.entries(feature.properties || {})) {
        if (!k.startsWith('_')) props[k] = v;
    }
    return {
        type: 'Feature',
        geometry: feature.geometry,
        properties: props
    };
}

/**
 * @param {object} layer
 * @param {number[]} indices
 * @returns {object[]}
 */
export function featuresFromSelection(layer, indices = []) {
    const wanted = new Set((indices || []).map(Number).filter(Number.isFinite));
    if (!wanted.size) return [];
    return (layer?.geojson?.features || [])
        .filter((f, i) => {
            const idx = Number(f.properties?._featureIndex);
            return wanted.has(Number.isFinite(idx) ? idx : i);
        })
        .map(stripInternalFeatureProps);
}

/**
 * Store-aware selection resolution. Workspace layers (viewport/tiled display)
 * keep only a partial — or, when tiled, empty — geojson packet in memory, so
 * selected features must be loaded from IndexedDB by their _featureIndex.
 * @param {object} layer
 * @param {number[]} indices
 * @returns {Promise<object[]>} stripped selected features
 */
export async function resolveSelectionFeatures(layer, indices = []) {
    if (isWorkspaceLayer(layer)) {
        const layerId = layer.workspaceLayerId || layer.id;
        const features = await getWorkspaceFeaturesByIndices(layerId, indices, { includeCold: true });
        return features.map(stripInternalFeatureProps);
    }
    return featuresFromSelection(layer, indices);
}

/**
 * @param {object} layer
 * @param {number[]} indices
 * @returns {object[]} remaining features (original objects, not stripped)
 */
export function remainingFeaturesAfterSelection(layer, indices = []) {
    const wanted = new Set((indices || []).map(Number).filter(Number.isFinite));
    return (layer?.geojson?.features || []).filter((f, i) => {
        const idx = Number(f.properties?._featureIndex);
        return !wanted.has(Number.isFinite(idx) ? idx : i);
    });
}

/**
 * @param {object} layer
 * @returns {boolean}
 */
export function layerHasLineGeometry(layer) {
    const gt = layer?.schema?.geometryType || '';
    if (gt === 'LineString' || gt === 'MultiLineString') return true;
    return (layer?.geojson?.features || []).some((f) => {
        const t = f?.geometry?.type;
        return t === 'LineString' || t === 'MultiLineString';
    });
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isCopyableAttributeValue(value) {
    if (value == null || value === '') return false;
    if (typeof value === 'object') return false; // skip objects + arrays
    return true;
}

/**
 * Field names available to copy from selected features (schema first, then property union).
 * @param {object} layer
 * @param {number[]} [indices]
 * @returns {string[]}
 */
export function attributeFieldsFromSelection(layer, indices = []) {
    const names = [];
    const seen = new Set();

    const add = (name) => {
        if (!name || typeof name !== 'string' || name.startsWith('_') || seen.has(name)) return;
        seen.add(name);
        names.push(name);
    };

    for (const field of layer?.schema?.fields || []) {
        add(field?.name || field?.outputName);
    }

    const features = featuresFromSelection(layer, indices);
    for (const f of features) {
        for (const key of Object.keys(f.properties || {})) add(key);
    }

    return names;
}

/**
 * Collect scalar attribute values in selection order (skips empty / object / array).
 * @param {object} layer
 * @param {number[]} indices
 * @param {string} fieldName
 * @returns {string[]}
 */
export function attributeValuesFromSelection(layer, indices = [], fieldName) {
    if (!fieldName) return [];
    const features = layer?.geojson?.features || [];
    const byIndex = new Map();
    features.forEach((f, i) => {
        const raw = Number(f.properties?._featureIndex);
        const key = Number.isFinite(raw) ? raw : i;
        byIndex.set(key, f);
    });

    const values = [];
    for (const raw of indices) {
        const idx = Number(raw);
        if (!Number.isFinite(idx)) continue;
        const feature = byIndex.get(idx) ?? features[idx];
        const value = feature?.properties?.[fieldName];
        if (!isCopyableAttributeValue(value)) continue;
        values.push(String(value));
    }
    return values;
}

/**
 * @param {object[]} deps
 */
export function buildSelectionActionItems(deps) {
    const {
        layer,
        count,
        bbox,
        formats = [],
        targetLayers = [],
        attributeFields = null,
        onInvert,
        onDelete,
        onNewLayer,
        onClip,
        onBulkEdit,
        onExport,
        onCopyAttribute,
        onCopyToLayer,
        onMoveToLayer,
        onPlaceImportFence,
        onClear,
        extraItems = []
    } = deps;

    const hasSelection = !!(layer && count > 0);
    const hasFenceAction = Array.isArray(bbox) && bbox.length >= 4 && typeof onPlaceImportFence === 'function';
    if (!hasSelection && !hasFenceAction) {
        return { items: [], layerName: layer?.name || null, count: 0 };
    }

    const items = [];

    if (hasSelection) {
        if (Array.isArray(extraItems) && extraItems.length) {
            items.push(...extraItems);
        }
        items.push(
            {
                label: 'Invert selection',
                icon: '🔄',
                action: () => onInvert?.()
            },
            {
                label: 'Delete selected',
                icon: '🗑',
                action: () => onDelete?.()
            },
            {
                label: 'New layer from selected',
                icon: '📄',
                action: () => onNewLayer?.()
            }
        );

        if (layerHasLineGeometry(layer) && Array.isArray(bbox) && bbox.length >= 4) {
            items.push({
                label: 'Clip selected (lines)',
                icon: '✂',
                title: 'Clip selected lines to the selection box and create a new layer',
                action: () => onClip?.()
            });
        }

        items.push({
            label: 'Bulk edit attributes',
            icon: '✎',
            action: () => onBulkEdit?.()
        });

        const fields = Array.isArray(attributeFields)
            ? attributeFields
            : attributeFieldsFromSelection(layer);
        if (fields.length && onCopyAttribute) {
            items.push({
                label: 'Copy attribute to clipboard',
                icon: '📋',
                title: 'Copy one field from selected features as a newline-separated list',
                children: fields.map((fieldName) => ({
                    label: fieldName,
                    icon: '📄',
                    action: () => onCopyAttribute?.(fieldName)
                }))
            });
        }

        if (formats.length) {
            items.push({
                label: 'Export selected',
                icon: '⬇',
                children: formats.map((fmt) => ({
                    label: fmt.label,
                    icon: '💾',
                    action: () => onExport?.(fmt.key)
                }))
            });
        }

        const editableTargets = targetLayers.filter((l) => l.id !== layer.id && isSpatialLayer(l) && l.type === 'spatial');
        if (editableTargets.length) {
            items.push({
                label: 'Copy to existing layer',
                icon: '📋',
                title: 'Duplicate selected features into another layer (keep on this layer)',
                children: editableTargets.map((t) => ({
                    label: t.name,
                    icon: '＋',
                    action: () => onCopyToLayer?.(t.id)
                }))
            });
            items.push({
                label: 'Move to existing layer',
                icon: '➜',
                title: 'Move selected features into another layer (remove from this layer)',
                children: editableTargets.map((t) => ({
                    label: t.name,
                    icon: '➜',
                    action: () => onMoveToLayer?.(t.id)
                }))
            });
        }
    }

    if (hasFenceAction) {
        items.push({
            label: 'Place import fence',
            icon: '⛶',
            title: 'Use this box as an import fence, then open Import',
            closeMenu: true,
            action: () => onPlaceImportFence(bbox)
        });
    }

    items.push({ sep: true });
    items.push({
        label: 'Clear selection',
        icon: '✕',
        title: 'Esc also clears',
        hint: 'Esc also clears',
        closeMenu: true,
        action: () => onClear?.()
    });

    return {
        items,
        layerName: hasSelection ? layer.name : 'Selection box',
        count: hasSelection ? count : 0
    };
}

/**
 * @param {object} ctx wiring from tool-handlers
 */
export function createSelectionActionHandlers(ctx) {
    const requireSelection = () => {
        const layer = ctx.getActiveLayer?.();
        if (!layer || !isAnalyzableLayer(layer)) {
            ctx.showToast?.('No active layer', 'warning');
            return null;
        }
        const indices = ctx.mapService.getSelectedIndices(layer.id) || [];
        if (!indices.length) {
            ctx.showToast?.('No features selected', 'warning');
            return null;
        }
        return { layer, indices };
    };

    return {
        invert() {
            const layer = ctx.getActiveLayer?.();
            if (!layer?.geojson) return;
            ctx.mapService.invertSelection(layer.id, layer.geojson);
        },

        async copyAttributeToClipboard(fieldName) {
            const sel = requireSelection();
            if (!sel) return;
            const values = attributeValuesFromSelection(sel.layer, sel.indices, fieldName);
            if (!values.length) {
                ctx.showToast?.(`No copyable values in "${fieldName}"`, 'warning');
                return;
            }
            const text = values.join('\n');
            try {
                if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    throw new Error('clipboard unavailable');
                }
                ctx.showToast?.(
                    `Copied ${values.length} value${values.length === 1 ? '' : 's'} from "${fieldName}"`,
                    'success'
                );
            } catch (err) {
                if (ctx.showErrorToast) ctx.showErrorToast(err);
                else ctx.showToast?.(text, 'info');
            }
        },

        async delete() {
            await ctx.deleteSelectedFeatures?.();
        },

        async newLayerFromSelected() {
            const sel = requireSelection();
            if (!sel) return;
            const features = await resolveSelectionFeatures(sel.layer, sel.indices);
            if (!features.length) {
                ctx.showToast?.('No features selected', 'warning');
                return;
            }
            const dataset = createSpatialDataset(
                `${sel.layer.name}_selection`,
                { type: 'FeatureCollection', features },
                { format: 'derived' }
            );
            ctx.addLayer(dataset);
            ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset), { fit: true });
            ctx.refreshUI?.();
            ctx.showToast?.(`Created layer with ${features.length} feature(s)`, 'success');
        },

        async clipSelectedToBox() {
            const sel = requireSelection();
            if (!sel) return;
            if (!layerHasLineGeometry(sel.layer)) {
                ctx.showToast?.('Clip selected works on line layers', 'warning');
                return;
            }
            const bbox = ctx.mapService.getLastSelectionBbox?.();
            if (!bbox) {
                ctx.showToast?.('No selection box available to clip against', 'warning');
                return;
            }
            const features = featuresFromSelection(sel.layer, sel.indices).filter((f) => {
                const t = f.geometry?.type;
                return t === 'LineString' || t === 'MultiLineString';
            });
            if (!features.length) {
                ctx.showToast?.('No selected line features to clip', 'warning');
                return;
            }
            const makeNew = await ctx.confirm?.(
                'Clip Selected',
                `Clip ${features.length} line feature(s) to the selection box and create a new layer?`
            );
            if (!makeNew) return;

            try {
                // Reuse source layer CRS / display-ready metadata; only swap feature set.
                const temp = {
                    ...sel.layer,
                    id: `${sel.layer.id}_clip_temp`,
                    name: sel.layer.name,
                    geojson: { type: 'FeatureCollection', features }
                };
                const result = await bboxClipFeatures(temp, bbox);
                if (!result?.geojson?.features?.length) {
                    ctx.showToast?.('Clip produced no geometry', 'warning');
                    return;
                }
                result.name = `${sel.layer.name}_clipped`;
                ctx.addLayer(result);
                ctx.mapService.addLayer(result, ctx.getLayers().indexOf(result), { fit: true });
                ctx.refreshUI?.();
                ctx.showToast?.(`Created clipped layer with ${result.geojson.features.length} feature(s)`, 'success');
            } catch (e) {
                ctx.showErrorToast?.(e) || ctx.showToast?.(e?.message || 'Clip failed', 'error');
            }
        },

        bulkEdit() {
            ctx.invokeAppAction?.('openBulkUpdate');
        },

        async exportSelected(format) {
            const sel = requireSelection();
            if (!sel) return;
            const features = await resolveSelectionFeatures(sel.layer, sel.indices);
            if (!features.length) {
                ctx.showToast?.('No features selected', 'warning');
                return;
            }
            const dataset = createSpatialDataset(
                `${sel.layer.name}_selection`,
                { type: 'FeatureCollection', features },
                { format: 'derived' }
            );
            try {
                let exportOptions = {};
                if (format === 'shapefile' && ctx.pickExportCrsModal) {
                    const picked = await ctx.pickExportCrsModal({
                        layerName: dataset.name,
                        defaultCrs: sel.layer.schema?.crs || 'EPSG:4326'
                    });
                    if (!picked) return;
                    exportOptions = { targetCrs: picked.targetCrs, sourceCrs: sel.layer.schema?.crs };
                }
                await exportDataset(dataset, format, exportOptions);
                ctx.showToast?.(`Exported ${features.length} selected feature(s)`, 'success');
            } catch (e) {
                ctx.showErrorToast?.(e) || ctx.showToast?.(e?.message || 'Export failed', 'error');
            }
        },

        copyToLayer(targetId) {
            const sel = requireSelection();
            if (!sel) return;
            const target = ctx.getLayers().find((l) => l.id === targetId);
            if (!target || target.type !== 'spatial') {
                ctx.showToast?.('Target layer not found', 'warning');
                return;
            }
            const features = featuresFromSelection(sel.layer, sel.indices);
            if (!features.length) return;
            saveSnapshot(target.id, `Copy ${features.length} feature(s)`, target.geojson);
            if (!target.geojson) target.geojson = { type: 'FeatureCollection', features: [] };
            target.geojson.features.push(...features);
            target.schema = analyzeSchema(target.geojson);
            bus.emit('layer:updated', target);
            bus.emit('layers:changed', ctx.getLayers());
            ctx.mapService.addLayer(target, ctx.getLayers().indexOf(target));
            ctx.refreshUI?.();
            ctx.showToast?.(`Copied ${features.length} feature(s) to "${target.name}"`, 'success');
        },

        moveToLayer(targetId) {
            const sel = requireSelection();
            if (!sel) return;
            if (sel.layer.type !== 'spatial') {
                ctx.showToast?.('Move is only available for editable spatial layers', 'warning');
                return;
            }
            const target = ctx.getLayers().find((l) => l.id === targetId);
            if (!target || target.type !== 'spatial') {
                ctx.showToast?.('Target layer not found', 'warning');
                return;
            }
            const features = featuresFromSelection(sel.layer, sel.indices);
            if (!features.length) return;

            saveSnapshot(sel.layer.id, `Move ${features.length} feature(s)`, sel.layer.geojson);
            saveSnapshot(target.id, `Receive ${features.length} feature(s)`, target.geojson);

            if (!target.geojson) target.geojson = { type: 'FeatureCollection', features: [] };
            target.geojson.features.push(...features);
            target.schema = analyzeSchema(target.geojson);

            sel.layer.geojson = {
                type: 'FeatureCollection',
                features: remainingFeaturesAfterSelection(sel.layer, sel.indices)
            };
            sel.layer.schema = analyzeSchema(sel.layer.geojson);

            bus.emit('layer:updated', target);
            bus.emit('layer:updated', sel.layer);
            bus.emit('layers:changed', ctx.getLayers());
            ctx.mapService.clearSelection(sel.layer.id);
            ctx.mapService.addLayer(target, ctx.getLayers().indexOf(target));
            ctx.mapService.addLayer(sel.layer, ctx.getLayers().indexOf(sel.layer));
            ctx.refreshUI?.();
            ctx.showToast?.(`Moved ${features.length} feature(s) to "${target.name}"`, 'success');
        },

        clear() {
            ctx.clearSelection?.();
        },

        getExportFormats(layer) {
            if (!layer) return [];
            return getAvailableFormats(layer).filter((f) => !String(f.key).startsWith('coverage'));
        }
    };
}
