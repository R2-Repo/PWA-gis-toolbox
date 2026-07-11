import * as turf from '@turf/turf';
import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdSequence } from '../js/plan-project/id-utils.js';
import {
    resolveFeatureDistanceAlongRoute,
    findSheetForDistance,
    parseSheetsFromLayerFeatures,
    generateSheetAwarePlacements,
    buildSheetCalloutMarkersGeoJson,
    validateSheetAwarePlacements
} from '../js/widgets/plan-set-callouts/sheet-placement-engine.js';
import {
    createCalloutSession,
    loadDefaultCalloutProfile,
    setDesignFeatures,
    runCalloutAssignment,
    linkSheetSetFromLayers,
    linkSheetSetFromBundle,
    runSheetAwarePlacement,
    serializeCalloutSession,
    restoreCalloutSession
} from '../js/widgets/plan-set-callouts/engine.js';
import {
    createSheetCuttingSession,
    configureSheetTemplate,
    generateSheetSet,
    serializeSheetSession
} from '../js/widgets/sheet-cutting/engine.js';

globalThis.turf = turf;

const sampleRoute = {
    type: 'Feature',
    geometry: {
        type: 'LineString',
        coordinates: [
            [-111.9, 40.75],
            [-111.89, 40.75],
            [-111.88, 40.751]
        ]
    },
    properties: {}
};

const sampleFeatures = [
    {
        id: 'f1',
        properties: { strand_count: '144', feature_type: 'fiber' },
        geometry: { type: 'Point', coordinates: [-111.895, 40.75] }
    },
    {
        id: 'f2',
        properties: { asset_type: 'junction_box' },
        geometry: { type: 'Point', coordinates: [-111.89, 40.75] }
    }
];

describe('sheet placement engine', () => {
    beforeEach(() => resetIdSequence());

    it('resolves feature distance along route', () => {
        const distance = resolveFeatureDistanceAlongRoute(sampleFeatures[0], sampleRoute);
        expect(distance).toBeGreaterThan(0);
    });

    it('finds sheet for distance', () => {
        const routeLengthFt = turf.length(sampleRoute, { units: 'feet' });
        const sheet = findSheetForDistance([
            { sheetId: 's1', startDistanceFt: 0, endDistanceFt: routeLengthFt }
        ], 100);
        expect(sheet?.sheetId).toBe('s1');
    });

    it('parses sheet frames from layer features', () => {
        const sheets = parseSheetsFromLayerFeatures([
            {
                properties: {
                    feature_type: 'sheet_frame',
                    sheet_id: 'sheet-1',
                    sheet_number: 1,
                    start_distance_ft: 0,
                    end_distance_ft: 1000
                },
                geometry: { type: 'Polygon', coordinates: [] }
            }
        ]);
        expect(sheets).toHaveLength(1);
        expect(sheets[0].sheetNumber).toBe(1);
    });

    it('generates per-sheet placements with markers', () => {
        let session = createCalloutSession();
        session = loadDefaultCalloutProfile(session);
        session = setDesignFeatures(session, sampleFeatures);
        session = runCalloutAssignment(session);

        let sheetSession = createSheetCuttingSession();
        sheetSession = { ...sheetSession, routeLine: sampleRoute };
        sheetSession = configureSheetTemplate(sheetSession, { scale: 200 });
        sheetSession = generateSheetSet(sheetSession);

        const placements = generateSheetAwarePlacements({
            assignments: session.callouts.assignments,
            sheets: sheetSession.sheets.sheets,
            features: sampleFeatures,
            routeLine: sampleRoute
        });

        expect(placements.length).toBeGreaterThan(0);
        expect(placements.some((sheet) => (sheet.placements || []).length > 0)).toBe(true);

        const markers = buildSheetCalloutMarkersGeoJson(placements);
        expect(markers.features.length).toBeGreaterThan(0);
        expect(markers.features[0].properties.sheet_number).toBeDefined();
    });

    it('validates unplaced assignments outside sheet coverage', () => {
        const validation = validateSheetAwarePlacements(
            [{ sheetId: 's1', sheetNumber: 1, placements: [] }],
            [{ assignmentId: 'a1', featureId: 'f1', calloutIds: ['c1'], callouts: [{ calloutId: 'c1', code: '1' }] }],
            [{ sheetId: 's1', sheetNumber: 1 }]
        );
        expect(validation.warnings.some((entry) => entry.includes('outside sheet coverage'))).toBe(true);
    });
});

describe('sheet-aware callouts integration', () => {
    beforeEach(() => resetIdSequence());

    it('links sheet set from layers and runs placement', () => {
        let session = createCalloutSession();
        session = loadDefaultCalloutProfile(session);
        session = setDesignFeatures(session, sampleFeatures);
        session = runCalloutAssignment(session);

        const sheetFeatures = [
            {
                properties: {
                    feature_type: 'sheet_frame',
                    sheet_id: 'sheet-1',
                    sheet_number: 1,
                    start_distance_ft: 0,
                    end_distance_ft: 10000,
                    center_distance_ft: 5000
                },
                geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
            }
        ];

        session = linkSheetSetFromLayers(session, sheetFeatures, sampleRoute, ['layer-1']);
        session = runSheetAwarePlacement(session);

        expect(session.callouts.sheetPlacements.length).toBe(1);
        expect(session.callouts.sheetPlacements[0].placements.length).toBeGreaterThan(0);
    });

    it('links sheet set from serialized sheet-cutting bundle', () => {
        let sheetSession = createSheetCuttingSession();
        sheetSession = { ...sheetSession, routeLine: sampleRoute };
        sheetSession = configureSheetTemplate(sheetSession, { scale: 200 });
        sheetSession = generateSheetSet(sheetSession);
        const bundle = serializeSheetSession(sheetSession);

        let calloutSession = createCalloutSession();
        calloutSession = loadDefaultCalloutProfile(calloutSession);
        calloutSession = setDesignFeatures(calloutSession, sampleFeatures);
        calloutSession = runCalloutAssignment(calloutSession);
        calloutSession = linkSheetSetFromBundle(calloutSession, bundle);
        calloutSession = runSheetAwarePlacement(calloutSession);

        expect(calloutSession.routeLine?.geometry).toBeTruthy();
        expect(calloutSession.callouts.sheetPlacements.length).toBeGreaterThan(0);
    });

    it('serializes and restores sheet-aware callout session metadata', () => {
        let session = createCalloutSession({ projectName: 'Sheet Aware' });
        session = loadDefaultCalloutProfile(session);
        session = {
            ...session,
            routeLine: sampleRoute,
            sheetSource: 'bundle',
            callouts: {
                ...session.callouts,
                sheetSetId: 'sheetset-1',
                sheets: [{ sheetId: 's1', sheetNumber: 1, startDistanceFt: 0, endDistanceFt: 10000 }],
                sheetPlacements: [{ sheetId: 's1', sheetNumber: 1, placements: [], calloutTable: [] }]
            }
        };

        const bundle = serializeCalloutSession(session);
        const restored = restoreCalloutSession(bundle);
        expect(restored.project.projectName).toBe('Sheet Aware');
        expect(restored.routeLine?.geometry).toBeTruthy();
        expect(restored.callouts.sheetPlacements).toHaveLength(1);
    });
});
