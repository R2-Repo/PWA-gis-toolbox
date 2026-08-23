/**
 * Anchor / bubble placement and map/PDF preview GeoJSON for sheet callouts.
 */

import { compareCalloutNotes, fiberFeatureId, formatCalloutLabel } from './fiber-notes.js';
import { polygonFromInsetView } from '../sheet-cutting/inset-views.js';
import { SHEET_BUBBLE_INSET_FT } from './callout-style.js';

function turfApi() {
    return typeof turf !== 'undefined' ? turf : null;
}

const CANDIDATE_BEARINGS = [45, 135, -45, -135, 90, -90, 30, 150, -30, -150, 0, 180, 60, 120];
const CANDIDATE_OFFSETS_FT = [16, 24, 34, 42, 58, 76, 96, 118];
export const MIN_BUBBLE_SEPARATION_FT = 32;
export const MIN_FEATURE_CLEARANCE_FT = 22;
export const MIN_LEADER_CLEARANCE_FT = 12;
export { SHEET_BUBBLE_INSET_FT };

/**
 * @param {object} [feature]
 * @returns {number[]|null}
 */
export function featureAnchorCoordinate(feature) {
    const geometry = feature?.geometry;
    if (!geometry) return null;
    const t = turfApi();

    if (geometry.type === 'Point') return geometry.coordinates;
    if (geometry.type === 'MultiPoint' && geometry.coordinates?.[0]) return geometry.coordinates[0];

    if (geometry.type === 'LineString' && geometry.coordinates?.length) {
        if (t) {
            try {
                const lengthFt = t.length(feature, { units: 'feet' });
                if (lengthFt > 0) {
                    return t.along(feature, lengthFt / 2, { units: 'feet' }).geometry.coordinates;
                }
            } catch {
                /* fall through */
            }
        }
        const coords = geometry.coordinates;
        return coords[Math.floor(coords.length / 2)];
    }

    if (geometry.type === 'MultiLineString' && geometry.coordinates?.length) {
        let best = geometry.coordinates[0];
        let bestLen = 0;
        for (const line of geometry.coordinates) {
            if (!line?.length) continue;
            const asFeature = { type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: {} };
            const lengthFt = t ? t.length(asFeature, { units: 'feet' }) : line.length;
            if (lengthFt > bestLen) {
                best = line;
                bestLen = lengthFt;
            }
        }
        return featureAnchorCoordinate({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: best },
            properties: {}
        });
    }

    return null;
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function distanceFeet(a, b) {
    const t = turfApi();
    if (!a?.length || !b?.length || !t) return Infinity;
    try {
        return t.distance(t.point(a), t.point(b), { units: 'feet' });
    } catch {
        return Infinity;
    }
}

/**
 * @param {number[]} origin
 * @param {number} offsetFt
 * @param {number} bearing
 * @returns {number[]|null}
 */
export function destinationCoordinate(origin, offsetFt, bearing) {
    const t = turfApi();
    if (!origin?.length || !t) return origin || null;
    try {
        return t.destination(t.point(origin), offsetFt, bearing, { units: 'feet' }).geometry.coordinates;
    } catch {
        return origin;
    }
}

/**
 * @param {number[]} anchor
 * @param {object|null} routeLine
 * @returns {number}
 */
export function preferredBubbleBearing(anchor, routeLine = null) {
    const t = turfApi();
    if (!t || !anchor?.length || !routeLine?.geometry) return 45;
    try {
        const origin = t.point(anchor);
        const snapped = t.nearestPointOnLine(routeLine, origin, { units: 'feet' });
        const distanceFt = Number(snapped.properties?.location ?? 0);
        const routeLen = t.length(routeLine, { units: 'feet' });
        const ahead = t.along(routeLine, Math.min(distanceFt + 12, routeLen), { units: 'feet' });
        const behind = t.along(routeLine, Math.max(distanceFt - 12, 0), { units: 'feet' });
        return t.bearing(behind, ahead) + 90;
    } catch {
        return 45;
    }
}

