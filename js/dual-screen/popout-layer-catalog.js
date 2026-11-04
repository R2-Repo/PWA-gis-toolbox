/**
 * Layer list the pop-out map is showing.
 * Fed by the dual-screen snapshot and forwarded map commands.
 * The legend and context menu read this instead of the main window's store.
 */

const LAYER_ADD_METHODS = new Set([
    'addLayer',
    'addLayerIncremental',
    'addWorkspaceLayer',
    'addServiceLayer',
    'addCoverageHeatmapLayer',
    'addGeoreferencedImageLayer'
]);

/** @type {object[]} */
let layers = [];
/** @type {Map<string, object>} */
const pending = new Map();
/** @type {Set<(layers: object[]) => void>} */
const listeners = new Set();

function emit() {
    const snapshot = layers.slice();
    for (const fn of listeners) {
        try { fn(snapshot); } catch { /* listener */ }
    }
}

export function getPopoutLayers() {
    return layers.slice();
}

/**
 * @param {(layers: object[]) => void} fn
 * @returns {() => void}
 */
export function subscribePopoutLayers(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function resetPopoutLayers() {
    pending.clear();
    layers = [];
    emit();
}

/**
 * @param {object|null|undefined} entry
 */
export function catalogEntryFromDataset(entry) {
    if (!entry?.id) return null;
    return {
        id: entry.id,
        name: entry.name || entry.id,
        type: entry.type || 'spatial',
        storage: entry.storage ?? null,
        visible: entry.visible !== false,
        geojson: entry.geojson || null,
        schema: entry.schema || null,
        style: entry.style || null,
        source: entry.source || null,
        geometryKind: entry.geometryKind || null,
        service: entry.service || null
    };
}

/**
 * @param {object[]} entries
 */
export function replacePopoutLayers(entries) {
    pending.clear();
    layers = (entries || []).map(catalogEntryFromDataset).filter(Boolean);
    emit();
}

/**
 * @param {object} entry
 */
export function upsertPopoutLayer(entry) {
    const next = catalogEntryFromDataset(entry);
    if (!next) return;
    const extra = pending.get(next.id);
    if (extra) {
        pending.delete(next.id);
        if (!next.style && extra.style) next.style = extra.style;
        if (extra.visible != null && entry.visible == null) next.visible = extra.visible;
    }
    const index = layers.findIndex((layer) => layer.id === next.id);
    if (index >= 0) layers[index] = { ...layers[index], ...next };
    else layers.push(next);
    emit();
}

/**
 * @param {string} id
 * @param {object} patch
 */
export function patchPopoutLayer(id, patch) {
    if (!id || !patch) return;
    const index = layers.findIndex((layer) => layer.id === id);
    if (index < 0) {
        pending.set(id, { ...(pending.get(id) || {}), ...patch });
        return;
    }
    layers[index] = { ...layers[index], ...patch };
    emit();
}

/** @param {string} id */
export function removePopoutLayer(id) {
    if (!id) return;
    pending.delete(id);
    const next = layers.filter((layer) => layer.id !== id);
    if (next.length === layers.length) return;
    layers = next;
    emit();
}

/** @param {string[]} orderedIds */
export function reorderPopoutLayers(orderedIds) {
    if (!Array.isArray(orderedIds) || !orderedIds.length) return;
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    layers = layers.slice().sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999));
    emit();
}

/**
 * Keep the catalog in step with one forwarded map call.
 * @param {string} [method]
 * @param {unknown[]} [args]
 */
export function notePopoutMapCommand(method, args = []) {
    if (!method) return;
    if (LAYER_ADD_METHODS.has(method)) {
        const dataset = args[0];
        const style = args[2] && typeof args[2] === 'object' ? args[2].style : null;
        if (dataset && typeof dataset === 'object') {
            upsertPopoutLayer(style ? { ...dataset, style } : dataset);
        }
        return;
    }
    if (method === 'setLayerStyle') {
        const layerId = args[0];
        const style = args[1];
        if (layerId && style) patchPopoutLayer(String(layerId), { style });
        return;
    }
    if (method === 'restyleLayer') {
        const dataset = args[1];
        const style = args[2];
        if (dataset && typeof dataset === 'object' && dataset.id) {
            upsertPopoutLayer(style ? { ...dataset, style } : dataset);
        }
        return;
    }
    if (method === 'refreshLayerData') {
        const dataset = args[0];
        if (dataset && typeof dataset === 'object' && dataset.id) {
            patchPopoutLayer(dataset.id, {
                geojson: dataset.geojson || null,
                name: dataset.name
            });
        }
        return;
    }
    if (method === 'toggleLayer') {
        const layerId = args[0];
        if (layerId) patchPopoutLayer(String(layerId), { visible: args[1] !== false });
        return;
    }
    if (method === 'removeLayer' || method === 'removeServiceLayer') {
        const layerId = typeof args[0] === 'string' ? args[0] : args[0]?.id;
        removePopoutLayer(layerId);
        return;
    }
    if (method === 'syncLayerOrder' && Array.isArray(args[0])) {
        reorderPopoutLayers(args[0]);
    }
}
