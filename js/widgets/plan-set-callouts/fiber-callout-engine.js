/**
 * UDOT Fiber sheet callouts — session + generate (pure).
 * Legacy construction-code engine stays in engine.js for hidden plan-production-export.
 */

import { createPlanProject, updatePlanProject } from '../../plan-project/plan-project-model.js';
import { serializePlanProject, restorePlanProject } from '../../plan-project/serialization.js';
import { createStableId } from '../../plan-project/id-utils.js';
import { clipFeaturesToSheetFrame, buildSheetFramesGeoJson } from '../sheet-cutting/export-builder.js';
import { restoreSheetSession } from '../sheet-cutting/engine.js';
import { filterUdotFiberDisplayFeatures } from '../../symbology/udot-fiber/display-filters.js';
import {
    FIBER_CALLOUT_PROFILE,
    assignStableNoteNumbers,
    fiberFeatureId,
    findNoteByText,
    normalizeNoteText,
    noteTextForFeature,
    pointTargetKey
} from './fiber-notes.js';
import { groupSpanMembers } from './span-grouping.js';
import {
    clampCoordinateToSheet,
    collectFeatureObstacleCoordinates,
    featureAnchorCoordinate,
    isLeaderEnabled,
    leaderKey,
    notesUsedOnSheet,
    offsetBubbleCoordinate,
    placeBubbleAvoidingConflicts,
    resolveLeaderBubbles,
    sheetPolygonForLeader
} from './leader-placement.js';

export { FIBER_CALLOUT_PROFILE } from './fiber-notes.js';
export {
    buildCalloutPreviewGeoJson,
    leadersForSheet,
    notesUsedOnSheet,
    leaderKey,
    isLeaderEnabled,
    findCoveringInset
} from './leader-placement.js';

export const FIBER_CALLOUT_STEPS = ['Project', 'Generate', 'Review'];

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createFiberCalloutSession(input = {}) {
    return {
        version: 2,
        profileType: FIBER_CALLOUT_PROFILE,
        project: createPlanProject({
            projectName: input.projectName || 'Plan Set Callouts',
            projectNumber: input.projectNumber || ''
        }),
        notes: [],
        leaders: [],
        overrides: {
            suppressedLeaderKeys: [],
            enabledLeaderKeys: [],
            bubbleByLeaderKey: {},
            extraLeaders: [],
            extraNotes: []
        },
        placementObstacles: [],
        sheets: [],
        sheetSetId: '',
        selectedSheetId: '',
        routeLine: null,
        warnings: []
    };
}

/**
 * @param {object} [session]
 * @returns {boolean}
 */
export function isFiberCalloutSession(session) {
    return session?.profileType === FIBER_CALLOUT_PROFILE || session?.version === 2;
}

/**
 * @param {object} session
 * @param {object} patch
 * @returns {object}
 */
export function updateFiberCalloutProject(session, patch = {}) {
    return {
        ...session,
        project: updatePlanProject(session.project, patch)
    };
}

function emptyFeatures() {
    return { boxes: [], splices: [], conduit: [], fiber: [], cabinets: [], building: [] };
}

function detailSheets(sheets = []) {
    return sheets.filter((sheet) => sheet.sheetType !== 'overview');
}

function stampFiberKey(feature, fiberKey) {
    return {
        type: 'Feature',
        ...feature,
        properties: {
            ...(feature.properties || {}),
            _udotFiberKey: feature.properties?._udotFiberKey || fiberKey
        }
    };
}

function emptyOverrides() {
    return {
        suppressedLeaderKeys: [],
        enabledLeaderKeys: [],
        bubbleByLeaderKey: {},
        extraLeaders: [],
        extraNotes: []
    };
}

/**
 * Opt-in mode: empty enabledLeaderKeys means all auto callouts start off.
 * Legacy sessions without the field keep currently visible leaders on.
 * @param {object} session
 * @returns {object}
 */
