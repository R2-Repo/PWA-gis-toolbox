/**
 * UDOT Fiber Network MapServer constants.
 */

export const UDOT_FIBER_SERVICE_URL =
    'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer';

/**
 * Layer ids after the 2026 MapServer republish.
 * Previous ids: splices 2, boxes 4, fiber 6, conduit 7, building 8.
 * @type {ReadonlyArray<{ key: string, id: number, name: string, geometry: 'point'|'line' }>}
 */
export const UDOT_FIBER_LAYERS = Object.freeze([
    { key: 'cabinets', id: 0, name: 'Cabinets', geometry: 'point' },
    { key: 'boxes', id: 1, name: 'Boxes', geometry: 'point' },
    { key: 'building', id: 2, name: 'Building', geometry: 'point' },
    { key: 'splices', id: 3, name: 'Splices', geometry: 'point' },
    { key: 'fiber', id: 4, name: 'Fiber', geometry: 'line' },
    { key: 'conduit', id: 5, name: 'Conduit', geometry: 'line' }
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

/** Catalog sublayer id → layer key. Saved sessions store this on `service.presetId`. */
const UDOT_FIBER_PRESET_LAYER_KEY = Object.freeze({
    'udot-fiber-cabinets': 'cabinets',
    'udot-fiber-splices': 'splices',
    'udot-fiber-boxes': 'boxes',
    'udot-fiber-lines': 'fiber',
    'udot-fiber-conduit': 'conduit',
    'udot-fiber-building': 'building'
});

/** Exact live-layer names from the catalog, for sessions saved before presetId. */
const UDOT_FIBER_NAME_LAYER_KEY = Object.freeze({
    'UDOT Cabinets': 'cabinets',
    'UDOT Splices': 'splices',
    'UDOT Boxes': 'boxes',
    'UDOT Fiber': 'fiber',
    'UDOT Conduit': 'conduit',
    'UDOT Building': 'building'
});

/**
 * Ids that 404 after the republish. 2 and 4 were reused for other layers,
 * so those are only corrected when a preset, layer key, or catalog name is known.
 */
const RETIRED_UDOT_FIBER_LAYER_KEY = Object.freeze({
    6: 'fiber',
    7: 'conduit',
    8: 'building'
});

/**
 * @param {string} [url]
 * @returns {{ id: number|null }|null}
 */
function parseUdotFiberServiceUrl(url) {
    const clean = String(url || '').trim().replace(/\/+$/, '').split('?')[0];
    if (!clean.toLowerCase().includes('/udot_fiber_network/mapserver')) return null;
    const m = clean.match(/\/mapserver(?:\/(\d+))?$/i);
    if (!m) return null;
    return { id: m[1] == null ? null : Number(m[1]) };
}

/**
 * @param {string} [hint] preset id, layer key, or catalog layer name
 * @returns {string|null}
 */
function fiberKeyFromHint(hint) {
    if (!hint) return null;
    if (UDOT_FIBER_PRESET_LAYER_KEY[hint]) return UDOT_FIBER_PRESET_LAYER_KEY[hint];
    if (UDOT_FIBER_LAYER_BY_KEY[hint]) return hint;
    return UDOT_FIBER_NAME_LAYER_KEY[hint] || null;
}

/**
 * Point a Fiber MapServer URL at the current layer id.
 * Leaves non-Fiber URLs unchanged.
 * @param {string} [url]
 * @param {string} [hint] preset id, layer key, or catalog layer name
 * @returns {string}
 */
export function canonicalUdotFiberLayerUrl(url, hint) {
    const raw = String(url || '').trim();
    const parsed = parseUdotFiberServiceUrl(raw);
    if (!parsed) return raw;
    const key = fiberKeyFromHint(hint)
        || (parsed.id != null ? UDOT_FIBER_LAYER_BY_ID[parsed.id]?.key : null)
        || (parsed.id != null ? RETIRED_UDOT_FIBER_LAYER_KEY[parsed.id] : null);
    if (!key) return raw.replace(/\/+$/, '').split('?')[0];
    const meta = UDOT_FIBER_LAYER_BY_KEY[key];
    return meta ? layerUrl(meta.id) : raw;
}

/**
 * Detect UDOT Fiber Network MapServer layer URLs.
 * Retired ids (6, 7, 8) still resolve to the layer they used to be.
 * @param {string} [url]
 * @returns {{ key: string, id: number }|null}
 */
export function matchUdotFiberLayerUrl(url) {
    const parsed = parseUdotFiberServiceUrl(url);
    if (!parsed || parsed.id == null) return null;
    const current = UDOT_FIBER_LAYER_BY_ID[parsed.id];
    if (current) return { key: current.key, id: current.id };
    const retiredKey = RETIRED_UDOT_FIBER_LAYER_KEY[parsed.id];
    const meta = retiredKey ? UDOT_FIBER_LAYER_BY_KEY[retiredKey] : null;
    return meta ? { key: meta.key, id: meta.id } : null;
}
