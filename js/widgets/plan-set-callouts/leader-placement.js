/**
 * Anchor / bubble placement and map/PDF preview GeoJSON for sheet callouts.
 */

import { fiberFeatureId } from './fiber-notes.js';

function turfApi() {
    return typeof turf !== 'undefined' ? turf : null;
}

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
 * @param {number[]} anchor
 * @param {object|null} routeLine
 * @param {number} [offsetFt]
 * @returns {number[]|null}
 */
export function offsetBubbleCoordinate(anchor, routeLine = null, offsetFt = 45) {
    const t = turfApi();
    if (!anchor?.length) return null;
    if (!t) return anchor;

    const origin = t.point(anchor);
    let bearing = 45;
    if (routeLine?.geometry) {
        try {
            const snapped = t.nearestPointOnLine(routeLine, origin, { units: 'feet' });
            const distanceFt = Number(snapped.properties?.location ?? 0);
            const routeLen = t.length(routeLine, { units: 'feet' });
            const ahead = t.along(routeLine, Math.min(distanceFt + 12, routeLen), { units: 'feet' });
            const behind = t.along(routeLine, Math.max(distanceFt - 12, 0), { units: 'feet' });
            bearing = t.bearing(behind, ahead) + 90;
        } catch {
            bearing = 45;
        }
    }

    try {
        return t.destination(origin, offsetFt, bearing, { units: 'feet' }).geometry.coordinates;
    } catch {
        return anchor;
    }
}

/**
 * @param {object[]} leaders
 * @param {number} [minFt]
 * @returns {object[]}
 */
export function nudgeBubbles(leaders = [], minFt = 28) {
    const t = turfApi();
    if (!t || leaders.length < 2) return leaders;

    const next = leaders.map((leader) => ({
        ...leader,
        bubble: leader.bubble ? [...leader.bubble] : leader.bubble
    }));

    for (let i = 1; i < next.length; i++) {
        const current = next[i];
        if (!current.bubble) continue;
        for (let j = 0; j < i; j++) {
            const other = next[j];
            if (!other.bubble) continue;
            const distanceFt = t.distance(t.point(current.bubble), t.point(other.bubble), { units: 'feet' });
            if (distanceFt >= minFt) continue;
            current.bubble = offsetBubbleCoordinate(current.bubble, null, minFt) || current.bubble;
        }
    }
    return next;
}

/**
 * @param {object} session
 * @param {string} sheetId
 * @returns {object[]}
 */
export function leadersForSheet(session, sheetId) {
    return (session?.leaders || []).filter((leader) => leader.sheetId === sheetId && !leader.suppressed);
}

/**
 * @param {object} session
 * @param {string} sheetId
 * @returns {object[]}
 */
export function notesUsedOnSheet(session, sheetId) {
    const byId = new Map((session?.notes || []).map((note) => [note.noteId, note]));
    const used = new Map();
    for (const leader of leadersForSheet(session, sheetId)) {
        for (const noteId of leader.noteIds || []) {
            const note = byId.get(noteId);
            if (note) used.set(note.noteId, note);
        }
    }
    return [...used.values()].sort((a, b) => a.number - b.number);
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
 * @returns {object}
 */
export function buildCalloutPreviewGeoJson(session) {
    const features = [];
    const notesById = new Map((session?.notes || []).map((note) => [note.noteId, note]));

    for (const leader of session?.leaders || []) {
        if (leader.suppressed || !leader.anchor || !leader.bubble) continue;
        const numbers = (leader.noteIds || [])
            .map((id) => notesById.get(id)?.number)
            .filter((value) => Number.isFinite(value));
        if (!numbers.length) continue;

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

        numbers.forEach((number, index) => {
            const t = turfApi();
            let coord = leader.bubble;
            if (t && index > 0) {
                coord = t.destination(t.point(leader.bubble), index * 18, 90, { units: 'feet' }).geometry.coordinates;
            } else if (index > 0) {
                coord = [leader.bubble[0] + index * 0.00005, leader.bubble[1]];
            }
            features.push({
                type: 'Feature',
                properties: {
                    feature_type: 'callout_bubble',
                    leader_id: leader.leaderId,
                    leader_key: leader.leaderKey,
                    sheet_id: leader.sheetId,
                    target_key: leader.targetKey,
                    callout_number: String(number),
                    source_feature_id: fiberFeatureId({ properties: { feature_id: leader.targetKey } })
                },
                geometry: { type: 'Point', coordinates: coord }
            });
        });
    }

    return { type: 'FeatureCollection', features };
}
