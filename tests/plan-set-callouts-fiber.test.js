import * as turf from '@turf/turf';
import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdSequence } from '../js/plan-project/id-utils.js';
import { assignStableNoteNumbers, noteTextForFeature, pointTargetKey } from '../js/widgets/plan-set-callouts/fiber-notes.js';
import { groupSpanMembers, spanTargetKey } from '../js/widgets/plan-set-callouts/span-grouping.js';
import { pickKeyNotesTableRect } from '../js/widgets/plan-set-callouts/pdf-callouts.js';
import {
    addManualLeader,
    createFiberCalloutSession,
    enableOrAddLeader,
    generateFiberCallouts,
    moveLeaderBubble,
    restoreFiberCalloutSession,
    serializeFiberCalloutSession,
    setLeaderEnabled,
    suppressLeader
} from '../js/widgets/plan-set-callouts/fiber-callout-engine.js';
import {
    distanceFeet,
    findCoveringInset,
    leadersForSheet,
    MIN_BUBBLE_SEPARATION_FT,
    notesUsedOnSheet
} from '../js/widgets/plan-set-callouts/leader-placement.js';
import {
    createCalloutSession,
    loadDefaultCalloutProfile,
    serializeCalloutSession,
    restoreCalloutSession
} from '../js/widgets/plan-set-callouts/engine.js';

globalThis.turf = turf;

const routeLine = {
    type: 'Feature',
    geometry: {
        type: 'LineString',
        coordinates: [
            [-111.90, 40.75],
            [-111.88, 40.75]
        ]
    },
    properties: {}
};

const frame = {
    type: 'Feature',
    properties: { sheet_id: 's1', sheet_number: 1, feature_type: 'sheet_frame' },
    geometry: {
        type: 'Polygon',
        coordinates: [[
            [-111.91, 40.74],
            [-111.87, 40.74],
            [-111.87, 40.76],
            [-111.91, 40.76],
            [-111.91, 40.74]
        ]]
    }
};

const sheet = {
    sheetId: 's1',
    sheetNumber: 1,
    sheetType: 'detail',
    startDistanceFt: 0,
    endDistanceFt: 5000
};

function box(id, lng, lat, label) {
    return {
        type: 'Feature',
        id,
        properties: { OBJECTID: id, BOXLABELS: label, DT_RSCENCLOSURE_NAME: 'Type 2' },
        geometry: { type: 'Point', coordinates: [lng, lat] }
    };
}

function line(id, key, coords, labelField, label) {
    return {
        type: 'Feature',
        id,
        properties: { OBJECTID: id, [labelField]: label, _udotFiberKey: key },
        geometry: { type: 'LineString', coordinates: coords }
    };
}

describe('fiber callout notes', () => {
    it('uses GIS labels as-is', () => {
        expect(noteTextForFeature('conduit', { properties: { CustNameRight: '4 - 1" Innerduct' } }))
            .toBe('4 - 1" Innerduct');
        expect(noteTextForFeature('fiber', { properties: { Fiber_Label: 'UDOT 048 SMF' } }))
            .toBe('UDOT 048 SMF');
    });

    it('keeps stable numbers when the same text reappears', () => {
        const first = assignStableNoteNumbers([], ['Box A', 'UDOT 048 SMF']);
        const second = assignStableNoteNumbers(first, ['UDOT 048 SMF', 'Box B']);
        expect(first.find((note) => note.text === 'UDOT 048 SMF').number).toBe(2);
        expect(second.find((note) => note.text === 'UDOT 048 SMF').number).toBe(2);
        expect(second.find((note) => note.text === 'Box B').number).toBe(3);
    });
});

describe('span grouping', () => {
    const boxes = [
        box(10, -111.90, 40.75, 'A'),
        box(20, -111.88, 40.75, 'B'),
        box(30, -111.88, 40.751, 'C')
    ];

    it('groups coincident conduit and fiber between the same boxes', () => {
        const conduit = line(1, 'conduit', [[-111.90, 40.75], [-111.88, 40.75]], 'CustNameRight', '4D');
        const fiber = line(2, 'fiber', [[-111.90, 40.75], [-111.88, 40.75]], 'Fiber_Label', 'UDOT 048 SMF');
        const groups = groupSpanMembers([conduit, fiber], boxes);
        expect(groups.size).toBe(1);
        expect([...groups.values()][0]).toHaveLength(2);
    });

    it('keeps split laterals as separate spans', () => {
        const trunk = line(1, 'conduit', [[-111.90, 40.75], [-111.88, 40.75]], 'CustNameRight', '4D');
        const lateral = line(3, 'conduit', [[-111.88, 40.75], [-111.88, 40.751]], 'CustNameRight', '1D');
        expect(spanTargetKey(trunk, boxes)).not.toBe(spanTargetKey(lateral, boxes));
        const groups = groupSpanMembers([trunk, lateral], boxes);
        expect(groups.size).toBe(2);
    });
});

