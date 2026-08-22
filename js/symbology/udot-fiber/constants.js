/**
 * UDOT Fiber Network MapServer constants.
 */

export const UDOT_FIBER_SERVICE_URL =
    'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer';

/** @type {ReadonlyArray<{ key: string, id: number, name: string, geometry: 'point'|'line' }>} */
export const UDOT_FIBER_LAYERS = Object.freeze([
    { key: 'cabinets', id: 0, name: 'Cabinets', geometry: 'point' },
    { key: 'splices', id: 2, name: 'Splices', geometry: 'point' },
    { key: 'boxes', id: 4, name: 'Boxes', geometry: 'point' },
    { key: 'fiber', id: 6, name: 'Fiber', geometry: 'line' },
    { key: 'conduit', id: 7, name: 'Conduit', geometry: 'line' },
    { key: 'building', id: 8, name: 'Building', geometry: 'point' }
]);

export const UDOT_FIBER_LAYER_BY_KEY = Object.freeze(
    Object.fromEntries(UDOT_FIBER_LAYERS.map((layer) => [layer.key, layer]))
);

export const UDOT_FIBER_LAYER_BY_ID = Object.freeze(
    Object.fromEntries(UDOT_FIBER_LAYERS.map((layer) => [layer.id, layer]))
);

/** Catalog / style pack id prefix. */
export const UDOT_FIBER_CATALOG_ID = 'udot-fiber-network';

/** Editable spatial copy of live Fiber clipped to sheet polygons. Used for map edit and sheet PDF when converted. */
export const SHEET_FIBER_SNAPSHOT_FORMAT = 'sheet-fiber-snapshot';

/** Live Fiber is hidden (no ArcGIS query) below this MapLibre zoom. */
export const UDOT_FIBER_MIN_ZOOM = 14;

/** Published rotationInfo field (`$feature.Rotation`, geographic / clockwise from north). */
export const UDOT_FIBER_ROTATION_FIELD = 'Rotation';

/** Published Boxes in-symbol label (`drawingInfo.labelingInfo`). */
export const UDOT_BOX_LABEL_FIELD = 'BOXLABELS';

/** Stamped on landscape box features that should show an in-rectangle label. */
export const UDOT_BOX_IN_LABEL_PROP = '_udotBoxLabel';

/**
 * @param {number|string} layerId
 * @returns {string}
 */
export function layerUrl(layerId) {
    return `${UDOT_FIBER_SERVICE_URL}/${layerId}`;
}

/**
 * Detect UDOT Fiber Network MapServer layer URLs.
 * @param {string} [url]
 * @returns {{ key: string, id: number }|null}
 */
export function matchUdotFiberLayerUrl(url) {
    const clean = String(url || '').trim().replace(/\/+$/, '').split('?')[0].toLowerCase();
    if (!clean.includes('/udot_fiber_network/mapserver')) return null;
    const m = clean.match(/\/mapserver\/(\d+)$/);
    if (!m) return null;
    const id = Number(m[1]);
    const meta = UDOT_FIBER_LAYER_BY_ID[id];
    return meta ? { key: meta.key, id } : null;
}