/**
 * @param {number[]} anchor
 * @param {object|null} routeLine
 * @param {number} [offsetFt]
 * @returns {number[]|null}
 */
export function offsetBubbleCoordinate(anchor, routeLine = null, offsetFt = 45) {
    if (!anchor?.length) return null;
    return destinationCoordinate(anchor, offsetFt, preferredBubbleBearing(anchor, routeLine)) || anchor;
}

/**
 * @param {object} [features]
 * @returns {number[][]}
 */
export function collectFeatureObstacleCoordinates(features = {}) {
    const coords = [];
    for (const key of ['boxes', 'splices', 'cabinets', 'building']) {
        for (const feature of features[key] || []) {
            const coord = featureAnchorCoordinate(feature);
            if (coord) coords.push(coord);
        }
    }
    return coords;
}

function pointToSegmentFeet(point, start, end) {
    const t = turfApi();
    if (!t || !point?.length || !start?.length || !end?.length) return Infinity;
    try {
        return t.pointToLineDistance(
            t.point(point),
            t.lineString([start, end]),
            { units: 'feet' }
        );
    } catch {
        return Infinity;
    }
}

function leadersIntersect(aStart, aEnd, bStart, bEnd) {
    const t = turfApi();
    if (!t || !aStart || !aEnd || !bStart || !bEnd) return false;
    try {
        return t.booleanIntersects(
            t.lineString([aStart, aEnd]),
            t.lineString([bStart, bEnd])
        );
    } catch {
        return false;
    }
}

/**
 * @param {object|null|undefined} geometryOrFeature
 * @returns {object|null}
 */
export function sheetPolygonFeature(geometryOrFeature) {
    if (!geometryOrFeature) return null;
    if (geometryOrFeature.type === 'Feature' && geometryOrFeature.geometry) return geometryOrFeature;
    if (geometryOrFeature.type === 'Polygon' || geometryOrFeature.type === 'MultiPolygon') {
        return { type: 'Feature', geometry: geometryOrFeature, properties: {} };
    }
    if (geometryOrFeature.geometry) return geometryOrFeature;
    return null;
}

/**
 * @param {object|null} geometryOrFeature
 * @param {number} [insetFt]
 * @returns {object|null}
 */
export function insetSheetPolygon(geometryOrFeature, insetFt = SHEET_BUBBLE_INSET_FT) {
    const t = turfApi();
    const feature = sheetPolygonFeature(geometryOrFeature);
    if (!feature) return null;
    if (!t || !insetFt) return feature;
    try {
        const buffered = t.buffer(feature, -Math.abs(insetFt), { units: 'feet' });
        if (!buffered?.geometry) return feature;
        if (buffered.geometry.type === 'Polygon') return buffered;
        if (buffered.geometry.type === 'MultiPolygon') {
            let best = null;
            let bestArea = -1;
            for (const coords of buffered.geometry.coordinates || []) {
                const candidate = t.polygon(coords);
                const area = t.area(candidate);
                if (area > bestArea) {
                    bestArea = area;
                    best = candidate;
                }
            }
            return best || feature;
        }
    } catch {
        /* fall through */
    }
    return feature;
}

/**
 * @param {number[]} coord
 * @param {object|null} geometryOrFeature
 * @param {number} [insetFt]
 * @returns {boolean}
 */
export function coordinateInSheet(coord, geometryOrFeature, insetFt = SHEET_BUBBLE_INSET_FT) {
    const t = turfApi();
    const feature = sheetPolygonFeature(geometryOrFeature);
    if (!coord?.length || !feature) return true;
    if (!t) return true;
    try {
        const target = insetSheetPolygon(feature, insetFt) || feature;
        return t.booleanPointInPolygon(t.point(coord), target);
    } catch {
        try {
            return t.booleanPointInPolygon(t.point(coord), feature);
        } catch {
            return true;
        }
    }
}

/**
 * Pull a coordinate onto the inset sheet polygon along the path to the centroid.
 * @param {number[]} coord
 * @param {object|null} geometryOrFeature
 * @param {number} [insetFt]
 * @returns {number[]}
 */
