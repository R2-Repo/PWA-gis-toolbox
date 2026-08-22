/**
 * Group coincident conduit + fiber lines into corridor spans.
 * Snap endpoints to nearest box (~25 ft). No conduit-meeting layer exists.
 */

import { fiberFeatureId } from './fiber-notes.js';

export const BOX_SNAP_FT = 25;

function turfApi() {
    return typeof turf !== 'undefined' ? turf : null;
}

/**
 * @param {object} [geometry]
 * @returns {number[][]}
 */
export function lineEndpoints(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'LineString' && geometry.coordinates?.length) {
        return [geometry.coordinates[0], geometry.coordinates[geometry.coordinates.length - 1]];
    }
    if (geometry.type === 'MultiLineString' && geometry.coordinates?.length) {
        const first = geometry.coordinates[0];
        const last = geometry.coordinates[geometry.coordinates.length - 1];
        if (!first?.length || !last?.length) return [];
        return [first[0], last[last.length - 1]];
    }
    return [];
}

/**
 * @param {number[]} coord
 * @param {object[]} boxes
 * @param {number} [maxFt]
 * @returns {object|null}
 */
export function nearestBoxFeature(coord, boxes = [], maxFt = BOX_SNAP_FT) {
    const t = turfApi();
    if (!t || !coord?.length || !boxes.length) return null;
    const origin = t.point(coord);
    let best = null;
    let bestFt = Infinity;
    for (const box of boxes) {
        if (box?.geometry?.type !== 'Point' || !box.geometry.coordinates) continue;
        const distanceFt = t.distance(origin, t.point(box.geometry.coordinates), { units: 'feet' });
        if (distanceFt <= maxFt && distanceFt < bestFt) {
            best = box;
            bestFt = distanceFt;
        }
    }
    return best;
}

/**
 * @param {object} feature
 * @param {object[]} boxes
 * @param {number} [maxFt]
 * @returns {string}
 */
export function spanTargetKey(feature, boxes = [], maxFt = BOX_SNAP_FT) {
    const fiberKey = feature?.properties?._udotFiberKey || 'line';
    const featureId = fiberFeatureId(feature) || 'unknown';
    const ends = lineEndpoints(feature?.geometry);
    if (ends.length < 2) return `span:line:${fiberKey}:${featureId}`;

    const a = nearestBoxFeature(ends[0], boxes, maxFt);
    const b = nearestBoxFeature(ends[1], boxes, maxFt);
    const idA = a ? fiberFeatureId(a) : '';
    const idB = b ? fiberFeatureId(b) : '';
    if (idA && idB) {
        const pair = [idA, idB].sort();
        return `span:${pair[0]}|${pair[1]}`;
    }
    return `span:line:${fiberKey}:${featureId}`;
}

/**
 * @param {object[]} lineFeatures
 * @param {object[]} boxes
 * @param {number} [maxFt]
 * @returns {Map<string, object[]>}
 */
export function groupSpanMembers(lineFeatures = [], boxes = [], maxFt = BOX_SNAP_FT) {
    const groups = new Map();
    for (const feature of lineFeatures) {
        if (!feature?.geometry) continue;
        const key = spanTargetKey(feature, boxes, maxFt);
        const list = groups.get(key) || [];
        list.push(feature);
        groups.set(key, list);
    }
    return groups;
}
