import * as turf from '@turf/turf';
import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdSequence } from '../js/plan-project/id-utils.js';
import {
    assignStableNoteNumbers,
    compareCalloutNotes,
    formatCalloutLabel,
    noteTextForFeature,
    pointTargetKey
} from '../js/widgets/plan-set-callouts/fiber-notes.js';
import {
    filterLinesForCollapsedView,
    groupSpanMembers,
    isCarrierLineFeature,
    isInnerDuctFeature,
    pickSpanRepresentative,
    spanMemberKey,
    spanTargetKey
} from '../js/widgets/plan-set-callouts/span-grouping.js';
import {
    isLeaderOn,
    labelForLeader,
    leaderMatchesFeature,
    leadersMatchingFeature,
    sheetIdForCoordinate
} from '../js/widgets/plan-set-callouts/callout-targets.js';
import {
    getCalloutSelectionItems,
    getPlanSetCalloutMenuItems,
    setPlanSetCalloutMenuContext
} from '../js/widgets/plan-set-callouts/context-menu-bridge.js';
import { SHEET_FIBER_SNAPSHOT_FORMAT } from '../js/symbology/udot-fiber/constants.js';
import {
    CALLOUT_PDF_CIRCLE_GAP,
    CALLOUT_PDF_CIRCLE_R,
    calloutBubbleCenters,
    constrainCalloutCluster,
    drawSheetCalloutsOnPdf,
    pickKeyNotesTableRect,
    shouldDrawCalloutsOnPdfPage
} from '../js/widgets/plan-set-callouts/pdf-callouts.js';
import {
    CALLOUT_MAP_CIRCLE_GAP_PX,
    CALLOUT_MAP_CIRCLE_RADIUS_PX,
    CALLOUT_PX_PER_PT,
    CALLOUT_STROKE_RGB,
    CALLOUT_TEXT_RGB
} from '../js/widgets/plan-set-callouts/callout-style.js';
import { suspendCalloutPreview } from '../js/widgets/plan-set-callouts/preview.js';
import {
    canAdvanceCalloutStep,
    isCalloutPrimaryActionDisabled
} from '../js/widgets/plan-set-callouts/wizard-state.js';
import {
    addManualLeader,
    createFiberCalloutSession,
    enableOrAddLeader,
    generateFiberCallouts,
    moveLeaderBubble,
    restoreFiberCalloutSession,
    serializeFiberCalloutSession,
    setLeaderEnabled,
    setLeadersEnabledForFeatures,
    suppressLeader
} from '../js/widgets/plan-set-callouts/fiber-callout-engine.js';
import {
    buildCalloutPreviewGeoJson,
    coordinateInSheet,
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

    it('reuses numbers per UDOT layer type and prefixes labels', () => {
        const notes = assignStableNoteNumbers([], [
            { text: 'UDOT 048 SMF', fiberKey: 'fiber' },
            { text: 'JB-A', fiberKey: 'boxes' },
            { text: '4D', fiberKey: 'conduit' },
            { text: 'SPL-1', fiberKey: 'splices' },
            { text: 'See detail' }
        ]);
        expect(formatCalloutLabel(notes.find((note) => note.fiberKey === 'fiber'))).toBe('F1');
        expect(formatCalloutLabel(notes.find((note) => note.fiberKey === 'boxes'))).toBe('B1');
        expect(formatCalloutLabel(notes.find((note) => note.fiberKey === 'conduit'))).toBe('D1');
        expect(formatCalloutLabel(notes.find((note) => note.fiberKey === 'splices'))).toBe('S1');
        expect(formatCalloutLabel(notes.find((note) => note.text === 'See detail'))).toBe('1');
        expect([...notes].sort(compareCalloutNotes).map((note) => formatCalloutLabel(note)))
            .toEqual(['F1', 'B1', 'D1', 'S1', '1']);
    });

    it('keeps per-type numbers when the same typed text reappears', () => {
        const first = assignStableNoteNumbers([], [
            { text: 'JB-A', fiberKey: 'boxes' },
            { text: 'UDOT 048 SMF', fiberKey: 'fiber' }
        ]);
        const second = assignStableNoteNumbers(first, [
            { text: 'UDOT 048 SMF', fiberKey: 'fiber' },
            { text: 'JB-B', fiberKey: 'boxes' }
        ]);
        expect(second.find((note) => note.text === 'UDOT 048 SMF').number).toBe(1);
        expect(second.find((note) => note.text === 'UDOT 048 SMF').fiberKey).toBe('fiber');
        expect(second.find((note) => note.text === 'JB-B').number).toBe(2);
        expect(formatCalloutLabel(second.find((note) => note.text === 'JB-B'))).toBe('B2');
    });

    it('remints unprefixed auto notes into typed labels and keeps manual extras', () => {
        const next = assignStableNoteNumbers([
            { noteId: 'note-7', number: 7, text: 'JB-A', source: 'auto' },
            { noteId: 'note-3', number: 3, text: 'See detail', source: 'manual' }
        ], [
            { text: 'JB-A', fiberKey: 'boxes' },
            { text: 'See detail' }
        ]);
        expect(formatCalloutLabel(next.find((note) => note.text === 'JB-A'))).toBe('B1');
        expect(next.filter((note) => note.text === 'JB-A')).toHaveLength(1);
        expect(next.find((note) => note.text === 'See detail').number).toBe(3);
        expect(formatCalloutLabel(next.find((note) => note.text === 'See detail'))).toBe('3');
    });

    it('sorts key notes Fiber, Box, Conduit, Splice, then plain numbers', () => {
        const table = notesUsedOnSheet({
            notes: [
                { noteId: 'n1', number: 1, text: 'See detail' },
                { noteId: 'n2', number: 1, text: 'JB-A', fiberKey: 'boxes' },
                { noteId: 'n3', number: 1, text: 'UDOT 048 SMF', fiberKey: 'fiber' },
                { noteId: 'n4', number: 1, text: '4D', fiberKey: 'conduit' },
                { noteId: 'n5', number: 1, text: 'SPL-1', fiberKey: 'splices' }
            ],
            leaders: [{
                sheetId: 's1',
                noteIds: ['n1', 'n2', 'n3', 'n4', 'n5'],
                suppressed: false,
                enabled: true
            }]
        }, 's1');
        expect(table.map((note) => formatCalloutLabel(note))).toEqual(['F1', 'B1', 'D1', 'S1', '1']);
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

    it('treats IMD as contents and counted innerduct banks as carriers', () => {
        expect(isInnerDuctFeature({
            properties: { _udotFiberKey: 'conduit', CONDUIT_SYM: 'MicroDuct', CustNameRight: '2 IMD 10mm' }
        })).toBe(true);
        expect(isInnerDuctFeature({
            properties: { _udotFiberKey: 'conduit', CustNameRight: '4 - 1" Innerduct' }
        })).toBe(false);
        expect(isCarrierLineFeature({
            properties: { _udotFiberKey: 'conduit', CustNameRight: '4D' }
        })).toBe(true);
        expect(isCarrierLineFeature({
            properties: { _udotFiberKey: 'fiber', Fiber_Label: 'UDOT 048 SMF' }
        })).toBe(false);
    });

    it('groups a 1D bank that stops at a split with IMD and fiber as one span', () => {
        const split = [-111.89, 40.75];
        const bankBoxes = [box(10, -111.90, 40.75, 'A'), box(20, -111.88, 40.75, 'B')];
        const bank = [
            line(1, 'conduit', [[-111.90, 40.75], split], 'CustNameRight', '1D'),
            line(2, 'conduit', [[-111.90, 40.75], split], 'CustNameRight', '1D'),
            line(3, 'conduit', [[-111.90, 40.75], split], 'CustNameRight', '1D'),
            line(4, 'conduit', [[-111.90, 40.75], split], 'CustNameRight', '1D')
        ];
        const imd = {
            type: 'Feature',
            id: 50,
            properties: {
                OBJECTID: 50,
                CONDUIT_SYM: 'MicroDuct',
                CustNameRight: '1 IMD 10mm',
                _udotFiberKey: 'conduit'
            },
            geometry: { type: 'LineString', coordinates: [[-111.90, 40.75], split] }
        };
        const fiber = line(60, 'fiber', [[-111.90, 40.75], split], 'Fiber_Label', 'microfiber');
        const groups = groupSpanMembers([...bank, imd, fiber], bankBoxes);
        expect(groups.size).toBe(1);
        expect([...groups.values()][0]).toHaveLength(6);
    });

    it('keeps four stubs as four spans and attaches IMD plus fiber to one stub', () => {
        const split = [-111.89, 40.75];
        const stubBoxes = [
            box(20, -111.88, 40.75, 'B'),
            box(30, -111.89, 40.751, 'C'),
            box(40, -111.89, 40.749, 'D'),
            box(50, -111.889, 40.7508, 'E')
        ];
        const stubB = line(11, 'conduit', [split, [-111.88, 40.75]], 'CustNameRight', '1"');
        const stubC = line(12, 'conduit', [split, [-111.89, 40.751]], 'CustNameRight', '1"');
        const stubD = line(13, 'conduit', [split, [-111.89, 40.749]], 'CustNameRight', '1"');
        const stubE = line(14, 'conduit', [split, [-111.889, 40.7508]], 'CustNameRight', '1"');
        const imd = {
            type: 'Feature',
            id: 51,
            properties: {
                OBJECTID: 51,
                CONDUIT_SYM: 'MicroDuct',
                CustNameRight: '1 IMD 10mm',
                _udotFiberKey: 'conduit'
            },
            geometry: { type: 'LineString', coordinates: [split, [-111.88, 40.75]] }
        };
        const fiber = line(61, 'fiber', [split, [-111.88, 40.75]], 'Fiber_Label', 'microfiber');
        const groups = groupSpanMembers([stubB, stubC, stubD, stubE, imd, fiber], stubBoxes);
        expect(groups.size).toBe(4);
        const stubBGroup = [...groups.values()].find((members) => (
            members.some((feature) => String(feature.id) === '11')
        ));
        expect(stubBGroup).toHaveLength(3);
        expect(stubBGroup.some((feature) => feature.properties.CONDUIT_SYM === 'MicroDuct')).toBe(true);
        expect(stubBGroup.some((feature) => feature.properties._udotFiberKey === 'fiber')).toBe(true);
    });

    it('picks a carrier as the collapsed representative, not IMD or fiber', () => {
        const bank = line(1, 'conduit', [[-111.90, 40.75], [-111.88, 40.75]], 'CustNameRight', '1D');
        const imd = {
            type: 'Feature',
            id: 50,
            properties: {
                OBJECTID: 50,
                CONDUIT_SYM: 'MicroDuct',
                CustNameRight: '1 IMD 10mm',
                _udotFiberKey: 'conduit'
            },
            geometry: { type: 'LineString', coordinates: [[-111.90, 40.75], [-111.88, 40.75]] }
        };
        const fiber = line(60, 'fiber', [[-111.90, 40.75], [-111.88, 40.75]], 'Fiber_Label', 'microfiber');
        const representative = pickSpanRepresentative([imd, fiber, bank]);
        expect(representative).toBe(bank);
        expect(spanMemberKey(bank)).toBe('conduit:1');
    });

    it('collapses a 1D bank plus contents to one line and keeps four split stubs', () => {
        const split = [-111.89, 40.75];
        const boxesForCollapse = [
            box(10, -111.90, 40.75, 'A'),
            box(20, -111.88, 40.75, 'B'),
            box(30, -111.89, 40.751, 'C'),
            box(40, -111.89, 40.749, 'D'),
            box(50, -111.889, 40.7508, 'E')
        ];
        const bank = [
            line(1, 'conduit', [[-111.90, 40.75], split], 'CustNameRight', '1D'),
            line(2, 'conduit', [[-111.90, 40.75], split], 'CustNameRight', '1D'),
            line(3, 'conduit', [[-111.90, 40.75], split], 'CustNameRight', '1D'),
            line(4, 'conduit', [[-111.90, 40.75], split], 'CustNameRight', '1D')
        ];
        const bankImd = {
            type: 'Feature',
            id: 50,
            properties: {
                OBJECTID: 50,
                CONDUIT_SYM: 'MicroDuct',
                CustNameRight: '1 IMD 10mm',
                _udotFiberKey: 'conduit'
            },
            geometry: { type: 'LineString', coordinates: [[-111.90, 40.75], split] }
        };
        const bankFiber = line(60, 'fiber', [[-111.90, 40.75], split], 'Fiber_Label', 'microfiber');
        const stubs = [
            line(11, 'conduit', [split, [-111.88, 40.75]], 'CustNameRight', '1"'),
            line(12, 'conduit', [split, [-111.89, 40.751]], 'CustNameRight', '1"'),
            line(13, 'conduit', [split, [-111.89, 40.749]], 'CustNameRight', '1"'),
            line(14, 'conduit', [split, [-111.889, 40.7508]], 'CustNameRight', '1"')
        ];
        const stubImd = {
            type: 'Feature',
            id: 51,
            properties: {
                OBJECTID: 51,
                CONDUIT_SYM: 'MicroDuct',
                CustNameRight: '1 IMD 10mm',
                _udotFiberKey: 'conduit'
            },
            geometry: { type: 'LineString', coordinates: [split, [-111.88, 40.75]] }
        };
        const stubFiber = line(61, 'fiber', [split, [-111.88, 40.75]], 'Fiber_Label', 'microfiber');
        const allLines = [...bank, bankImd, bankFiber, ...stubs, stubImd, stubFiber];
        expect(filterLinesForCollapsedView(allLines, boxesForCollapse)).toHaveLength(allLines.length);

        const collapsed = filterLinesForCollapsedView(allLines, boxesForCollapse, { collapsed: true });
        const ids = collapsed.map((feature) => String(feature.id)).sort();
        expect(collapsed).toHaveLength(5);
        expect(ids.filter((id) => ['1', '2', '3', '4'].includes(id))).toHaveLength(1);
        expect(ids).toEqual(expect.arrayContaining(['11', '12', '13', '14']));
        expect(ids).not.toContain('50');
        expect(ids).not.toContain('51');
        expect(ids).not.toContain('60');
        expect(ids).not.toContain('61');
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
        expect(session.leaders.every((leader) => leader.sheetNumber === 1)).toBe(true);
        expect(session.leaders.some((leader) => leader.targetKey === pointTargetKey('splices', '99'))).toBe(true);
        expect(session.leaders.some((leader) => leader.targetKind === 'span')).toBe(true);
        expect(session.leaders.some((leader) => String(leader.targetKey).includes('cabinets'))).toBe(false);
        expect(session.leaders.every((leader) => leader.suppressed || leader.enabled === false)).toBe(true);
        expect(notesUsedOnSheet(session, 's1')).toEqual([]);
        const span = session.leaders.find((leader) => leader.targetKind === 'span');
        expect(span.noteIds.length).toBeGreaterThanOrEqual(2);
        expect(formatCalloutLabel(session.notes.find((note) => note.text === 'JB-A'))).toBe('B1');
        expect(formatCalloutLabel(session.notes.find((note) => note.text === 'SPL-1'))).toBe('S1');
        expect(formatCalloutLabel(session.notes.find((note) => note.text === '4D'))).toBe('D1');
        expect(formatCalloutLabel(session.notes.find((note) => note.text === 'UDOT 048 SMF'))).toBe('F1');
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

    it('keeps numbered bubbles inside the cut sheet polygon', () => {
        const smallFrame = {
            type: 'Feature',
            properties: { sheet_id: 's1', sheet_number: 1, feature_type: 'sheet_frame' },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-111.9004, 40.7498],
                    [-111.8996, 40.7498],
                    [-111.8996, 40.7502],
                    [-111.9004, 40.7502],
                    [-111.9004, 40.7498]
                ]]
            }
        };
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [smallFrame] },
            features: {
                boxes: [box(10, -111.8997, 40.75, 'JB-EDGE')],
                splices: [],
                conduit: [],
                fiber: [],
                cabinets: [],
                building: []
            }
        });
        const leader = session.leaders.find((entry) => entry.targetKey === pointTargetKey('boxes', '10'));
        expect(leader).toBeTruthy();
        expect(turf.booleanPointInPolygon(turf.point(leader.bubble), smallFrame)).toBe(true);
        expect(coordinateInSheet(leader.bubble, smallFrame.geometry)).toBe(true);
    });

    it('clamps a dragged bubble back onto the same sheet', () => {
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        const boxLeader = session.leaders.find((leader) => leader.targetKey === pointTargetKey('boxes', '10'));
        session = moveLeaderBubble(session, boxLeader.leaderKey, [-111.93, 40.80]);
        const moved = session.leaders.find((leader) => leader.leaderKey === boxLeader.leaderKey);
        expect(turf.booleanPointInPolygon(turf.point(moved.bubble), frame)).toBe(true);
        expect(coordinateInSheet(moved.bubble, frame.geometry)).toBe(true);
    });

    it('stacks map bubbles at the same geographic point', () => {
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features
        });
        const span = session.leaders.find((leader) => leader.targetKind === 'span');
        session = setLeaderEnabled(session, span.leaderKey, true);
        const geo = buildCalloutPreviewGeoJson(session);
        const bubbles = geo.features.filter((feature) => feature.properties.feature_type === 'callout_bubble');
        expect(bubbles.length).toBeGreaterThanOrEqual(2);
        expect(bubbles[0].geometry.coordinates).toEqual(bubbles[1].geometry.coordinates);
        expect(bubbles.map((feature) => feature.properties.stack_index).slice(0, 2)).toEqual([0, 1]);
        expect(bubbles.map((feature) => feature.properties.callout_number)).toEqual(
            expect.arrayContaining(['D1', 'F1'])
        );
    });
});