export function withOptInOverrides(session) {
    const overrides = { ...emptyOverrides(), ...(session?.overrides || {}) };
    if (!Array.isArray(session?.overrides?.enabledLeaderKeys)) {
        const live = (session?.leaders || []).filter((leader) => isLeaderEnabled(leader));
        overrides.enabledLeaderKeys = live.length
            ? live.map((leader) => leader.leaderKey || leader.leaderId)
            : [];
    }
    return overrides;
}

function isAutoLeaderOn(overrides, key) {
    if ((overrides.suppressedLeaderKeys || []).includes(key)) return false;
    return (overrides.enabledLeaderKeys || []).includes(key);
}

function textsForTarget(kind, members) {
    const seen = new Set();
    const texts = [];
    for (const feature of members) {
        const fiberKey = feature.properties?._udotFiberKey || kind;
        const text = noteTextForFeature(fiberKey, feature);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        texts.push(text);
    }
    return texts;
}

function sortByRouteDistance(features, routeLine) {
    const t = typeof turf !== 'undefined' ? turf : null;
    if (!t || !routeLine?.geometry) return features;
    return [...features].sort((a, b) => {
        const ca = featureAnchorCoordinate(a);
        const cb = featureAnchorCoordinate(b);
        if (!ca || !cb) return 0;
        try {
            const da = t.nearestPointOnLine(routeLine, t.point(ca), { units: 'feet' }).properties.location || 0;
            const db = t.nearestPointOnLine(routeLine, t.point(cb), { units: 'feet' }).properties.location || 0;
            return da - db;
        } catch {
            return 0;
        }
    });
}

function pickAnchorFeature(members) {
    const points = members.filter((feature) => feature.geometry?.type === 'Point');
    if (points.length) return points[0];
    return members[0] || null;
}

/**
 * @param {object} session
 * @param {object} input
 * @returns {object}
 */