export function clampCoordinateToSheet(coord, geometryOrFeature, insetFt = SHEET_BUBBLE_INSET_FT) {
    if (!coord?.length) return coord;
    if (coordinateInSheet(coord, geometryOrFeature, insetFt)) return [...coord];
    const t = turfApi();
    const feature = sheetPolygonFeature(geometryOrFeature);
    if (!t || !feature) return coord;
    try {
        const target = insetSheetPolygon(feature, insetFt) || feature;
        if (t.booleanPointInPolygon(t.point(coord), target)) return [...coord];
        const centroid = t.centroid(target);
        const end = centroid.geometry.coordinates;
        let lo = 0;
        let hi = 1;
        let best = end;
        for (let i = 0; i < 20; i++) {
            const mid = (lo + hi) / 2;
            const pt = [
                coord[0] + (end[0] - coord[0]) * mid,
                coord[1] + (end[1] - coord[1]) * mid
            ];
            if (t.booleanPointInPolygon(t.point(pt), target)) {
                best = pt;
                hi = mid;
            } else {
                lo = mid;
            }
        }
        return best;
    } catch {
        return coord;
    }
}

/**
 * @param {object} session
 * @param {object} leader
 * @returns {object|null}
 */
export function sheetPolygonForLeader(session, leader) {
    if (!leader) return null;
    const sheets = session?.sheets || [];
    const sheet = sheets.find((entry) => entry.sheetId === leader.sheetId)
        || sheets.find((entry) => Number(entry.sheetNumber) === Number(leader.sheetNumber));
    return sheet?.frameGeometry || null;
}

function scoreBubbleCandidate(candidate, anchor, context) {
    const { obstacles = [], otherLeaders = [], selfKey, sheetPolygon } = context;
    if (sheetPolygon && !coordinateInSheet(candidate, sheetPolygon)) {
        return -2e7;
    }
    let minFeature = Infinity;
    for (const coord of obstacles) {
        const feet = distanceFeet(candidate, coord);
        if (feet < minFeature) minFeature = feet;
    }

    let minBubble = Infinity;
    let minLine = Infinity;
    let crosses = 0;
    for (const other of otherLeaders) {
        if (!other?.bubble || (other.leaderKey || other.leaderId) === selfKey) continue;
        const bubbleFeet = distanceFeet(candidate, other.bubble);
        if (bubbleFeet < minBubble) minBubble = bubbleFeet;
        if (other.anchor) {
            const lineFeet = pointToSegmentFeet(other.bubble, anchor, candidate);
            if (lineFeet < minLine) minLine = lineFeet;
            const selfLineFeet = pointToSegmentFeet(candidate, other.anchor, other.bubble);
            if (selfLineFeet < minLine) minLine = selfLineFeet;
            if (leadersIntersect(anchor, candidate, other.anchor, other.bubble)) crosses += 1;
        }
    }

    for (const coord of obstacles) {
        const lineFeet = pointToSegmentFeet(coord, anchor, candidate);
        if (lineFeet < minLine) minLine = lineFeet;
    }

    if (minFeature < MIN_FEATURE_CLEARANCE_FT) return -1e6 + minFeature;
    if (minBubble < MIN_BUBBLE_SEPARATION_FT) return -5e5 + minBubble;
    if (minLine < MIN_LEADER_CLEARANCE_FT) return -2e5 + minLine;

    return (Math.min(minFeature, 120) * 1.4)
        + Math.min(minBubble, 140)
        + Math.min(minLine, 80)
        - crosses * 80;
}

/**
 * @param {object} leader
 * @param {object} [options]
 * @returns {number[]}
 */
