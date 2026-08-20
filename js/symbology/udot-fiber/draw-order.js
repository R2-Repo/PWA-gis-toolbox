/**
 * Fixed MapLibre draw order for UDOT Fiber Network live layers.
 * Cabinets stay on top of every other Fiber sublayer.
 */

import { matchUdotFiberLayerUrl } from './constants.js';

/** Bottom → top. Cabinets, then splices, then boxes sit above buildings and lines. */
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
 * @param {import('maplibre-gl').Map} map
 * @param {Record<string, string[]>} byKey
 */
export function orderUdotFiberLayers(map, byKey) {
    if (!map || !byKey) return;

    const ordered = UDOT_FIBER_DRAW_ORDER.flatMap((key) => byKey[key] || []);
    for (let i = 0; i < ordered.length; i++) {
        const id = ordered[i];
        if (!map.getLayer(id)) continue;
        const beforeId = ordered.slice(i + 1).find((candidate) => map.getLayer(candidate));
        try {
            if (beforeId) map.moveLayer(id, beforeId);
            else map.moveLayer(id);
        } catch {
            /* ignore move errors during teardown */
        }
    }

    for (const id of byKey.cabinets || []) {
        if (!map.getLayer(id)) continue;
        try {
            map.moveLayer(id);
        } catch {
            /* ignore */
        }
    }
}