export function generateFiberCallouts(session, input = {}) {
    const sheets = detailSheets(input.sheets || session.sheets || []);
    if (!sheets.length) {
        throw new Error('Generate sheets in Sheet Cutter first.');
    }

    const routeLine = input.routeLine || session.routeLine;
    const frameCollection = input.frameFeatures
        || buildSheetFramesGeoJson(sheets, routeLine);
    const frames = frameCollection?.features || frameCollection || [];
    const sheetsWithFrames = sheets.map((sheet) => {
        const frame = frames.find((feature) => feature.properties?.sheet_id === sheet.sheetId)
            || frames.find((feature) => Number(feature.properties?.sheet_number) === Number(sheet.sheetNumber));
        return {
            ...sheet,
            frameGeometry: frame?.geometry || sheet.frameGeometry || null
        };
    });
    const sheetPolygonById = Object.fromEntries(
        sheetsWithFrames
            .filter((sheet) => sheet.frameGeometry)
            .map((sheet) => [sheet.sheetId, sheet.frameGeometry])
    );
    const features = { ...emptyFeatures(), ...(input.features || {}) };

    const boxes = filterUdotFiberDisplayFeatures(
        'boxes',
        (features.boxes || []).map((feature) => stampFiberKey(feature, 'boxes'))
    );
    const splices = (features.splices || []).map((feature) => stampFiberKey(feature, 'splices'));
    const lineFeatures = [
        ...(features.conduit || []).map((feature) => stampFiberKey(feature, 'conduit')),
        ...(features.fiber || []).map((feature) => stampFiberKey(feature, 'fiber'))
    ];
    const spanGroups = groupSpanMembers(lineFeatures, boxes);

    const warnings = [];
    const discovered = [];

    for (const sheet of sheetsWithFrames) {
        const frame = frames.find((feature) => feature.properties?.sheet_id === sheet.sheetId)
            || frames.find((feature) => Number(feature.properties?.sheet_number) === Number(sheet.sheetNumber));
        if (!frame) {
            warnings.push(`Sheet ${sheet.sheetNumber} has no frame polygon.`);
            continue;
        }

        const clippedBoxes = sortByRouteDistance(clipFeaturesToSheetFrame(frame, boxes), routeLine);
        for (const feature of clippedBoxes) {
            const featureId = fiberFeatureId(feature);
            if (!featureId) continue;
            discovered.push({
                sheetId: sheet.sheetId,
                sheetNumber: sheet.sheetNumber,
                kind: 'boxes',
                targetKey: pointTargetKey('boxes', featureId),
                members: [feature],
                texts: textsForTarget('boxes', [feature])
            });
        }

        const clippedSplices = sortByRouteDistance(clipFeaturesToSheetFrame(frame, splices), routeLine);
        for (const feature of clippedSplices) {
            const featureId = fiberFeatureId(feature);
            if (!featureId) continue;
            discovered.push({
                sheetId: sheet.sheetId,
                sheetNumber: sheet.sheetNumber,
                kind: 'splices',
                targetKey: pointTargetKey('splices', featureId),
                members: [feature],
                texts: textsForTarget('splices', [feature])
            });
        }

        const spanEntries = [...spanGroups.entries()].sort(([a], [b]) => a.localeCompare(b));
        for (const [targetKey, members] of spanEntries) {
            const clippedMembers = clipFeaturesToSheetFrame(frame, members);
            if (!clippedMembers.length) continue;
            discovered.push({
                sheetId: sheet.sheetId,
                sheetNumber: sheet.sheetNumber,
                kind: 'span',
                targetKey,
                members: clippedMembers,
                texts: textsForTarget('span', clippedMembers)
            });
        }
    }

    const existingNotes = [
        ...(session.notes || []),
        ...(session.overrides?.extraNotes || [])
    ];
    const textsInOrder = [];
    for (const item of discovered) textsInOrder.push(...item.texts);
    for (const extra of session.overrides?.extraNotes || []) {
        if (extra.text) textsInOrder.push(extra.text);
    }

    const notes = assignStableNoteNumbers(existingNotes, textsInOrder);
    const overrides = withOptInOverrides(session);
    const suppressed = new Set(overrides.suppressedLeaderKeys || []);
    const bubbleByLeaderKey = overrides.bubbleByLeaderKey || {};
    const placementObstacles = collectFeatureObstacleCoordinates(features);

    let autoLeaders = [];
    for (const item of discovered) {
        const key = leaderKey(item.sheetId, item.targetKey);
        const noteIds = item.texts
            .map((text) => findNoteByText(notes, text)?.noteId)
            .filter(Boolean);
        if (!noteIds.length) continue;
        const anchorFeature = pickAnchorFeature(item.members);
        const anchor = featureAnchorCoordinate(anchorFeature);
        if (!anchor) continue;
        const enabled = isAutoLeaderOn(overrides, key);
        autoLeaders.push({
            leaderId: key,
            leaderKey: key,
            sheetId: item.sheetId,
            sheetNumber: item.sheetNumber,
            targetKey: item.targetKey,
            targetKind: item.kind,
            memberIds: item.members.map((feature) => fiberFeatureId(feature)).filter(Boolean),
            noteIds,
            anchor,
            bubble: bubbleByLeaderKey[key] || offsetBubbleCoordinate(anchor, routeLine),
            suppressed: !enabled,
            enabled,
            source: 'auto'
        });
    }

    const extraLeaders = (overrides.extraLeaders || [])
        .filter((leader) => sheetsWithFrames.some((sheet) => sheet.sheetId === leader.sheetId))
        .map((leader) => {
            const key = leader.leaderKey || leader.leaderId;
            const enabled = !suppressed.has(key);
            return {
                ...leader,
                bubble: bubbleByLeaderKey[key] || leader.bubble,
                suppressed: !enabled,
                enabled
            };
        });

    const lockedKeys = new Set(Object.keys(bubbleByLeaderKey));
    const placed = resolveLeaderBubbles([...autoLeaders, ...extraLeaders], {
        routeLine,
        obstacles: [
            ...placementObstacles,
            ...[...autoLeaders, ...extraLeaders].map((leader) => leader.anchor).filter(Boolean)
        ],
        lockedKeys,
        sheetPolygonById
    });
    const extraKeys = new Set(extraLeaders.map((leader) => leader.leaderKey || leader.leaderId));
    autoLeaders = placed.filter((leader) => !extraKeys.has(leader.leaderKey || leader.leaderId));
    const placedExtra = placed.filter((leader) => extraKeys.has(leader.leaderKey || leader.leaderId));

    const selectedSheetId = sheetsWithFrames.some((sheet) => sheet.sheetId === session.selectedSheetId)
        ? session.selectedSheetId
        : (sheetsWithFrames[0]?.sheetId || '');

    return {
        ...session,
        version: 2,
        profileType: FIBER_CALLOUT_PROFILE,
        notes,
        leaders: [...autoLeaders, ...placedExtra],
        overrides,
        placementObstacles,
        sheets: sheetsWithFrames,
        sheetSetId: input.sheetSetId || session.sheetSetId || '',
        selectedSheetId,
        routeLine: routeLine || null,
        warnings
    };
}

