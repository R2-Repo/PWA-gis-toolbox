import * as turf from '@turf/turf';
import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdSequence } from '../js/plan-project/id-utils.js';
import { assignStableNoteNumbers, noteTextForFeature, pointTargetKey } from '../js/widgets/plan-set-callouts/fiber-notes.js';
import { groupSpanMembers, spanTargetKey } from '../js/widgets/plan-set-callouts/span-grouping.js';
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
        expect(session.leaders.every((leader) => leader.sheetNumber === 1)).toBe(true);
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
    });
});

describe('key notes table placement', () => {
    it('stays above the footer and prefers a corner inside the gold cut', () => {
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
        expect(rect.x).toBeGreaterThanOrEqual(200);
        expect(rect.x + rect.width).toBeLessThanOrEqual(700);
        expect(rect.y).toBeGreaterThanOrEqual(80);
        expect(rect.y + rect.height).toBeLessThanOrEqual(400);
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

    function twoNumberSession() {
        return {
            notes: [
                { noteId: 'n1', number: 1, text: 'JB-A' },
                { noteId: 'n2', number: 2, text: 'UDOT 048 SMF' }
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
