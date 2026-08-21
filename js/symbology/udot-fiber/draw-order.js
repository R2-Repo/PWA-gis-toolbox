/**
 * Fixed MapLibre draw order for UDOT Fiber Network live layers.
 * Line paint sits at the back; splices sit above boxes; cabinets stay on top.
 */

import { matchUdotFiberLayerUrl } from './constants.js';

/** Bottom → top among Fiber catalog keys (paint rank). Cabinets always win. */
export const UDOT_FIBER_DRAW_ORDER = Object.freeze([
    'conduit',
    'fiber',
    'building',
    'boxes',
    'splices',
    'cabinets'
]);

const DRAW_RANK = Object.freeze(
    Object.fromEntries(UDOT_FIBER_DRAW_ORDER.map((key, index) => [key, index]))
);

const LINE_KEYS = new Set(['conduit', 'fiber']);

/**
 * @param {string} [layerId]
 * @returns {boolean}
 */
export function isUdotFiberLabelLayerId(layerId) {
    return typeof layerId === 'string'
        && (layerId.endsWith('-labels')
            || layerId.endsWith('-line-labels')
            || layerId.endsWith('-labels-plate')
            || layerId.endsWith('-line-labels-plate'));
}

/**
 * @param {string} [layerKey]
 * @returns {number}
 */
export function udotFiberDrawRank(layerKey) {
    const rank = DRAW_RANK[layerKey];
    return Number.isFinite(rank) ? rank : -1;
}

/**
 * @param {string} [url]
 * @returns {string|null}
 */
export function udotFiberKeyFromUrl(url) {
    return matchUdotFiberLayerUrl(url)?.key || null;
}

/**
 * Collect MapLibre sublayer ids grouped by Fiber catalog key.
 * @param {Iterable<{ key: string, mapLayerIds?: string[] }>} parts
 * @returns {Record<string, string[]>}
 */
export function groupUdotFiberMapLayerIds(parts) {
    /** @type {Record<string, string[]>} */
    const byKey = Object.fromEntries(UDOT_FIBER_DRAW_ORDER.map((key) => [key, []]));
    for (const part of parts || []) {
        const key = part?.key;
        if (!key || !byKey[key]) continue;
        const ids = part.mapLayerIds || [];
        if (ids.length) byKey[key].push(...ids);
    }
    return byKey;
}

/**
 * Flatten Fiber map layers into a stable bottom → top list.
 * Line paint first, then line labels (in front of the strokes), then points.
 * @param {Record<string, string[]>} byKey
 * @returns {string[]}
 */
export function collectUdotFiberOrderedIds(byKey) {
    const linePaint = [];
    const lineLabels = [];
    const pointStack = [];

    for (const key of UDOT_FIBER_DRAW_ORDER) {
        const ids = byKey?.[key] || [];
        if (LINE_KEYS.has(key)) {
            for (const id of ids) {
                if (isUdotFiberLabelLayerId(id)) lineLabels.push(id);
                else linePaint.push(id);
            }
            continue;
        }
        const paint = [];
        const labels = [];
        for (const id of ids) {
            if (isUdotFiberLabelLayerId(id)) labels.push(id);
            else paint.push(id);
        }
        pointStack.push(...paint, ...labels);
    }

    return [...linePaint, ...lineLabels, ...pointStack];
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {Record<string, string[]>} byKey
 */
export function orderUdotFiberLayers(map, byKey) {
    if (!map || !byKey) return;

    // moveLayer(id) sends each id to the top. Walking bottom → top leaves
    // cabinets last (on top) and conduit/fiber paint at the back of the stack.
    for (const id of collectUdotFiberOrderedIds(byKey)) {
        if (!map.getLayer(id)) continue;
        try {
            map.moveLayer(id);
        } catch {
            /* ignore move errors during teardown */
        }
    }
}