/**
 * @param {object} session
 * @param {string} key
 * @param {boolean} enabled
 * @returns {object}
 */
export function setLeaderEnabled(session, key, enabled) {
    const overrides = withOptInOverrides(session);
    const suppressed = new Set(overrides.suppressedLeaderKeys || []);
    const opted = new Set(overrides.enabledLeaderKeys || []);
    if (enabled) {
        suppressed.delete(key);
        opted.add(key);
    } else {
        suppressed.add(key);
        opted.delete(key);
    }
    return {
        ...session,
        overrides: {
            ...overrides,
            suppressedLeaderKeys: [...suppressed],
            enabledLeaderKeys: [...opted]
        },
        leaders: (session.leaders || []).map((leader) => (
            (leader.leaderKey || leader.leaderId) === key
                ? { ...leader, suppressed: !enabled, enabled: Boolean(enabled) }
                : leader
        ))
    };
}

/**
 * @param {object} session
 * @param {string} key
 * @returns {object}
 */
export function suppressLeader(session, key) {
    return setLeaderEnabled(session, key, false);
}

/**
 * @param {object} session
 * @param {string} key
 * @returns {object}
 */
export function enableLeader(session, key) {
    return setLeaderEnabled(session, key, true);
}

/**
 * @param {object} session
 * @param {object} input
 * @returns {object}
 */
export function addManualLeader(session, input = {}) {
    const sheetId = input.sheetId || session.selectedSheetId;
    if (!sheetId) throw new Error('Select a sheet before adding a callout.');
    const text = normalizeNoteText(input.text);
    if (!text) throw new Error('Enter callout text.');
    const notes = assignStableNoteNumbers(
        [...(session.notes || []), ...(session.overrides?.extraNotes || [])],
        [text]
    );
    const note = findNoteByText(notes, text);
    const extraNotes = notes.filter((entry) => (
        (session.overrides?.extraNotes || []).some((item) => item.text === entry.text)
        || entry.text === text
    ));
    const targetKey = input.targetKey || `manual:${createStableId('manual')}`;
    const key = leaderKey(sheetId, targetKey);
    const sheetNumber = input.sheetNumber
        || (session.sheets || []).find((sheet) => sheet.sheetId === sheetId)?.sheetNumber;
    const sheetPolygon = (session.sheets || []).find((entry) => entry.sheetId === sheetId)?.frameGeometry || null;
    const leader = {
        leaderId: key,
        leaderKey: key,
        sheetId,
        sheetNumber,
        targetKey,
        targetKind: input.targetKind || 'manual',
        noteIds: [note.noteId],
        anchor: input.anchor,
        bubble: clampCoordinateToSheet(
            input.bubble || placeBubbleAvoidingConflicts({
                leaderKey: key,
                sheetId,
                anchor: input.anchor
            }, {
                routeLine: session.routeLine,
                obstacles: session.placementObstacles || [],
                otherLeaders: (session.leaders || []).filter((entry) => (
                    isLeaderEnabled(entry) && entry.sheetId === sheetId
                )),
                sheetPolygon
            }) || offsetBubbleCoordinate(input.anchor, session.routeLine),
            sheetPolygon
        ),
        suppressed: false,
        enabled: true,
        source: 'manual'
    };
    const extraLeaders = [
        ...(session.overrides?.extraLeaders || []).filter((entry) => entry.leaderKey !== key),
        leader
    ];
    const overrides = withOptInOverrides(session);
    const enabledLeaderKeys = [...new Set([...(overrides.enabledLeaderKeys || []), key])];
    const suppressedLeaderKeys = (overrides.suppressedLeaderKeys || []).filter((item) => item !== key);
    return {
        ...session,
        notes,
        overrides: {
            ...overrides,
            extraNotes,
            extraLeaders,
            enabledLeaderKeys,
            suppressedLeaderKeys
        },
        leaders: [
            ...(session.leaders || []).filter((entry) => entry.leaderKey !== key),
            { ...leader, enabled: true, suppressed: false }
        ]
    };
}