export function placeBubbleAvoidingConflicts(leader, options = {}) {
    const locked = options.lockedKeys instanceof Set ? options.lockedKeys : new Set(options.lockedKeys || []);
    const key = leader.leaderKey || leader.leaderId;
    if (locked.has(key) && leader.bubble?.length) {
        return clampCoordinateToSheet(leader.bubble, options.sheetPolygon);
    }

    const anchor = leader.anchor;
    if (!anchor) return leader.bubble || null;

    const preferred = offsetBubbleCoordinate(anchor, options.routeLine);
    const candidates = [];
    if (preferred) candidates.push(preferred);

    const preferredBearing = preferredBubbleBearing(anchor, options.routeLine);
    for (const offsetFt of CANDIDATE_OFFSETS_FT) {
        candidates.push(destinationCoordinate(anchor, offsetFt, preferredBearing));
        for (const bearing of CANDIDATE_BEARINGS) {
            candidates.push(destinationCoordinate(anchor, offsetFt, bearing));
        }
    }

    let best = preferred || anchor;
    let bestScore = -Infinity;
    const context = {
        obstacles: options.obstacles || [],
        otherLeaders: options.otherLeaders || [],
        selfKey: key,
        sheetPolygon: options.sheetPolygon || null
    };
    for (const candidate of candidates) {
        if (!candidate) continue;
        const score = scoreBubbleCandidate(candidate, anchor, context);
        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    return clampCoordinateToSheet(best, options.sheetPolygon);
}

/**
 * @param {object[]} leaders
 * @param {object} [options]
 * @returns {object[]}
 */
export function resolveLeaderBubbles(leaders = [], options = {}) {
    const locked = new Set(options.lockedKeys || []);
    const placed = [];
    for (const leader of leaders) {
        const sheetPolygon = options.sheetPolygonById?.[leader.sheetId]
            || leader.sheetPolygon
            || options.sheetPolygon
            || null;
        const sameSheet = placed.filter((other) => other.sheetId === leader.sheetId);
        const bubble = placeBubbleAvoidingConflicts(leader, {
            ...options,
            lockedKeys: locked,
            sheetPolygon,
            otherLeaders: sameSheet
        });
        placed.push({ ...leader, bubble: bubble || leader.bubble });
    }
    return placed;
}

/**
 * @param {object[]} leaders
 * @param {number} [minFt]
 * @returns {object[]}
 */
export function nudgeBubbles(leaders = [], minFt = MIN_BUBBLE_SEPARATION_FT) {
    return resolveLeaderBubbles(leaders, { obstacles: [] });
}

/**
 * @param {object} leader
 * @param {object[]} [insetViews]
 * @returns {object|null}
 */
export function findCoveringInset(leader, insetViews = []) {
    if (!leader?.anchor?.length || !insetViews?.length) return null;
    const t = turfApi();
    if (!t) return null;
    try {
        const point = t.point(leader.anchor);
        for (const view of insetViews) {
            const polygon = polygonFromInsetView(view);
            if (!polygon?.geometry) continue;
            if (t.booleanPointInPolygon(point, polygon)) return view;
        }
    } catch {
        return null;
    }
    return null;
}

/**
 * @param {object} leader
 * @returns {boolean}
 */
export function isLeaderEnabled(leader) {
    if (!leader) return false;
    if (leader.suppressed) return false;
    if (leader.enabled === false) return false;
    return true;
}

/**
 * @param {object} session
 * @param {string|{ sheetId?: string, sheetNumber?: number }} sheetOrId
 * @param {object} [options]
 * @returns {object[]}
 */
export function leadersForSheet(session, sheetOrId, options = {}) {
    const sheetId = typeof sheetOrId === 'object' ? sheetOrId?.sheetId : sheetOrId;
    const sheetNumber = typeof sheetOrId === 'object' ? sheetOrId?.sheetNumber : undefined;
    const insetViews = options.insetViews || [];
    const page = options.page || 'all';
    const insetView = options.insetView || null;

    const enabled = (session?.leaders || []).filter(isLeaderEnabled);
    let sheetLeaders = [];
    if (page === 'inset' && insetView) {
        sheetLeaders = enabled;
    } else if (sheetId) {
        sheetLeaders = enabled.filter((leader) => leader.sheetId === sheetId);
        if (!sheetLeaders.length && sheetNumber != null && sheetNumber !== '') {
            const sessionSheet = (session?.sheets || []).find((sheet) => (
                Number(sheet.sheetNumber) === Number(sheetNumber)
            ));
            if (sessionSheet?.sheetId) {
                sheetLeaders = enabled.filter((leader) => leader.sheetId === sessionSheet.sheetId);
            }
            if (!sheetLeaders.length) {
                sheetLeaders = enabled.filter((leader) => Number(leader.sheetNumber) === Number(sheetNumber));
            }
        }
    } else if (sheetNumber != null && sheetNumber !== '') {
        const sessionSheet = (session?.sheets || []).find((sheet) => (
            Number(sheet.sheetNumber) === Number(sheetNumber)
        ));
        if (sessionSheet?.sheetId) {
            sheetLeaders = enabled.filter((leader) => leader.sheetId === sessionSheet.sheetId);
        }
        if (!sheetLeaders.length) {
            sheetLeaders = enabled.filter((leader) => Number(leader.sheetNumber) === Number(sheetNumber));
        }
    }

    return sheetLeaders.filter((leader) => {
        if (page === 'all') return true;
        const covering = findCoveringInset(leader, insetView ? [insetView] : insetViews);
        if (page === 'corridor') return !covering;
        if (page === 'inset') {
            if (!covering) return false;
            if (insetView?.insetId) return covering.insetId === insetView.insetId;
            return true;
        }
        return true;
    });
}

/**
 * @param {object} session
 * @param {string|{ sheetId?: string, sheetNumber?: number }} sheetOrId
 * @param {object} [options]
 * @returns {object[]}
 */
export function notesUsedOnSheet(session, sheetOrId, options = {}) {
    const byId = new Map((session?.notes || []).map((note) => [note.noteId, note]));
    const used = new Map();
    for (const leader of leadersForSheet(session, sheetOrId, options)) {
        for (const noteId of leader.noteIds || []) {
            const note = byId.get(noteId);
            if (note) used.set(note.noteId, note);
        }
    }
    return [...used.values()].sort(compareCalloutNotes);
}

/**
 * @param {string} sheetId
 * @param {string} targetKey
 * @returns {string}
 */
export function leaderKey(sheetId, targetKey) {
    return `${sheetId}::${targetKey}`;
}

/**
 * @param {object} session
 * @param {object} [options]
 * @returns {object}
 */
export function buildCalloutPreviewGeoJson(session, options = {}) {
    const features = [];
    const notesById = new Map((session?.notes || []).map((note) => [note.noteId, note]));
    const insetViews = options.insetViews || [];

    for (const leader of session?.leaders || []) {
        if (!isLeaderEnabled(leader) || !leader.anchor || !leader.bubble) continue;
        if (findCoveringInset(leader, insetViews)) continue;
        const labels = (leader.noteIds || [])
            .map((id) => notesById.get(id))
            .filter((note) => Number.isFinite(Number(note?.number)) && Number(note.number) > 0)
            .map((note) => formatCalloutLabel(note))
            .filter(Boolean);
        if (!labels.length) continue;

        features.push({
            type: 'Feature',
            properties: {
                feature_type: 'callout_leader',
                leader_id: leader.leaderId,
                leader_key: leader.leaderKey,
                sheet_id: leader.sheetId,
                target_key: leader.targetKey
            },
            geometry: {
                type: 'LineString',
                coordinates: [leader.anchor, leader.bubble]
            }
        });

        labels.forEach((label, index) => {
            features.push({
                type: 'Feature',
                properties: {
                    feature_type: 'callout_bubble',
                    leader_id: leader.leaderId,
                    leader_key: leader.leaderKey,
                    sheet_id: leader.sheetId,
                    target_key: leader.targetKey,
                    callout_number: label,
                    stack_index: index,
                    source_feature_id: fiberFeatureId({ properties: { feature_id: leader.targetKey } })
                },
                geometry: { type: 'Point', coordinates: leader.bubble }
            });
        });
    }

    return { type: 'FeatureCollection', features };
}
