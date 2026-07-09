/**
 * Import / manual layer groups — visual organization only.
 * Groups are NOT map layers; child layers remain real datasets in state.layers.
 */
import bus from './event-bus.js';
import { getState } from './state.js';

function generateGroupId() {
    return `grp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** @returns {import('./layer-groups.js').LayerGroup[]} */
export function getLayerGroups() {
    return getState().layerGroups || [];
}

/** @param {import('./layer-groups.js').LayerGroup[]} groups */
export function setLayerGroups(groups) {
    getState().layerGroups = Array.isArray(groups) ? groups : [];
    bus.emit('layer-groups:changed', getLayerGroups());
}

function emitGroupsChanged() {
    bus.emit('layer-groups:changed', getLayerGroups());
}

/**
 * @param {string} name
 * @param {string[]} childLayerIds
 * @param {{ collapsed?: boolean, source?: 'import'|'manual' }} [opts]
 */
export function createLayerGroup(name, childLayerIds, opts = {}) {
    const ids = [...new Set(childLayerIds)].filter(Boolean);
    if (ids.length < 2) return null;

    const group = {
        id: generateGroupId(),
        name: String(name || 'Layer group').trim() || 'Layer group',
        childLayerIds: ids,
        collapsed: opts.collapsed === true,
        source: opts.source || 'manual',
        created: new Date().toISOString()
    };

    const groups = getLayerGroups();
    groups.push(group);
    setLayerGroups(groups);
    return group;
}

/**
 * @param {string} groupId
 * @param {object[]} layers
 */
export function assignLayersToGroup(groupId, layers) {
    for (const layer of layers) {
        if (layer) layer.groupId = groupId;
    }
}

/**
 * @param {object[]} datasets
 * @returns {string}
 */
export function resolveImportGroupName(datasets) {
    const first = datasets[0];
    const sourceFile = first?.source?.file;
    if (sourceFile) return sourceFile;

    const name = first?.name || 'Imported layers';
    const suffixMatch = name.match(/^(.+?)\s+-\s+(Points|Lines|Polygons)$/);
    if (suffixMatch) return suffixMatch[1];

    const shapefileMatch = name.match(/^(.+)_\d+$/);
    if (shapefileMatch && datasets.length > 1) return shapefileMatch[1];

    return name;
}

/**
 * Create a group when a single import produced multiple layers.
 * @param {object[]} datasets
 * @returns {{ group: object|null, datasets: object[] }}
 */
export function createImportGroupForDatasets(datasets) {
    if (!Array.isArray(datasets) || datasets.length < 2) {
        return { group: null, datasets: datasets || [] };
    }

    const existing = datasets.filter((ds) => ds.groupId);
    if (existing.length > 0) {
        return { group: getLayerGroups().find((g) => g.id === existing[0].groupId) || null, datasets };
    }

    const name = resolveImportGroupName(datasets);
    const group = createLayerGroup(
        name,
        datasets.map((ds) => ds.id),
        { collapsed: false, source: 'import' }
    );
    if (!group) return { group: null, datasets };

    assignLayersToGroup(group.id, datasets);
    return { group, datasets };
}

/**
 * @param {string} groupId
 */
export function getLayerGroup(groupId) {
    return getLayerGroups().find((g) => g.id === groupId) || null;
}

/**
 * @param {string} groupId
 */
export function toggleGroupCollapsed(groupId) {
    const group = getLayerGroup(groupId);
    if (!group) return;
    group.collapsed = !group.collapsed;
    emitGroupsChanged();
}

/**
 * @param {string} groupId
 * @param {string} name
 */
export function renameLayerGroup(groupId, name) {
    const group = getLayerGroup(groupId);
    if (!group) return;
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    group.name = trimmed;
    emitGroupsChanged();
}

/**
 * Remove group metadata; children become ungrouped.
 * @param {string} groupId
 * @param {object[]} layers
 */
export function dissolveLayerGroup(groupId, layers) {
    const groups = getLayerGroups().filter((g) => g.id !== groupId);
    setLayerGroups(groups);
    for (const layer of layers) {
        if (layer?.groupId === groupId) delete layer.groupId;
    }
}

/**
 * @param {string} groupId
 * @param {object[]} layers
 */
export function removeLayerFromGroup(groupId, layerId, layers) {
    const group = getLayerGroup(groupId);
    if (!group) return;
    group.childLayerIds = group.childLayerIds.filter((id) => id !== layerId);
    const layer = layers.find((l) => l.id === layerId);
    if (layer?.groupId === groupId) delete layer.groupId;

    if (group.childLayerIds.length < 2) {
        dissolveLayerGroup(groupId, layers);
    } else {
        emitGroupsChanged();
    }
}

/**
 * After a layer is removed, prune groups and dissolve singles.
 * @param {string} removedLayerId
 * @param {object[]} layers
 */
export function onLayerRemoved(removedLayerId, layers) {
    const groups = getLayerGroups();
    let changed = false;

    for (const group of groups) {
        const before = group.childLayerIds.length;
        group.childLayerIds = group.childLayerIds.filter((id) => id !== removedLayerId);
        if (group.childLayerIds.length !== before) changed = true;
    }

    const next = groups.filter((g) => g.childLayerIds.length >= 2);
    if (next.length !== groups.length) changed = true;

    for (const layer of layers) {
        if (layer.groupId && !next.some((g) => g.id === layer.groupId)) {
            delete layer.groupId;
        }
    }

    if (changed) setLayerGroups(next);
}

/**
 * Keep childLayerIds aligned with panel order; dissolve broken groups.
 * @param {object[]} layers
 */
export function reconcileGroupsAfterReorder(layers) {
    const layerIds = layers.map((l) => l.id);
    const groups = getLayerGroups();
    let changed = false;

    for (const group of groups) {
        const ordered = layerIds.filter((id) => group.childLayerIds.includes(id));
        if (ordered.length !== group.childLayerIds.length) {
            group.childLayerIds = ordered;
            changed = true;
        } else if (ordered.join(',') !== group.childLayerIds.join(',')) {
            group.childLayerIds = ordered;
            changed = true;
        }

        if (ordered.length >= 2 && !_areIdsContiguous(layerIds, ordered)) {
            // Children scattered — dissolve rather than force-jump layers.
            for (const layer of layers) {
                if (layer.groupId === group.id) delete layer.groupId;
            }
            group.childLayerIds = [];
            changed = true;
        }
    }

    const next = groups.filter((g) => g.childLayerIds.length >= 2);
    for (const layer of layers) {
        if (layer.groupId && !next.some((g) => g.id === layer.groupId)) {
            delete layer.groupId;
        }
    }

    if (changed || next.length !== groups.length) {
        setLayerGroups(next);
    }
}

/**
 * @param {string[]} allIds
 * @param {string[]} subsetIds
 */
function _areIdsContiguous(allIds, subsetIds) {
    const indices = subsetIds.map((id) => allIds.indexOf(id)).filter((i) => i >= 0).sort((a, b) => a - b);
    if (indices.length !== subsetIds.length) return false;
    for (let i = 1; i < indices.length; i++) {
        if (indices[i] !== indices[i - 1] + 1) return false;
    }
    return true;
}

/**
 * @param {string} groupId
 * @param {number} toIndex — target index in flat layers array for the group's first child
 * @param {object[]} layers — mutable reference to state.layers
 */
export function moveGroupBlockToIndex(groupId, toIndex, layers) {
    const group = getLayerGroup(groupId);
    if (!group || !group.childLayerIds.length) return;

    const block = group.childLayerIds
        .map((id) => layers.find((l) => l.id === id))
        .filter(Boolean);
    if (block.length < 2) return;

    const remaining = layers.filter((l) => !group.childLayerIds.includes(l.id));
    const clamped = Math.max(0, Math.min(toIndex, remaining.length));
    remaining.splice(clamped, 0, ...block);
    layers.length = 0;
    layers.push(...remaining);
    reconcileGroupsAfterReorder(layers);
    bus.emit('layers:changed', layers);
    bus.emit('layers:reordered', layers);
}

/**
 * @param {string[]} ids
 * @param {object[]} layers
 * @param {import('./layer-groups.js').LayerGroup[]} [groups]
 * @returns {string[]}
 */
export function expandLayerIdsForRemoval(ids, layers, groups = getLayerGroups()) {
    const out = new Set();
    for (const id of ids) {
        const group = groups.find((g) => g.id === id);
        if (group) {
            group.childLayerIds.forEach((childId) => out.add(childId));
        } else {
            out.add(id);
        }
    }
    return [...out].filter((id) => layers.some((l) => l.id === id));
}

/**
 * @param {string[]} layerIds
 * @param {object[]} layers
 * @param {string} [name]
 */
export function createManualGroupFromLayerIds(layerIds, layers, name) {
    const ids = [...new Set(layerIds)].filter((id) => layers.some((l) => l.id === id));
    if (ids.length < 2) return null;

    for (const id of ids) {
        const layer = layers.find((l) => l.id === id);
        if (layer?.groupId) dissolveLayerGroup(layer.groupId, layers);
    }

    const groupName = name || `Group (${ids.length} layers)`;
    const group = createLayerGroup(groupName, ids, { collapsed: false, source: 'manual' });
    if (!group) return null;

    for (const id of ids) {
        const layer = layers.find((l) => l.id === id);
        if (layer) layer.groupId = group.id;
    }

    _sortLayersByGroupBlock(layers, group);
    emitGroupsChanged();
    bus.emit('layers:changed', layers);
    return group;
}

/**
 * Move group children to a contiguous block in panel order.
 * @param {object[]} layers
 * @param {object} group
 */
function _sortLayersByGroupBlock(layers, group) {
    const block = group.childLayerIds
        .map((id) => layers.find((l) => l.id === id))
        .filter(Boolean);
    if (block.length < 2) return;

    const firstIdx = Math.min(...group.childLayerIds.map((id) => layers.findIndex((l) => l.id === id)).filter((i) => i >= 0));
    const remaining = layers.filter((l) => !group.childLayerIds.includes(l.id));
    const insertAt = Math.min(firstIdx, remaining.length);
    remaining.splice(insertAt, 0, ...block);
    layers.length = 0;
    layers.push(...remaining);
    group.childLayerIds = block.map((l) => l.id);
}

/**
 * @param {Map<string,string>} idMap oldLayerId -> newLayerId
 */
export function remapLayerGroups(idMap) {
    if (!idMap?.size) return;
    const groups = getLayerGroups();
    for (const group of groups) {
        group.childLayerIds = group.childLayerIds.map((id) => idMap.get(id) || id);
        group.id = group.id; // stable group ids
    }
    setLayerGroups(groups.filter((g) => g.childLayerIds.length >= 2));
}

/**
 * Build render rows for the layer panel (groups + ungrouped layers).
 * @param {object[]} layers
 * @param {import('./layer-groups.js').LayerGroup[]} groups
 */
export function buildLayerPanelRows(layers, groups = getLayerGroups()) {
    const rows = [];
    const consumed = new Set();

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (consumed.has(layer.id)) continue;

        const group = groups.find((g) => g.childLayerIds.includes(layer.id));
        if (group && group.childLayerIds[0] === layer.id) {
            const children = group.childLayerIds
                .map((id) => layers.find((l) => l.id === id))
                .filter(Boolean);
            children.forEach((c) => consumed.add(c.id));
            rows.push({ type: 'group', group, children, startIndex: i });
            continue;
        }

        if (layer.groupId && group) {
            continue;
        }

        rows.push({ type: 'layer', layer, index: i });
    }

    return rows;
}

/**
 * @param {string} groupId
 * @param {object[]} layers
 */
export function getGroupChildLayers(groupId, layers) {
    const group = getLayerGroup(groupId);
    if (!group) return [];
    return group.childLayerIds
        .map((id) => layers.find((l) => l.id === id))
        .filter(Boolean);
}

/**
 * @param {string} groupId
 * @param {object[]} layers
 */
export function isGroupFullyVisible(groupId, layers) {
    const children = getGroupChildLayers(groupId, layers);
    return children.length > 0 && children.every((l) => l.visible !== false);
}

/**
 * @param {string} groupId
 * @param {object[]} layers
 */
export function isGroupPartiallyVisible(groupId, layers) {
    const children = getGroupChildLayers(groupId, layers);
    return children.some((l) => l.visible !== false);
}

export function clearAllLayerGroups() {
    setLayerGroups([]);
}

export default {
    getLayerGroups,
    setLayerGroups,
    createLayerGroup,
    assignLayersToGroup,
    resolveImportGroupName,
    createImportGroupForDatasets,
    getLayerGroup,
    toggleGroupCollapsed,
    renameLayerGroup,
    dissolveLayerGroup,
    removeLayerFromGroup,
    onLayerRemoved,
    reconcileGroupsAfterReorder,
    moveGroupBlockToIndex,
    expandLayerIdsForRemoval,
    createManualGroupFromLayerIds,
    remapLayerGroups,
    buildLayerPanelRows,
    getGroupChildLayers,
    isGroupFullyVisible,
    isGroupPartiallyVisible,
    clearAllLayerGroups
};