describe('key notes table placement', () => {
    it('stays in white space outside the gold cut and above the footer', () => {
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
            tableW: 140,
            tableH: 90,
            reserveNorthArrow: false
        });
        expect(rect).toBeTruthy();
        expect(rect.y + rect.height).toBeLessThan(612 - 50);
        const overlapsGold = !(
            rect.x + rect.width <= 200
            || 700 <= rect.x
            || rect.y + rect.height <= 80
            || 400 <= rect.y
        );
        expect(overlapsGold).toBe(false);
    });
});

describe('callout wizard done button', () => {
    it('keeps Done enabled on the last step', () => {
        expect(canAdvanceCalloutStep(3, {
            projectName: 'Fiber',
            hasSheetSession: true,
            hasLeaders: true
        })).toBe(true);
        expect(isCalloutPrimaryActionDisabled({ busy: false, canAdvance: true })).toBe(false);
        expect(isCalloutPrimaryActionDisabled({ busy: true, canAdvance: true })).toBe(true);
    });
});

describe('pdf callout overlay', () => {
    function mockDoc() {
        const calls = [];
        const rec = (name) => (...args) => { calls.push({ name, args }); };
        return {
            calls,
            setDrawColor: rec('setDrawColor'),
            setLineWidth: rec('setLineWidth'),
            setFillColor: rec('setFillColor'),
            setFont: rec('setFont'),
            setFontSize: rec('setFontSize'),
            setTextColor: rec('setTextColor'),
            line: rec('line'),
            circle: rec('circle'),
            rect: rec('rect'),
            text: rec('text'),
            internal: { pageSize: { getWidth: () => 792, getHeight: () => 612 } }
        };
    }

    function twoNumberSession(withPrefixes = false) {
        return {
            notes: [
                { noteId: 'n1', number: 1, text: 'JB-A', ...(withPrefixes ? { fiberKey: 'boxes' } : {}) },
                { noteId: 'n2', number: 2, text: 'UDOT 048 SMF', ...(withPrefixes ? { fiberKey: 'fiber' } : {}) }
            ],
            leaders: [{
                leaderId: 's1::span',
                leaderKey: 's1::span',
                sheetId: 's1',
                sheetNumber: 1,
                noteIds: ['n1', 'n2'],
                anchor: [-111.90, 40.75],
                bubble: [-111.899, 40.751],
                suppressed: false
            }],
            sheets: [sheet]
        };
    }

    it('skips overview and DETAILS pages', () => {
        expect(shouldDrawCalloutsOnPdfPage('overview')).toBe(false);
        expect(shouldDrawCalloutsOnPdfPage('inset')).toBe(false);
        expect(shouldDrawCalloutsOnPdfPage('detail')).toBe(true);
        const doc = mockDoc();
        drawSheetCalloutsOnPdf(doc, {
            session: twoNumberSession(),
            sheetId: 's1',
            pageType: 'overview'
        });
        expect(doc.calls).toHaveLength(0);
    });

    it('draws stacked numbers tightly and still writes PROJECT KEY NOTES if leaders fail to project', () => {
        expect(CALLOUT_PDF_CIRCLE_GAP).toBeLessThan(CALLOUT_PDF_CIRCLE_R * 2 + 1);
        const centers = calloutBubbleCenters({ x: 100, y: 80 }, 3);
        expect(centers[1].x - centers[0].x).toBeCloseTo(CALLOUT_PDF_CIRCLE_GAP, 5);
        expect(centers[2].x - centers[1].x).toBeCloseTo(CALLOUT_PDF_CIRCLE_GAP, 5);

        const doc = mockDoc();
        drawSheetCalloutsOnPdf(doc, {
            session: twoNumberSession(),
            sheet: { sheetId: 's1', sheetNumber: 1 },
            pageType: 'detail',
            map: {},
            transform: {
                projectLngLat: () => {
                    throw new Error('project failed');
                }
            },
            layoutMargins: { left: 36, right: 36, top: 36, bottom: 36 },
            pageW: 792,
            pageH: 612
        });
        expect(doc.calls.some((call) => call.name === 'text' && call.args[0] === 'PROJECT KEY NOTES')).toBe(true);
        expect(doc.calls.some((call) => call.name === 'text' && String(call.args[0]).includes('JB-A'))).toBe(true);
    });

    it('draws crisp vector circles with the tighter gap when projection works', () => {
        const doc = mockDoc();
        drawSheetCalloutsOnPdf(doc, {
            session: twoNumberSession(),
            sheetId: 's1',
            pageType: 'detail',
            map: {},
            transform: {
                projectLngLat: (_map, lng, lat) => ({ x: Math.abs(lng) * 10, y: lat * 10 })
            },
            layoutMargins: { left: 36, right: 36, top: 36, bottom: 36 },
            pageW: 792,
            pageH: 612
        });
        const leaderCircles = doc.calls.filter((call) => call.name === 'circle').slice(0, 2);
        expect(leaderCircles[0].args[2]).toBe(CALLOUT_PDF_CIRCLE_R);
        expect(leaderCircles[1].args[0] - leaderCircles[0].args[0]).toBeCloseTo(CALLOUT_PDF_CIRCLE_GAP, 5);
        expect(doc.calls.some((call) => call.name === 'line')).toBe(true);
        expect(doc.calls.some((call) => (
            call.name === 'setDrawColor'
            && call.args[0] === CALLOUT_STROKE_RGB[0]
            && call.args[1] === CALLOUT_STROKE_RGB[1]
            && call.args[2] === CALLOUT_STROKE_RGB[2]
        ))).toBe(true);
        expect(doc.calls.filter((call) => call.name === 'setTextColor').every((call) => (
            call.args[0] === CALLOUT_TEXT_RGB[0]
            && call.args[1] === CALLOUT_TEXT_RGB[1]
            && call.args[2] === CALLOUT_TEXT_RGB[2]
        ))).toBe(true);
    });

    it('draws prefixed UDOT labels in circles and key notes', () => {
        const doc = mockDoc();
        drawSheetCalloutsOnPdf(doc, {
            session: twoNumberSession(true),
            sheetId: 's1',
            pageType: 'detail',
            map: {},
            transform: {
                projectLngLat: (_map, lng, lat) => ({ x: Math.abs(lng) * 10, y: lat * 10 })
            },
            layoutMargins: { left: 36, right: 36, top: 36, bottom: 36 },
            pageW: 792,
            pageH: 612
        });
        const labels = doc.calls.filter((call) => call.name === 'text').map((call) => call.args[0]);
        expect(labels).toEqual(expect.arrayContaining(['B1', 'F2', 'PROJECT KEY NOTES']));
    });

    it('matches map circle size to the PDF circle', () => {
        expect(CALLOUT_MAP_CIRCLE_RADIUS_PX).toBeCloseTo(CALLOUT_PDF_CIRCLE_R * CALLOUT_PX_PER_PT, 5);
        expect(CALLOUT_MAP_CIRCLE_GAP_PX).toBeCloseTo(CALLOUT_PDF_CIRCLE_GAP * CALLOUT_PX_PER_PT, 5);
    });

    it('pulls projected clusters back inside the gold sheet ring', () => {
        const goldPdfRing = [
            { x: 100, y: 100 },
            { x: 400, y: 100 },
            { x: 400, y: 300 },
            { x: 100, y: 300 }
        ];
        const clustered = constrainCalloutCluster({ x: 80, y: 80 }, 2, goldPdfRing);
        expect(clustered.origin.x).toBeGreaterThan(100);
        expect(clustered.origin.y).toBeGreaterThan(100);
        expect(clustered.origin.x).toBeLessThan(400);
        expect(clustered.origin.y).toBeLessThan(300);
    });

    it('matches leaders by sheet number when ids drifted', () => {
        const session = twoNumberSession();
        session.leaders[0].sheetId = 'old-s1';
        const found = leadersForSheet(session, { sheetId: 's1', sheetNumber: 1 });
        expect(found).toHaveLength(1);
    });
});

