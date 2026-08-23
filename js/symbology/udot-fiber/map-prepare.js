/**
 * Shared Fiber feature prep for live layers and editable snapshots.
 */
import { decorateUdotFiberPointFeatures } from './glyphs.js';
import { applyUdotFiberDisplayOffsets } from './display-offsets.js';
import { filterUdotFiberDisplayFeatures } from './display-filters.js';

/**
 * Filter hide-lists, apply plan-style sheath offsets, stamp glyph ids.
 * @param {string} fiberKey
 * @param {object[]} features
 * @param {import('maplibre-gl').Map} [map]
 * @param {{ skipDisplayOffsets?: boolean }} [options]
 * @returns {object[]}
 */
export function prepareUdotFiberMapFeatures(fiberKey, features, map, options = {}) {
    let next = filterUdotFiberDisplayFeatures(fiberKey, features || []);
    if (fiberKey === 'fiber' && options.skipDisplayOffsets !== true) {
        next = applyUdotFiberDisplayOffsets(next);
    }
    return decorateUdotFiberPointFeatures(fiberKey, next, map);
}