describe('fiber callout generate', () => {
    beforeEach(() => resetIdSequence());

    const features = {
        boxes: [
            box(10, -111.90, 40.75, 'JB-A'),
            box(20, -111.88, 40.75, 'JB-B')
        ],
        splices: [{
            type: 'Feature',
            id: 99,
            properties: { OBJECTID: 99, NAME: 'SPL-1', MODEL: 'UDOT SPEC' },
            geometry: { type: 'Point', coordinates: [-111.89, 40.75] }
        }],
        conduit: [
            line(1, 'conduit', [[-111.90, 40.75], [-111.88, 40.75]], 'CustNameRight', '4D'),
            line(1, 'conduit', [[-111.90, 40.75], [-111.88, 40.75]], 'CustNameRight', '4D')
        ],
        fiber: [
            line(2, 'fiber', [[-111.90, 40.75], [-111.88, 40.75]], 'Fiber_Label', 'UDOT 048 SMF')
        ],
        cabinets: [{
            type: 'Feature',
            id: 5,
            properties: { OBJECTID: 5, NAME_ADDRESS: 'Cabinet 1' },
            geometry: { type: 'Point', coordinates: [-111.895, 40.75] }
        }],
        building: []
    };

    it('discovers boxes, splices, and one span leader but leaves them off', () => {
        let session = createFiberCalloutSession({ projectName: 'Callout Test' });
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        expect(session.leaders.some((leader) => leader.targetKey === pointTargetKey('boxes', '10'))).toBe(true);
        expect(session.leaders.some((leader) => leader.targetKey === pointTargetKey('splices', '99'))).toBe(true);
        expect(session.leaders.some((leader) => leader.targetKind === 'span')).toBe(true);
        expect(session.leaders.some((leader) => String(leader.targetKey).includes('cabinets'))).toBe(false);
        expect(session.leaders.every((leader) => leader.suppressed || leader.enabled === false)).toBe(true);
        expect(notesUsedOnSheet(session, 's1')).toEqual([]);
        const span = session.leaders.find((leader) => leader.targetKind === 'span');
        expect(span.noteIds.length).toBeGreaterThanOrEqual(2);
    });

    it('turns a callout on and keeps the sheet table in sync', () => {
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        const boxLeader = session.leaders.find((leader) => leader.targetKey === pointTargetKey('boxes', '10'));
        session = setLeaderEnabled(session, boxLeader.leaderKey, true);
        const table = notesUsedOnSheet(session, 's1');
        expect(table.some((note) => note.text === 'JB-A')).toBe(true);
        expect(leadersForSheet(session, 's1')).toHaveLength(1);
        session = setLeaderEnabled(session, boxLeader.leaderKey, false);
        expect(notesUsedOnSheet(session, 's1')).toEqual([]);
    });

    it('keeps enable + note numbers across regenerate', () => {
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        const boxLeader = session.leaders.find((leader) => leader.targetKey === pointTargetKey('boxes', '10'));
        const boxNote = session.notes.find((note) => note.text === 'JB-A');
        session = setLeaderEnabled(session, boxLeader.leaderKey, true);
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        expect(session.leaders.some((leader) => (
            leader.targetKey === pointTargetKey('boxes', '10') && !leader.suppressed && leader.enabled !== false
        ))).toBe(true);
        expect(session.notes.find((note) => note.text === 'JB-A').number).toBe(boxNote.number);
        session = suppressLeader(session, boxLeader.leaderKey);
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        expect(session.leaders.some((leader) => (
            leader.targetKey === pointTargetKey('boxes', '10') && !leader.suppressed && leader.enabled !== false
        ))).toBe(false);
    });

    it('serializes a fiber session without breaking legacy restore', () => {
        let session = createFiberCalloutSession({ projectName: 'Persist' });
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        const bundle = serializeFiberCalloutSession(session);
        const restored = restoreFiberCalloutSession(bundle);
        expect(restored.project.projectName).toBe('Persist');
        expect(restored.leaders.length).toBe(session.leaders.length);
        expect(Array.isArray(restored.overrides.enabledLeaderKeys)).toBe(true);

        let legacy = createCalloutSession({ projectName: 'Legacy' });
        legacy = loadDefaultCalloutProfile(legacy);
        const legacyBundle = serializeCalloutSession(legacy);
        const legacyRestored = restoreCalloutSession(legacyBundle);
        expect(legacyRestored.callouts.definitions.length).toBeGreaterThan(0);
    });

    it('adds a manual leader with a shared note number', () => {
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        const existing = session.notes.find((note) => note.text === 'JB-A');
        session = addManualLeader(session, {
            sheetId: 's1',
            text: 'JB-A',
            anchor: [-111.889, 40.7505]
        });
        const manual = session.leaders.find((leader) => leader.source === 'manual');
        expect(manual.noteIds).toContain(existing.noteId);
        expect(manual.enabled).toBe(true);
        expect(notesUsedOnSheet(session, 's1').some((note) => note.text === 'JB-A')).toBe(true);
    });

    it('separates nearby bubbles and keeps dragged positions', () => {
        const closeFeatures = {
            ...features,
            boxes: [
                box(10, -111.90, 40.75, 'JB-A'),
                box(11, -111.90004, 40.75002, 'JB-B')
            ]
        };
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features: closeFeatures
        });
        const a = session.leaders.find((leader) => leader.targetKey === pointTargetKey('boxes', '10'));
        const b = session.leaders.find((leader) => leader.targetKey === pointTargetKey('boxes', '11'));
        expect(distanceFeet(a.bubble, b.bubble)).toBeGreaterThanOrEqual(MIN_BUBBLE_SEPARATION_FT - 1);
        expect(distanceFeet(a.bubble, a.anchor)).toBeGreaterThan(MIN_BUBBLE_SEPARATION_FT / 2);
        session = setLeaderEnabled(session, a.leaderKey, true);
        session = moveLeaderBubble(session, a.leaderKey, [-111.895, 40.752]);
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features: closeFeatures
        });
        const moved = session.leaders.find((leader) => leader.leaderKey === a.leaderKey);
        expect(moved.bubble[0]).toBeCloseTo(-111.895, 5);
        expect(moved.bubble[1]).toBeCloseTo(40.752, 5);
        expect(moved.anchor).toEqual(a.anchor);
    });

    it('hides corridor callouts inside a detail box and lists them on the inset', () => {
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        const boxLeader = session.leaders.find((leader) => leader.targetKey === pointTargetKey('boxes', '10'));
        session = setLeaderEnabled(session, boxLeader.leaderKey, true);
        const insetView = {
            insetId: 'inset-a',
            label: 'A',
            parentSheetId: 's1',
            bbox: [-111.901, 40.749, -111.899, 40.751],
            geometry: turf.bboxPolygon([-111.901, 40.749, -111.899, 40.751]).geometry
        };
        expect(findCoveringInset(boxLeader, [insetView])?.insetId).toBe('inset-a');
        expect(leadersForSheet(session, 's1', { insetViews: [insetView], page: 'corridor' })).toHaveLength(0);
        expect(notesUsedOnSheet(session, 's1', { insetViews: [insetView], page: 'corridor' })).toEqual([]);
        const insetLeaders = leadersForSheet(session, 's1', {
            insetViews: [insetView],
            insetView,
            page: 'inset'
        });
        expect(insetLeaders).toHaveLength(1);
        expect(notesUsedOnSheet(session, 's1', {
            insetViews: [insetView],
            insetView,
            page: 'inset'
        }).some((note) => note.text === 'JB-A')).toBe(true);
    });

    it('turns on an existing discovered leader instead of duplicating it', () => {
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        const boxLeader = session.leaders.find((leader) => leader.targetKey === pointTargetKey('boxes', '10'));
        session = enableOrAddLeader(session, { targetKey: boxLeader.targetKey, text: 'JB-A', anchor: boxLeader.anchor });
        expect(session.leaders.filter((leader) => leader.targetKey === boxLeader.targetKey)).toHaveLength(1);
        expect(session.leaders.find((leader) => leader.leaderKey === boxLeader.leaderKey).enabled).toBe(true);
    });
});

describe('key notes table placement', () => {
    it('stays above the footer and prefers a corner outside the gold cut', () => {
        const goldPdfRing = [
            { x: 200, y: 80 },
            { x: 700, y: 80 },
            { x: 700, y: 400 },
            { x: 200, y: 400 }
        ];
        const rect = pickKeyNotesTableRect({
            pageW: 792,
            pageH: 612,
            marginsPt: { left: 36, right: 36, top: 36, bottom: 36 },
            footerReservePt: 50,
            goldPdfRing,
            tableW: 160,
            tableH: 90
        });
        expect(rect.y + rect.height).toBeLessThan(612 - 50);
        expect(rect.x).toBeLessThan(200);
    });
});