/**
 * Turn on an existing discovered leader, or add a manual one.
 * @param {object} session
 * @param {object} input
 * @returns {object}
 */
export function enableOrAddLeader(session, input = {}) {
    const targetKey = input.targetKey;
    if (targetKey) {
        const matches = (session.leaders || []).filter((leader) => leader.targetKey === targetKey);
        if (matches.length) {
            let next = session;
            for (const leader of matches) {
                next = setLeaderEnabled(next, leader.leaderKey || leader.leaderId, true);
            }
            return next;
        }
    }
    return addManualLeader(session, input);
}

/**
 * @param {object} session
 * @param {string} leaderKeyValue
 * @param {string} text
 * @returns {object}
 */
export function addNoteToLeader(session, leaderKeyValue, text) {
    const cleaned = normalizeNoteText(text);
    if (!cleaned) throw new Error('Enter callout text.');
    const notes = assignStableNoteNumbers(
        [...(session.notes || []), ...(session.overrides?.extraNotes || [])],
        [cleaned]
    );
    const note = findNoteByText(notes, cleaned);
    const extraNotes = [...(session.overrides?.extraNotes || [])];
    if (!extraNotes.some((entry) => entry.text === cleaned)) extraNotes.push(note);

    const patchLeader = (leader) => {
        if ((leader.leaderKey || leader.leaderId) !== leaderKeyValue) return leader;
        const noteIds = [...new Set([...(leader.noteIds || []), note.noteId])];
        return { ...leader, noteIds };
    };

    return {
        ...session,
        notes,
        overrides: {
            ...session.overrides,
            extraNotes,
            extraLeaders: (session.overrides?.extraLeaders || []).map(patchLeader)
        },
        leaders: (session.leaders || []).map(patchLeader)
    };
}

/**
 * @param {object} session
 * @param {string} leaderKeyValue
 * @param {number[]} bubble
 * @returns {object}
 */
export function moveLeaderBubble(session, leaderKeyValue, bubble) {
    const leader = (session.leaders || []).find((entry) => (
        (entry.leaderKey || entry.leaderId) === leaderKeyValue
    ));
    const clamped = clampCoordinateToSheet(bubble, sheetPolygonForLeader(session, leader));
    return {
        ...session,
        overrides: {
            ...session.overrides,
            bubbleByLeaderKey: {
                ...(session.overrides?.bubbleByLeaderKey || {}),
                [leaderKeyValue]: clamped
            }
        },
        leaders: (session.leaders || []).map((entry) => (
            (entry.leaderKey || entry.leaderId) === leaderKeyValue
                ? { ...entry, bubble: clamped }
                : entry
        ))
    };
}

