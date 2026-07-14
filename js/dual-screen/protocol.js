/**
 * Dual Screen Mode — cross-window message protocol
 * @see docs/DUAL_SCREEN_MODE.md
 */

export const CHANNEL_NAME = 'gis-toolbox-dual-screen';
export const PROTOCOL_VERSION = 1;

export const MessageType = {
    HELLO: 'HELLO',
    SNAPSHOT: 'SNAPSHOT',
    LAYER_ADD: 'LAYER_ADD',
    LAYER_UPDATE: 'LAYER_UPDATE',
    LAYER_REMOVE: 'LAYER_REMOVE',
    LAYER_ORDER: 'LAYER_ORDER',
    LAYER_STYLE: 'LAYER_STYLE',
    LAYER_VISIBILITY: 'LAYER_VISIBILITY',
    VIEWPORT: 'VIEWPORT',
    SELECTION: 'SELECTION',
    MAP_CHROME: 'MAP_CHROME',
    DRAW_CMD: 'DRAW_CMD',
    DRAW_EVENT: 'DRAW_EVENT',
    FENCE_SET: 'FENCE_SET',
    FENCE_CLEAR: 'FENCE_CLEAR',
    FILE_DROP: 'FILE_DROP',
    POPUP_ACTION: 'POPUP_ACTION',
    CTX_CMD: 'CTX_CMD',
    TOAST: 'TOAST',
    MAP_RPC: 'MAP_RPC',
    MAP_RPC_RESULT: 'MAP_RPC_RESULT',
    MAP_CMD: 'MAP_CMD',
    BYE: 'BYE',
    PING: 'PING',
    PONG: 'PONG'
};

let _msgCounter = 0;

export function createMessage(role, type, payload = {}) {
    _msgCounter += 1;
    return {
        v: PROTOCOL_VERSION,
        role,
        msgId: `${role}-${Date.now()}-${_msgCounter}`,
        type,
        payload,
        ts: Date.now()
    };
}

export function parseMessage(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.v !== PROTOCOL_VERSION) return null;
    if (!data.type || !data.msgId) return null;
    return data;
}

/**
 * Returns true if an incoming viewport message should be applied (not an echo).
 */
export function shouldApplyViewport(incoming, localRole, lastAppliedMsgId) {
    if (incoming.type !== MessageType.VIEWPORT) return true;
    if (incoming.msgId === lastAppliedMsgId) return false;
    const source = incoming.payload?.source;
    if (source && source === localRole) return false;
    return true;
}

export function serializeLayerForSync(layer, index) {
    return {
        id: layer.id,
        name: layer.name,
        type: layer.type,
        storage: layer.storage ?? null,
        workspaceLayerId: layer.workspaceLayerId ?? null,
        visible: layer.visible !== false,
        geojson: layer.geojson ? JSON.parse(JSON.stringify(layer.geojson)) : null,
        style: layer._mapStyle || null,
        mapLabels: layer._mapLabels ?? null,
        kmlExport: layer._kmlExport ?? null,
        colorIndex: index,
        source: layer.source,
        scaleRangeEnabled: !!layer.scaleRangeEnabled,
        minScale: layer.minScale ?? null,
        maxScale: layer.maxScale ?? null
    };
}

/** Minimal layer metadata for targeted style restyle on the secondary map. */
export function serializeLayerMetaForRestyle(layer) {
    if (!layer) return null;
    return {
        id: layer.id,
        name: layer.name,
        type: layer.type,
        storage: layer.storage ?? null,
        workspaceLayerId: layer.workspaceLayerId ?? null,
        visible: layer.visible !== false,
        geojson: layer.geojson ? JSON.parse(JSON.stringify(layer.geojson)) : null,
        source: layer.source ?? null,
        mapLabels: layer._mapLabels ?? layer.mapLabels ?? null,
        kmlExport: layer._kmlExport ?? layer.kmlExport ?? null,
        scaleRangeEnabled: !!layer.scaleRangeEnabled,
        minScale: layer.minScale ?? null,
        maxScale: layer.maxScale ?? null
    };
}

/** Strip non-serializable values (e.g. callbacks) from map RPC args. */
export function serializeMapRpcArgs(args = []) {
    return JSON.parse(JSON.stringify(args, (_key, value) => (
        typeof value === 'function' ? undefined : value
    )));
}

export function buildSnapshotPayload({ layers, viewport, basemap, is3d, basemapTone, layerStyles, activeLayerId, preserveViewport = false }) {
    return {
        layers: layers.map((l, i) => {
            const entry = serializeLayerForSync(l, i);
            const style = layerStyles?.get?.(l.id);
            if (style) entry.style = style;
            return entry;
        }),
        viewport: preserveViewport ? null : (viewport || null),
        preserveViewport: !!preserveViewport,
        basemap: basemap || 'voyager',
        is3d: !!is3d,
        basemapTone: basemapTone || { tint: 'default', opacity: 1 },
        activeLayerId: activeLayerId ?? null
    };
}

/**
 * Build viewport payload from a MapLibre map (includes bounds for clip-to-extent).
 * @param {import('maplibre-gl').Map} map
 * @param {'primary' | 'secondary'} source
 */
export function buildViewportPayload(map, source) {
    const c = map.getCenter();
    const b = map.getBounds();
    return {
        source,
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        bounds: {
            west: b.getWest(),
            south: b.getSouth(),
            east: b.getEast(),
            north: b.getNorth()
        }
    };
}

/**
 * Lightweight bounds-like object from a synced viewport payload.
 * @param {object} vp
 * @returns {object | null}
 */
export function boundsFromViewportPayload(vp) {
    if (vp?.bounds) {
        const { west, south, east, north } = vp.bounds;
        return {
            getWest: () => west,
            getEast: () => east,
            getSouth: () => south,
            getNorth: () => north
        };
    }
    if (!vp?.center) return null;
    const [lng, lat] = vp.center;
    const z = vp.zoom || 7;
    const span = 360 / Math.pow(2, z);
    const half = span / 2;
    return {
        getWest: () => lng - half,
        getEast: () => lng + half,
        getSouth: () => lat - half,
        getNorth: () => lat + half
    };
}
