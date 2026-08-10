/**
 * Shared import-fence intersection — used by standard import, streaming worker,
 * and estimate paths. Worker-safe (no Turf).
 *
 * Null geometry is excluded from a spatial fence (counted separately by callers).
 */
import { geometryIntersectsBBox } from '../map/tiles/tile-math.js';

/**
 * @param {unknown} fenceBbox
 * @returns {fenceBbox is [number, number, number, number]}
 */
export function isImportFenceBbox(fenceBbox) {
    return Array.isArray(fenceBbox)
        && fenceBbox.length === 4
        && fenceBbox.every((n) => Number.isFinite(n));
}

/**
 * True when the feature's geometry intersects the fence bbox.
 * Null / missing geometry → false (excluded from fenced imports).
 *
 * @param {{ geometry?: object|null }|null|undefined} feature
 * @param {[number, number, number, number]} fenceBbox [west, south, east, north]
 * @returns {boolean}
 */
export function featureIntersectsImportFence(feature, fenceBbox) {
    if (!isImportFenceBbox(fenceBbox)) return true;
    const geometry = feature?.geometry;
    if (!geometry) return false;
    return geometryIntersectsBBox(geometry, fenceBbox);
}

/**
 * Geometry-only variant for streaming workers that already hold a geometry object.
 * @param {object|null|undefined} geometry
 * @param {[number, number, number, number]} fenceBbox
 * @returns {boolean}
 */
export function geometryIntersectsImportFence(geometry, fenceBbox) {
    if (!isImportFenceBbox(fenceBbox)) return true;
    if (!geometry) return false;
    return geometryIntersectsBBox(geometry, fenceBbox);
}

export default {
    isImportFenceBbox,
    featureIntersectsImportFence,
    geometryIntersectsImportFence
};