/**
 * @param {object} session
 * @param {string} sheetId
 * @returns {object}
 */
export function selectCalloutSheet(session, sheetId) {
    return { ...session, selectedSheetId: sheetId };
}

/**
 * @param {object} bundle
 * @returns {object|null}
 */
export function restoreSheetSessionFromStore(bundle) {
    if (!bundle) return null;
    try {
        return restoreSheetSession(bundle);
    } catch {
        return null;
    }
}

/**
 * @param {object} session
 * @returns {object}
 */
export function serializeFiberCalloutSession(session) {
    return serializePlanProject(session.project, {
        callouts: {
            profileType: FIBER_CALLOUT_PROFILE,
            notes: session.notes || [],
            leaders: session.leaders || [],
            overrides: session.overrides || {},
            placementObstacles: session.placementObstacles || [],
            sheets: (session.sheets || []).map((sheet) => ({
                sheetId: sheet.sheetId,
                sheetNumber: sheet.sheetNumber,
                sheetType: sheet.sheetType,
                startDistanceFt: sheet.startDistanceFt,
                endDistanceFt: sheet.endDistanceFt,
                frameGeometry: sheet.frameGeometry || null
            })),
            selectedSheetId: session.selectedSheetId || '',
            warnings: session.warnings || []
        },
        metadata: {
            widget: 'plan-set-callouts',
            widgetVersion: 2,
            sheetSetId: session.sheetSetId || '',
            hasRouteLine: Boolean(session.routeLine?.geometry),
            routeGeometry: session.routeLine?.geometry || null
        }
    });
}

/**
 * @param {object} bundle
 * @returns {object}
 */
export function restoreFiberCalloutSession(bundle) {
    const restored = restorePlanProject(bundle);
    if (!restored.ok) {
        throw new Error(restored.errors[0]);
    }
    const callouts = restored.callouts || {};
    return {
        version: 2,
        profileType: FIBER_CALLOUT_PROFILE,
        project: restored.project,
        notes: callouts.notes || [],
        leaders: callouts.leaders || [],
        overrides: callouts.overrides || {
            suppressedLeaderKeys: [],
            enabledLeaderKeys: [],
            bubbleByLeaderKey: {},
            extraLeaders: [],
            extraNotes: []
        },
        placementObstacles: callouts.placementObstacles || [],
        sheets: callouts.sheets || [],
        sheetSetId: bundle.metadata?.sheetSetId || '',
        selectedSheetId: callouts.selectedSheetId || '',
        routeLine: bundle.metadata?.routeGeometry
            ? { type: 'Feature', geometry: bundle.metadata.routeGeometry, properties: {} }
            : null,
        warnings: callouts.warnings || []
    };
}

/**
 * @param {object} session
 * @returns {{ valid: boolean, errors: string[], warnings: string[], findings: object[] }}
 */
export function validateFiberCalloutSession(session) {
    const findings = [];
    if (!(session.sheets || []).length) {
        findings.push({
            severity: 'warning',
            code: 'missing_sheets',
            message: 'Link a Sheet Cutter session and generate callouts.',
            step: 'Generate'
        });
    }
    if (!(session.leaders || []).filter((leader) => isLeaderEnabled(leader)).length) {
        findings.push({
            severity: 'warning',
            code: 'missing_leaders',
            message: 'No callout leaders on the current sheets.',
            step: 'Review'
        });
    }
    for (const message of session.warnings || []) {
        findings.push({ severity: 'warning', code: 'generate_warning', message, step: 'Generate' });
    }
    const errors = findings.filter((entry) => entry.severity === 'error').map((entry) => entry.message);
    const warnings = findings.filter((entry) => entry.severity === 'warning').map((entry) => entry.message);
    return { valid: errors.length === 0, errors, warnings, findings };
}

export { AUTO_LINE_KEYS, AUTO_POINT_KEYS } from './fiber-notes.js';
