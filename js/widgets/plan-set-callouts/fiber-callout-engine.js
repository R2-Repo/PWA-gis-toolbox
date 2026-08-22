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
    featureAnchorCoordinate,
    leaderKey,
    notesUsedOnSheet,
    nudgeBubbles,
    offsetBubbleCoordinate
} from './leader-placement.js';

export { FIBER_CALLOUT_PROFILE } from './fiber-notes.js';
export {
    buildCalloutPreviewGeoJson,
    leadersForSheet,
    notesUsedOnSheet,
    leaderKey
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
            bubbleByLeaderKey: {},
            extraLeaders: [],
            extraNotes: []
        },
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

    for (const sheet of sheets) {
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
    const suppressed = new Set(session.overrides?.suppressedLeaderKeys || []);
    const bubbleByLeaderKey = session.overrides?.bubbleByLeaderKey || {};

    let autoLeaders = [];
    for (const item of discovered) {
        const key = leaderKey(item.sheetId, item.targetKey);
        if (suppressed.has(key)) continue;
        const noteIds = item.texts
            .map((text) => findNoteByText(notes, text)?.noteId)
            .filter(Boolean);
        if (!noteIds.length) continue;
        const anchorFeature = pickAnchorFeature(item.members);
        const anchor = featureAnchorCoordinate(anchorFeature);
        if (!anchor) continue;
        const bubble = bubbleByLeaderKey[key] || offsetBubbleCoordinate(anchor, routeLine);
        autoLeaders.push({
            leaderId: key,
            leaderKey: key,
            sheetId: item.sheetId,
            sheetNumber: item.sheetNumber,
            targetKey: item.targetKey,
            targetKind: item.kind,
            noteIds,
            anchor,
            bubble,
            suppressed: false,
            source: 'auto'
        });
    }

    autoLeaders = nudgeBubbles(autoLeaders);

    const extraLeaders = (session.overrides?.extraLeaders || [])
        .filter((leader) => sheets.some((sheet) => sheet.sheetId === leader.sheetId))
        .map((leader) => {
            const key = leader.leaderKey || leader.leaderId;
            return {
                ...leader,
                bubble: bubbleByLeaderKey[key] || leader.bubble,
                suppressed: suppressed.has(key)
            };
        });

    const selectedSheetId = sheets.some((sheet) => sheet.sheetId === session.selectedSheetId)
        ? session.selectedSheetId
        : (sheets[0]?.sheetId || '');

    return {
        ...session,
        version: 2,
        profileType: FIBER_CALLOUT_PROFILE,
        notes,
        leaders: [...autoLeaders, ...extraLeaders],
        sheets,
        sheetSetId: input.sheetSetId || session.sheetSetId || '',
        selectedSheetId,
        routeLine: routeLine || null,
        warnings
    };
}

/**
 * @param {object} session
 * @param {string} key
 * @returns {object}
 */
export function suppressLeader(session, key) {
    const suppressedLeaderKeys = [...new Set([
        ...(session.overrides?.suppressedLeaderKeys || []),
        key
    ])];
    return {
        ...session,
        overrides: { ...session.overrides, suppressedLeaderKeys },
        leaders: (session.leaders || []).map((leader) => (
            (leader.leaderKey || leader.leaderId) === key
                ? { ...leader, suppressed: true }
                : leader
        ))
    };
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
    const leader = {
        leaderId: key,
        leaderKey: key,
        sheetId,
        sheetNumber,
        targetKey,
        targetKind: input.targetKind || 'manual',
        noteIds: [note.noteId],
        anchor: input.anchor,
        bubble: input.bubble || offsetBubbleCoordinate(input.anchor, session.routeLine),
        suppressed: false,
        source: 'manual'
    };
    const extraLeaders = [
        ...(session.overrides?.extraLeaders || []).filter((entry) => entry.leaderKey !== key),
        leader
    ];
    return {
        ...session,
        notes,
        overrides: {
            ...session.overrides,
            extraNotes,
            extraLeaders,
            suppressedLeaderKeys: (session.overrides?.suppressedLeaderKeys || []).filter((item) => item !== key)
        },
        leaders: [
            ...(session.leaders || []).filter((entry) => entry.leaderKey !== key),
            leader
        ]
    };
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
    return {
        ...session,
        overrides: {
            ...session.overrides,
            bubbleByLeaderKey: {
                ...(session.overrides?.bubbleByLeaderKey || {}),
                [leaderKeyValue]: bubble
            }
        },
        leaders: (session.leaders || []).map((leader) => (
            (leader.leaderKey || leader.leaderId) === leaderKeyValue
                ? { ...leader, bubble }
                : leader
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
            sheets: (session.sheets || []).map((sheet) => ({
                sheetId: sheet.sheetId,
                sheetNumber: sheet.sheetNumber,
                sheetType: sheet.sheetType,
                startDistanceFt: sheet.startDistanceFt,
                endDistanceFt: sheet.endDistanceFt
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
            bubbleByLeaderKey: {},
            extraLeaders: [],
            extraNotes: []
        },
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
    if (!(session.leaders || []).filter((leader) => !leader.suppressed).length) {
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
