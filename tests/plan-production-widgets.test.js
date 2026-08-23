import * as turf from '@turf/turf';
import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdSequence } from '../js/plan-project/id-utils.js';
import {
    createCalloutSession,
    loadDefaultCalloutProfile,
    addCalloutDefinition,
    addCalloutRule,
    selectDesignLayers,
    setDesignFeatures,
    runCalloutAssignment,
    validateCalloutSession,
    serializeCalloutSession,
    restoreCalloutSession,
    getCalloutLegend
} from '../js/widgets/plan-set-callouts/engine.js';
import {
    createSheetCuttingSession,
    configureSheetTemplate,
    generateSheetSet,
    validateSheetSession,
    serializeSheetSession,
    restoreSheetSession,
    assignFeaturesToSheets,
    setCollapseConduitBanks
} from '../js/widgets/sheet-cutting/engine.js';

globalThis.turf = turf;

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

describe('plan set callouts widget engine', () => {
    beforeEach(() => resetIdSequence());

    it('creates a session and loads default profile', () => {
        let session = createCalloutSession({ projectName: 'Callout Test' });
        session = loadDefaultCalloutProfile(session);
        expect(session.project.projectName).toBe('Callout Test');
        expect(session.callouts.definitions.length).toBeGreaterThan(0);
        expect(session.callouts.rules.length).toBeGreaterThan(0);
    });

    it('runs assignment against design features', () => {
        let session = createCalloutSession();
        session = loadDefaultCalloutProfile(session);
        session = setDesignFeatures(session, sampleFeatures);
        session = runCalloutAssignment(session);
        expect(session.callouts.assignments.length).toBeGreaterThan(0);
        expect(session.callouts.assignments[0].calloutIds.length).toBeGreaterThan(0);
    });

    it('adds custom definitions and rules', () => {
        let session = createCalloutSession();
        session = loadDefaultCalloutProfile(session);
        session = addCalloutDefinition(session, { code: '99', shortDescription: 'Custom callout' });
        const calloutId = session.callouts.definitions.at(-1).calloutId;
        session = addCalloutRule(session, {
            calloutId,
            conditions: [{ operator: 'equals', field: 'custom_field', value: 'yes' }]
        });
        expect(session.callouts.rules.some((rule) => rule.calloutId === calloutId)).toBe(true);
    });

    it('builds legend from assignments', () => {
        let session = createCalloutSession();
        session = loadDefaultCalloutProfile(session);
        session = setDesignFeatures(session, sampleFeatures);
        session = runCalloutAssignment(session);
        const legend = getCalloutLegend(session);
        expect(legend.length).toBeGreaterThan(0);
    });

    it('serializes and restores session', () => {
        let session = createCalloutSession({ projectName: 'Persist Callouts' });
        session = loadDefaultCalloutProfile(session);
        const bundle = serializeCalloutSession(session);
        const restored = restoreCalloutSession(bundle);
        expect(restored.project.projectName).toBe('Persist Callouts');
        expect(restored.callouts.definitions.length).toBe(session.callouts.definitions.length);
    });

    it('validates session readiness', () => {
        const session = createCalloutSession();
        const validation = validateCalloutSession(session);
        expect(validation.warnings.length).toBeGreaterThan(0);
    });
});

describe('sheet cutting widget engine', () => {
    beforeEach(() => resetIdSequence());

    it('creates a session with default template', () => {
        const session = createSheetCuttingSession({ projectName: 'Sheet Test' });
        expect(session.project.projectName).toBe('Sheet Test');
        expect(session.sheets.template.paperSize).toBe('TABLOID');
    });

    it('generates sheet set along route', () => {
        let session = createSheetCuttingSession();
        session = {
            ...session,
            routeLine: sampleRoute,
            stationingRoute: { routeId: 'route-1', routeName: 'Main' }
        };
        session = configureSheetTemplate(session, { scale: 200 });
        session = generateSheetSet(session);
        expect(session.sheets.sheets.length).toBeGreaterThan(0);
        expect(session.sheets.matchLines.length).toBeGreaterThanOrEqual(0);
        if (session.sheets.sheets.length > 1) {
            expect(session.sheets.matchLines.length).toBe(2 * (session.sheets.sheets.length - 1));
        }
        expect(session.sheets.overviewSheet).toBeTruthy();
    });

    it('assigns features to sheets by distance along route', () => {
        const routeLengthFt = turf.length(sampleRoute, { units: 'feet' });
        const sheets = [
            { sheetId: 's1', startDistanceFt: 0, endDistanceFt: routeLengthFt / 2 },
            { sheetId: 's2', startDistanceFt: routeLengthFt / 2, endDistanceFt: routeLengthFt }
        ];
        const assignments = assignFeaturesToSheets(sampleFeatures, sheets, sampleRoute);
        expect(assignments.s1.length + assignments.s2.length).toBeGreaterThan(0);
    });

    it('serializes and restores session', () => {
        let session = createSheetCuttingSession({ projectName: 'Persist Sheets' });
        session = configureSheetTemplate(session, { scale: 400 });
        const bundle = serializeSheetSession(session);
        const restored = restoreSheetSession(bundle);
        expect(restored.project.projectName).toBe('Persist Sheets');
        expect(restored.sheets.template.scale).toBe(400);
        expect(restored.sheets.collapseConduitBanks).toBe(false);
        const collapsed = restoreSheetSession(serializeSheetSession(setCollapseConduitBanks(session, true)));
        expect(collapsed.sheets.collapseConduitBanks).toBe(true);
    });

    it('validates sheet session', () => {
        const session = createSheetCuttingSession();
        const validation = validateSheetSession(session);
        expect(validation.warnings.some((entry) => entry.includes('route'))).toBe(true);
    });
});