describe('callout preview capture hide', () => {
    it('hides leftover preview layers and restores them', () => {
        const vis = new Map([
            ['callout-preview-abc-circle', 'visible'],
            ['draw-callout-preview-1-line', 'visible']
        ]);
        const map = {
            getStyle: () => ({
                layers: [
                    { id: 'callout-preview-abc-circle' },
                    { id: 'draw-callout-preview-1-line' }
                ],
                sources: { 'callout-preview-abc': {} }
            }),
            getLayer: (id) => (vis.has(id) ? { id } : null),
            getLayoutProperty: (id, prop) => (prop === 'visibility' ? vis.get(id) : undefined),
            setLayoutProperty: (id, prop, value) => {
                if (prop === 'visibility') vis.set(id, value);
            }
        };
        const restore = suspendCalloutPreview({ getMap: () => map });
        expect(vis.get('callout-preview-abc-circle')).toBe('none');
        expect(vis.get('draw-callout-preview-1-line')).toBe('visible');
        restore();
        expect(vis.get('callout-preview-abc-circle')).toBe('visible');
    });
});

describe('callout target matching', () => {
    it('does not treat a box id inside a span key as a match', () => {
        const boxFeature = box(10, -111.90, 40.75, 'JB-A');
        boxFeature.properties._udotFiberKey = 'boxes';
        const spanLeader = {
            targetKey: 'span:box:10|box:20',
            targetKind: 'span',
            memberIds: ['1', '2'],
            sheetId: 's1'
        };
        const boxLeader = {
            targetKey: pointTargetKey('boxes', '10'),
            targetKind: 'boxes',
            memberIds: ['10'],
            sheetId: 's1'
        };
        expect(leaderMatchesFeature(spanLeader, boxFeature)).toBe(false);
        expect(leaderMatchesFeature(boxLeader, boxFeature)).toBe(true);
    });

    it('turns a span callout on from the collapsed representative carrier', () => {
        const conduit = line(1, 'conduit', [[-111.90, 40.75], [-111.88, 40.75]], 'CustNameRight', '4D');
        const fiber = line(2, 'fiber', [[-111.90, 40.75], [-111.88, 40.75]], 'Fiber_Label', 'UDOT 048 SMF');
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features: {
                boxes: [box(10, -111.90, 40.75, 'A'), box(20, -111.88, 40.75, 'B')],
                splices: [],
                conduit: [conduit],
                fiber: [fiber],
                cabinets: [],
                building: []
            }
        });
        const representative = pickSpanRepresentative([conduit, fiber]);
        expect(representative).toBe(conduit);
        const { session: next, changed } = setLeadersEnabledForFeatures(session, [representative], {
            enabled: true,
            sheetId: 's1'
        });
        expect(changed).toBe(1);
        const span = next.leaders.find((leader) => leader.targetKind === 'span' && isLeaderOn(leader));
        expect(span.memberIds).toEqual(expect.arrayContaining(['1', '2']));
        expect(span.noteIds.length).toBeGreaterThanOrEqual(2);
        expect(leaderMatchesFeature(span, conduit)).toBe(true);
        expect(leaderMatchesFeature(span, fiber)).toBe(true);
    });

    it('enables only the sheet under the click for a shared span', () => {
        const frameWest = {
            type: 'Feature',
            properties: { sheet_id: 's1', sheet_number: 1, feature_type: 'sheet_frame' },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-111.91, 40.74],
                    [-111.89, 40.74],
                    [-111.89, 40.76],
                    [-111.91, 40.76],
                    [-111.91, 40.74]
                ]]
            }
        };
        const frameEast = {
            type: 'Feature',
            properties: { sheet_id: 's2', sheet_number: 2, feature_type: 'sheet_frame' },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-111.89, 40.74],
                    [-111.87, 40.74],
                    [-111.87, 40.76],
                    [-111.89, 40.76],
                    [-111.89, 40.74]
                ]]
            }
        };
        const sheetEast = {
            sheetId: 's2',
            sheetNumber: 2,
            sheetType: 'detail',
            startDistanceFt: 2500,
            endDistanceFt: 5000
        };
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet, sheetEast],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frameWest, frameEast] },
            features: {
                boxes: [
                    box(10, -111.90, 40.75, 'JB-A'),
                    box(20, -111.88, 40.75, 'JB-B')
                ],
                splices: [],
                conduit: [
                    line(1, 'conduit', [[-111.90, 40.75], [-111.88, 40.75]], 'CustNameRight', '4D')
                ],
                fiber: [],
                cabinets: [],
                building: []
            }
        });
        const spans = session.leaders.filter((leader) => leader.targetKind === 'span');
        expect(spans.length).toBeGreaterThanOrEqual(2);
        const targetKey = spans[0].targetKey;
        expect(spans.every((leader) => leader.targetKey === targetKey)).toBe(true);
        session = enableOrAddLeader(session, {
            targetKey,
            text: '4D',
            anchor: [-111.875, 40.75]
        });
        const east = session.leaders.find((leader) => leader.sheetId === 's2' && leader.targetKind === 'span');
        const west = session.leaders.find((leader) => leader.sheetId === 's1' && leader.targetKind === 'span');
        expect(east.enabled).toBe(true);
        expect(west.enabled === false || west.suppressed).toBe(true);
        expect(sheetIdForCoordinate(session, [-111.875, 40.75])).toBe('s2');
    });

    it('turns on selected features only for matching leaders', () => {
        let session = createFiberCalloutSession();
        session = generateFiberCallouts(session, {
            sheets: [sheet],
            routeLine,
            frameFeatures: { type: 'FeatureCollection', features: [frame] },
            features: {
                boxes: [box(10, -111.90, 40.75, 'JB-A')],
                splices: [],
                conduit: [
                    line(1, 'conduit', [[-111.90, 40.75], [-111.88, 40.75]], 'CustNameRight', '4D')
                ],
                fiber: [],
                cabinets: [],
                building: []
            }
        });
        const conduit = {
            type: 'Feature',
            id: 1,
            properties: { OBJECTID: 1, _udotFiberKey: 'conduit' },
            geometry: { type: 'LineString', coordinates: [[-111.90, 40.75], [-111.88, 40.75]] }
        };
        const { session: next, changed } = setLeadersEnabledForFeatures(session, [conduit], {
            enabled: true
        });
        expect(changed).toBeGreaterThan(0);
        expect(next.leaders.some((leader) => leader.targetKind === 'span' && leader.enabled)).toBe(true);
        expect(labelForLeader(next, next.leaders.find((leader) => leader.targetKind === 'span'))).toContain('4D');
        expect(leadersMatchingFeature(next, conduit).length).toBeGreaterThan(0);
    });
});

