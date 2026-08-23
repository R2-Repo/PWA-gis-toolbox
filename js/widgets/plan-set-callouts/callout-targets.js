/**
 * Resolve Fiber features to discovered callout leaders (pure).
 */

import { fiberFeatureId, noteTextForFeature, pointTargetKey } from './fiber-notes.js';
import { coordinateInSheet } from './leader-placement.js';

function turfApi() {
    return typeof turf !== 'undefined' ? turf : null;
}

/**
 * @param {object} [leader]
 * @returns {boolean}
 */
export function isLeaderOn(leader) {
    return Boolean(leader && leader.suppressed !== true && leader.enabled !== false);
}

/**
 * Exact target or member id — never substring-match a span key.
 * @param {object} leader
 * @param {object} feature
 * @returns {boolean}
 */
export function leaderMatchesFeature(leader, feature) {
    if (!leader || !feature) return false;
    const featureId = fiberFeatureId(feature);
    const fiberKey = feature.properties?._udotFiberKey || '';
    if ((fiberKey === 'boxes' || fiberKey === 'splices') && featureId) {
        return leader.targetKey === pointTargetKey(fiberKey, featureId);
    }
    if (featureId && (leader.memberIds || []).map(String).includes(String(featureId))) {
        return true;
    }
    return false;
}

/**
 * @param {object} session
 * @param {object} feature
 * @returns {object[]}
 */
export function leadersMatchingFeature(session, feature) {
    return (session?.leaders || []).filter((leader) => leaderMatchesFeature(leader, feature));
}

/**
 * @param {object} session
 * @param {number[]} coord
 * @returns {string}
 */
export function sheetIdForCoordinate(session, coord) {
    if (!coord?.length) return session?.selectedSheetId || '';
    for (const sheet of session?.sheets || []) {
        if (!sheet?.frameGeometry) continue;
        if (coordinateInSheet(coord, sheet.frameGeometry, 0)) return sheet.sheetId;
    }
    return session?.selectedSheetId || '';
}

/**
 * @param {object} session
 * @param {number[]} [bbox]
 * @returns {string[]}
 */
export function sheetIdsIntersectingBbox(session, bbox) {
    const t = turfApi();
    if (!t || !Array.isArray(bbox) || bbox.length < 4) return [];
    let boxPoly = null;
    try {
        boxPoly = t.bboxPolygon(bbox);
    } catch {
        return [];
    }
    const ids = [];
    for (const sheet of session?.sheets || []) {
        if (!sheet?.frameGeometry) continue;
        try {
            if (t.booleanIntersects(boxPoly, sheet.frameGeometry)) ids.push(sheet.sheetId);
        } catch {
            /* skip */
        }
    }
    return ids;
}

/**
 * @param {object} session
 * @param {object} leader
 * @returns {string[]}
 */
export function noteTextsForLeader(session, leader) {
    const notesById = new Map((session?.notes || []).map((note) => [note.noteId, note]));
    return (leader?.noteIds || [])
        .map((id) => notesById.get(id)?.text)
        .filter(Boolean);
}

/**
 * @param {object} session
 * @param {object} leader
 * @returns {string}
 */
export function labelForLeader(session, leader) {
    const texts = noteTextsForLeader(session, leader);
    const kind = leader?.targetKind || 'span';
    return texts.length ? `${kind}: ${texts.join(', ')}` : kind;
}

/**
 * @param {object} session
 * @param {object} feature
 * @param {{ sheetId?: string, coord?: number[] }} [options]
 * @returns {object[]}
 */
export function leadersForFeatureOnSheet(session, feature, options = {}) {
    const matches = leadersMatchingFeature(session, feature);
    const sheetId = options.sheetId || (options.coord ? sheetIdForCoordinate(session, options.coord) : '');
    if (!sheetId) return matches;
    const scoped = matches.filter((leader) => leader.sheetId === sheetId);
    return scoped.length ? scoped : matches;
}

/**
 * @param {object} session
 * @param {object[]} features
 * @param {{ sheetId?: string, coord?: number[], bbox?: number[] }} [options]
 * @returns {object[]}
 */
export function leadersForFeatures(session, features = [], options = {}) {
    const sheetIds = options.sheetId
        ? [options.sheetId]
        : [
            ...(options.bbox ? sheetIdsIntersectingBbox(session, options.bbox) : []),
            ...(options.coord ? [sheetIdForCoordinate(session, options.coord)].filter(Boolean) : [])
        ];
    const seen = new Set();
    const leaders = [];
    for (const feature of features) {
        const matches = leadersMatchingFeature(session, feature);
        const scoped = sheetIds.length
            ? matches.filter((leader) => sheetIds.includes(leader.sheetId))
            : matches;
        const list = scoped.length ? scoped : matches;
        for (const leader of list) {
            const key = leader.leaderKey || leader.leaderId;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            leaders.push(leader);
        }
    }
    return leaders;
}

/**
 * @param {object} feature
 * @param {string} [fiberKey]
 * @returns {string}
 */
export function fallbackCalloutText(feature, fiberKey) {
    const key = fiberKey || feature?.properties?._udotFiberKey || 'span';
    return noteTextForFeature(key, feature);
}
