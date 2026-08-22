import * as turf from '@turf/turf';
import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdSequence } from '../js/plan-project/id-utils.js';
import { assignStableNoteNumbers, noteTextForFeature, pointTargetKey } from '../js/widgets/plan-set-callouts/fiber-notes.js';
import { groupSpanMembers, spanTargetKey } from '../js/widgets/plan-set-callouts/span-grouping.js';
import { pickKeyNotesTableRect } from '../js/widgets/plan-set-callouts/pdf-callouts.js';
import {
    addManualLeader,
    createFiberCalloutSession,
    generateFiberCallouts,
    restoreFiberCalloutSession,
    serializeFiberCalloutSession,
    suppressLeader
} from '../js/widgets/plan-set-callouts/fiber-callout-engine.js';
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

    it('auto-places boxes, splices, and one span leader; skips cabinets', () => {
        let session = createFiberCalloutSession({ projectName: 'Callout Test' });
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        const active = session.leaders.filter((leader) => !leader.suppressed);
        expect(active.some((leader) => leader.targetKey === pointTargetKey('boxes', '10'))).toBe(true);
        expect(active.some((leader) => leader.targetKey === pointTargetKey('splices', '99'))).toBe(true);
        expect(active.some((leader) => leader.targetKind === 'span')).toBe(true);
        expect(active.some((leader) => String(leader.targetKey).includes('cabinets'))).toBe(false);
        const span = active.find((leader) => leader.targetKind === 'span');
        expect(span.noteIds.length).toBeGreaterThanOrEqual(2);
    });

    it('keeps suppress + note numbers across regenerate', () => {
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        const boxLeader = session.leaders.find((leader) => leader.targetKey === pointTargetKey('boxes', '10'));
        const boxNote = session.notes.find((note) => note.text === 'JB-A');
        session = suppressLeader(session, boxLeader.leaderKey);
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        expect(session.leaders.some((leader) => (
            leader.targetKey === pointTargetKey('boxes', '10') && !leader.suppressed
        ))).toBe(false);
        expect(session.notes.find((note) => note.text === 'JB-A').number).toBe(boxNote.number);
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
