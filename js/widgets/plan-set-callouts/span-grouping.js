/**
 * Group carrier conduit banks into corridor spans; fiber / IMD ride along.
 * Nodes are boxes (~25 ft) or clustered carrier endpoints (splits).
 */

import { fiberFeatureId } from './fiber-notes.js';

export const BOX_SNAP_FT = 25;

function turfApi() {
    return typeof turf !== 'undefined' ? turf : null;
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function coordDistanceFt(a, b) {
    const t = turfApi();
    if (!t || !a?.length || !b?.length) return Infinity;
    try {
        return t.distance(t.point(a), t.point(b), { units: 'feet' });
    } catch {
        return Infinity;
    }
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
 * IMD / innerduct / microduct — contents, not a duct bank.
 * Counted banks like `4 - 1" Innerduct` stay carriers.
 * @param {object} [feature]
 * @returns {boolean}
 */
export function isInnerDuctFeature(feature) {
    const props = feature?.properties || {};
    const classVal = String(props.CONDUIT_SYM || '').trim();
    if (/micro\s*duct/i.test(classVal) || /^microduct$/i.test(classVal)) return true;
    const label = [
        props.CustNameRight,
        props.CUSTNAME,
        props.DT_RSCBUNDLE_CUSTNAME
    ].filter(Boolean).join(' ');
    if (/\bimd\b/i.test(label) || /individual\s+micro/i.test(label) || /micro\s*duct/i.test(label)) {
        return true;
    }
    if (/\b(inner\s*duct|innerduct)\b/i.test(label) && !/^\s*\d+\s*[-x×]/i.test(label.trim())) {
        return true;
    }
    return false;
}

/**
 * Outer conduit / duct-bank line that defines a span path.
 * @param {object} [feature]
 * @returns {boolean}
 */
export function isCarrierLineFeature(feature) {
    const key = feature?.properties?._udotFiberKey || '';
    if (key === 'fiber') return false;
    if (key && key !== 'conduit') return false;
    return !isInnerDuctFeature(feature);
}

/**
 * Fiber, IMD, or other inner line that follows a carrier.
 * @param {object} [feature]
 * @returns {boolean}
 */
export function isContentLineFeature(feature) {
    const key = feature?.properties?._udotFiberKey || '';
    return key === 'fiber' || isInnerDuctFeature(feature);
}

/**
 * @param {number[]} coord
 * @param {object[]} boxes
 * @param {number} [maxFt]
 * @returns {object|null}
 */
export function nearestBoxFeature(coord, boxes = [], maxFt = BOX_SNAP_FT) {
    if (!coord?.length || !boxes.length) return null;
    let best = null;
    let bestFt = Infinity;
    for (const box of boxes) {
        if (box?.geometry?.type !== 'Point' || !box.geometry.coordinates) continue;
        const distanceFt = coordDistanceFt(coord, box.geometry.coordinates);
        if (distanceFt <= maxFt && distanceFt < bestFt) {
            best = box;
            bestFt = distanceFt;
        }
    }
    return best;
}

function fallbackLineKey(feature) {
    const fiberKey = feature?.properties?._udotFiberKey || 'line';
    const featureId = fiberFeatureId(feature) || 'unknown';
    return `span:line:${fiberKey}:${featureId}`;
}

function pairKey(idA, idB) {
    const pair = [idA, idB].sort();
    return `span:${pair[0]}|${pair[1]}`;
}

/**
 * @param {object[]} [lineFeatures]
 * @param {object[]} [boxes]
 * @param {number} [maxFt]
 * @returns {{ nodeIdForCoord: (coord: number[]) => string, maxFt: number }}
 */
export function buildSpanNodeIndex(lineFeatures = [], boxes = [], maxFt = BOX_SNAP_FT) {
    const carriers = lineFeatures.filter(isCarrierLineFeature);
    const clusters = [];

    const snapBoxId = (coord) => {
        const box = nearestBoxFeature(coord, boxes, maxFt);
        const id = box ? fiberFeatureId(box) : '';
        return id ? `box:${id}` : '';
    };

    const addCluster = (coord) => {
        for (const cluster of clusters) {
            if (coordDistanceFt(cluster.coord, coord) <= maxFt) return cluster.id;
        }
        const id = `node:${clusters.length}`;
        clusters.push({ id, coord: [...coord] });
        return id;
    };

    for (const feature of carriers) {
        for (const end of lineEndpoints(feature.geometry)) {
            if (!snapBoxId(end)) addCluster(end);
        }
    }

    const nodeIdForCoord = (coord) => {
        const boxed = snapBoxId(coord);
        if (boxed) return boxed;
        let best = '';
        let bestFt = Infinity;
        for (const cluster of clusters) {
            const feet = coordDistanceFt(cluster.coord, coord);
            if (feet <= maxFt && feet < bestFt) {
                best = cluster.id;
                bestFt = feet;
            }
        }
        return best;
    };

    return { nodeIdForCoord, maxFt, boxes };
}

function isNodeIndex(value) {
    return Boolean(value && typeof value.nodeIdForCoord === 'function');
}

function keyFromEnds(ends, index) {
    if (ends.length < 2) return '';
    const a = index.nodeIdForCoord(ends[0]);
    const b = index.nodeIdForCoord(ends[1]);
    if (a && b) return pairKey(a, b);
    return '';
}

function pointToFeatureLineFt(coord, feature) {
    const t = turfApi();
    if (!t || !coord?.length || !feature?.geometry) return Infinity;
    try {
        return t.pointToLineDistance(t.point(coord), feature, { units: 'feet' });
    } catch {
        return Infinity;
    }
}

function endsMatchCarrier(contentEnds, carrierEnds, maxFt) {
    if (contentEnds.length < 2 || carrierEnds.length < 2) return false;
    const aligned = coordDistanceFt(contentEnds[0], carrierEnds[0]) <= maxFt
        && coordDistanceFt(contentEnds[1], carrierEnds[1]) <= maxFt;
    const swapped = coordDistanceFt(contentEnds[0], carrierEnds[1]) <= maxFt
        && coordDistanceFt(contentEnds[1], carrierEnds[0]) <= maxFt;
    return aligned || swapped;
}

function lineFollowsCarrier(content, carrier, maxFt) {
    const ends = lineEndpoints(content?.geometry);
    if (ends.length < 2) return false;
    if (endsMatchCarrier(ends, lineEndpoints(carrier?.geometry), maxFt)) return true;
    return ends.every((end) => pointToFeatureLineFt(end, carrier) <= maxFt);
}

/**
 * @param {object} content
 * @param {object[]} carriers
 * @param {number} [maxFt]
 * @returns {object|null}
 */
export function findHostCarrier(content, carriers = [], maxFt = BOX_SNAP_FT) {
    let best = null;
    let bestScore = Infinity;
    const ends = lineEndpoints(content?.geometry);
    for (const carrier of carriers) {
        if (!lineFollowsCarrier(content, carrier, maxFt)) continue;
        const cEnds = lineEndpoints(carrier.geometry);
        const aligned = coordDistanceFt(ends[0], cEnds[0]) + coordDistanceFt(ends[1], cEnds[1]);
        const swapped = coordDistanceFt(ends[0], cEnds[1]) + coordDistanceFt(ends[1], cEnds[0]);
        const score = Math.min(aligned, swapped);
        if (score < bestScore) {
            best = carrier;
            bestScore = score;
        }
    }
    return best;
}

/**
 * @param {object} feature
 * @param {object[]|{ nodeIdForCoord: Function }} [boxesOrIndex]
 * @param {number} [maxFt]
 * @returns {string}
 */
export function spanTargetKey(feature, boxesOrIndex = [], maxFt = BOX_SNAP_FT) {
    const index = isNodeIndex(boxesOrIndex)
        ? boxesOrIndex
        : buildSpanNodeIndex(
            isCarrierLineFeature(feature) ? [feature] : [],
            Array.isArray(boxesOrIndex) ? boxesOrIndex : [],
            maxFt
        );
    const ends = lineEndpoints(feature?.geometry);
    return keyFromEnds(ends, index) || fallbackLineKey(feature);
}

/**
 * @param {object} feature
 * @param {object[]} carriers
 * @param {{ nodeIdForCoord: Function, maxFt?: number }} index
 * @returns {string}
 */
function contentSpanKey(feature, carriers, index) {
    const host = findHostCarrier(feature, carriers, index.maxFt || BOX_SNAP_FT);
    if (host) {
        const hostKey = keyFromEnds(lineEndpoints(host.geometry), index);
        if (hostKey) return hostKey;
    }
    return keyFromEnds(lineEndpoints(feature?.geometry), index) || fallbackLineKey(feature);
}

/**
 * @param {object[]} lineFeatures
 * @param {object[]} boxes
 * @param {number} [maxFt]
 * @returns {Map<string, object[]>}
 */
export function groupSpanMembers(lineFeatures = [], boxes = [], maxFt = BOX_SNAP_FT) {
    const lines = lineFeatures.filter((feature) => feature?.geometry);
    const carriers = lines.filter(isCarrierLineFeature);
    const contents = lines.filter((feature) => !isCarrierLineFeature(feature));
    const index = buildSpanNodeIndex(lines, boxes, maxFt);
    const groups = new Map();

    const add = (key, feature) => {
        const list = groups.get(key) || [];
        list.push(feature);
        groups.set(key, list);
    };

    for (const feature of carriers) {
        add(spanTargetKey(feature, index, maxFt), feature);
    }
    for (const feature of contents) {
        add(contentSpanKey(feature, carriers, index), feature);
    }
    return groups;
}

/**
 * Stable id for a span member across remade Fiber / Conduit layers.
 * @param {object} [feature]
 * @returns {string}
 */
export function spanMemberKey(feature) {
    const fiberKey = String(feature?.properties?._udotFiberKey || '').trim();
    const id = fiberFeatureId(feature);
    if (fiberKey && id) return `${fiberKey}:${id}`;
    return id;
}

function lineLengthFt(feature) {
    const t = turfApi();
    if (!t || !feature?.geometry) return 0;
    try {
        return t.length(feature, { units: 'feet' });
    } catch {
        return 0;
    }
}

/**
 * One carrier to draw for a collapsed span. Prefers a real duct-bank line;
 * if several share the span, keeps the longest (stable id as tie-break).
 * @param {object[]} [members]
 * @returns {object|null}
 */
export function pickSpanRepresentative(members = []) {
    const list = (members || []).filter((feature) => feature?.geometry);
    const carriers = list.filter(isCarrierLineFeature);
    const pool = carriers.length ? carriers : list;
    if (!pool.length) return null;

    let best = pool[0];
    let bestLen = lineLengthFt(best);
    let bestId = fiberFeatureId(best) || '';
    for (let i = 1; i < pool.length; i++) {
        const feature = pool[i];
        const len = lineLengthFt(feature);
        const id = fiberFeatureId(feature) || '';
        const longer = len > bestLen + 0.01;
        const tie = Math.abs(len - bestLen) <= 0.01 && id && (!bestId || id < bestId);
        if (longer || tie) {
            best = feature;
            bestLen = len;
            bestId = id;
        }
    }
    return best;
}

/**
 * @param {Map<string, object[]>} [groups]
 * @returns {object[]}
 */
export function visibleMembersWhenCollapsed(groups) {
    const visible = [];
    for (const members of groups?.values?.() || []) {
        const representative = pickSpanRepresentative(members);
        if (representative) visible.push(representative);
    }
    return visible;
}

/**
 * View-only collapse: keep one carrier per span, hide sibling banks and contents.
 * Split stubs stay — they are other spans.
 * @param {object[]} [lineFeatures]
 * @param {object[]} [boxes]
 * @param {{ collapsed?: boolean, maxFt?: number }} [options]
 * @returns {object[]}
 */
export function filterLinesForCollapsedView(lineFeatures = [], boxes = [], options = {}) {
    const lines = (lineFeatures || []).filter((feature) => feature?.geometry);
    if (options.collapsed !== true) return lines;

    const groups = groupSpanMembers(lines, boxes, options.maxFt || BOX_SNAP_FT);
    const visibleKeys = new Set(
        visibleMembersWhenCollapsed(groups).map((feature) => spanMemberKey(feature)).filter(Boolean)
    );
    if (!visibleKeys.size) return visibleMembersWhenCollapsed(groups);

    return lines.filter((feature) => {
        const key = spanMemberKey(feature);
        return !key || visibleKeys.has(key);
    });
}