describe('callout map menus', () => {
    const snapshotLayer = {
        id: 'snap-conduit',
        name: 'Sheets UDOT Conduit',
        source: { format: SHEET_FIBER_SNAPSHOT_FORMAT, fiberKey: 'conduit' },
        geojson: {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { _featureIndex: 0, OBJECTID: 1, _udotFiberKey: 'conduit' },
                geometry: { type: 'LineString', coordinates: [[-111.90, 40.75], [-111.88, 40.75]] }
            }]
        }
    };

    it('labels nearby overlapping targets instead of taking the first hit only', () => {
        const session = {
            selectedSheetId: 's1',
            sheets: [{ sheetId: 's1', sheetNumber: 1, frameGeometry: frame.geometry }],
            notes: [
                { noteId: 'note-1', number: 1, text: '1D' },
                { noteId: 'note-2', number: 2, text: 'JB-A' }
            ],
            leaders: [
                {
                    leaderKey: 's1::span:box:10|box:20',
                    leaderId: 's1::span:box:10|box:20',
                    sheetId: 's1',
                    targetKey: 'span:box:10|box:20',
                    targetKind: 'span',
                    memberIds: ['1'],
                    noteIds: ['note-1'],
                    suppressed: true,
                    enabled: false
                },
                {
                    leaderKey: 's1::boxes:10',
                    leaderId: 's1::boxes:10',
                    sheetId: 's1',
                    targetKey: pointTargetKey('boxes', '10'),
                    targetKind: 'boxes',
                    memberIds: ['10'],
                    noteIds: ['note-2'],
                    suppressed: true,
                    enabled: false
                }
            ]
        };
        const boxFeature = {
            type: 'Feature',
            properties: { OBJECTID: 10, _udotFiberKey: 'boxes', BOXLABELS: 'JB-A' },
            geometry: { type: 'Point', coordinates: [-111.90, 40.75] }
        };
        const conduitFeature = {
            type: 'Feature',
            properties: { OBJECTID: 1, _udotFiberKey: 'conduit', CustNameRight: '1D' },
            geometry: { type: 'LineString', coordinates: [[-111.90, 40.75], [-111.88, 40.75]] }
        };
        setPlanSetCalloutMenuContext({
            isActive: () => true,
            isOpen: () => true,
            getSession: () => session,
            mapService: {
                findFeaturesNearClick: () => ([
                    { feature: conduitFeature, layerId: 'snap-conduit', featureIndex: 0 },
                    { feature: boxFeature, layerId: 'snap-boxes', featureIndex: 0 }
                ])
            },
            getLayers: () => ([
                snapshotLayer,
                {
                    id: 'snap-boxes',
                    source: { format: SHEET_FIBER_SNAPSHOT_FORMAT, fiberKey: 'boxes' }
                }
            ]),
            onAddLeader: () => {},
            onRemoveLeader: () => {}
        });
        const items = getPlanSetCalloutMenuItems({
            latlng: { lng: -111.90, lat: 40.75 },
            layerId: 'snap-conduit',
            featureIndex: 0,
            feature: conduitFeature
        });
        const onMenu = items.find((item) => item.label === 'Turn on callout');
        expect(onMenu?.children?.length).toBe(2);
        expect(onMenu.children.some((child) => /1D/.test(child.label))).toBe(true);
        expect(onMenu.children.some((child) => /JB-A/.test(child.label))).toBe(true);
        setPlanSetCalloutMenuContext(null);
    });

    it('offers box-select turn on and off while the callout session is live', () => {
        expect(getCalloutSelectionItems({
            layer: snapshotLayer,
            count: 1
        })).toEqual([]);
        setPlanSetCalloutMenuContext({
            isActive: () => true,
            getSession: () => ({ leaders: [] }),
            mapService: { getSelectedIndices: () => [0] },
            getLayers: () => [snapshotLayer],
            onSetLeadersEnabled: () => 1
        });
        const items = getCalloutSelectionItems({
            layer: snapshotLayer,
            count: 2,
            bbox: [-111.91, 40.74, -111.87, 40.76]
        });
        expect(items.map((item) => item.label)).toEqual([
            'Turn callout on',
            'Turn callout off'
        ]);
        setPlanSetCalloutMenuContext(null);
    });

    it('concatenates callout actions with protect-in-place extras', async () => {
        const { buildSelectionActionItems } = await import('../js/tools/selection-actions.js');
        setPlanSetCalloutMenuContext({
            isActive: () => true,
            getSession: () => ({ leaders: [] }),
            mapService: { getSelectedIndices: () => [0] },
            getLayers: () => [snapshotLayer]
        });
        const extras = [
            { label: 'Existing protect in place', icon: '┅', action: () => {} },
            { label: 'Restore original style', icon: '↺', action: () => {} },
            ...getCalloutSelectionItems({ layer: snapshotLayer, count: 1 })
        ];
        const { items } = buildSelectionActionItems({
            layer: {
                id: 'snap-conduit',
                name: 'Sheets UDOT Conduit',
                schema: { geometryType: 'LineString' },
                geojson: snapshotLayer.geojson
            },
            count: 1,
            extraItems: extras
        });
        expect(items.map((item) => item.label).slice(0, 4)).toEqual([
            'Existing protect in place',
            'Restore original style',
            'Turn callout on',
            'Turn callout off'
        ]);
        setPlanSetCalloutMenuContext(null);
    });
});
