import * as turf from '@turf/turf';
import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdSequence } from '../js/plan-project/id-utils.js';
import {
    runPlanReadinessCheck,
    calculateReadinessScore,
    buildReadinessReportCsv,
    runCrossWidgetConsistencyChecks
} from '../js/widgets/plan-production-export/readiness-engine.js';
import {
    EXPORT_PROFILES,
    buildProfessionalPlanExport,
    enrichAssemblyForExport,
    buildSymbologyManifestCsv,
    buildLayerManifestCsv
} from '../js/widgets/plan-production-export/export-builder.js';
import {
    createPlanProductionSession,
    assembleFromWidgetEntries,
    linkWidgetAssembly,
    runReadinessCheck,
    setExportProfile,
    buildProductionExport
} from '../js/widgets/plan-production-export/engine.js';
import {
    createFiberDesignSession,
    loadProcurementCatalog,
    addPlanningAlignment,
    configureConduitSegment,
    serializeDesignSession
} from '../js/widgets/fiber-procurement-design/engine.js';
import {
    createCalloutSession,
    loadDefaultCalloutProfile,
    setDesignFeatures,
    runCalloutAssignment,
    serializeCalloutSession
} from '../js/widgets/plan-set-callouts/engine.js';
import {
    createSheetCuttingSession,
    configureSheetTemplate,
    generateSheetSet,
    serializeSheetSession
} from '../js/widgets/sheet-cutting/engine.js';

globalThis.turf = turf;

const sampleAlignment = {
    type: 'LineString',
    coordinates: [
        [-111.9, 40.75],
        [-111.89, 40.75],
        [-111.88, 40.751]
    ]
};

const sampleRoute = {
    type: 'Feature',
    geometry: sampleAlignment,
    properties: {}
};

function buildFiberWidgetEntry() {
    let session = createFiberDesignSession({ projectName: 'Fiber Plan' });
    session = loadProcurementCatalog(session);
    session = addPlanningAlignment(session, sampleAlignment);
    session = configureConduitSegment(session, session.design.conduitSegments[0].segmentId, {
        installationMethod: 'directional_bore',
        conduitComponents: [{ productType: 'HDPE', diameter: '2-inch', ductCount: 2 }]
    });
    return {
        type: 'fiber-procurement-design',
        open: true,
        state: serializeDesignSession(session)
    };
}

function buildCalloutWidgetEntry() {
    let session = createCalloutSession({ projectName: 'Fiber Plan' });
    session = loadDefaultCalloutProfile(session);
    session = setDesignFeatures(session, [{
        id: 'f1',
        properties: { strand_count: '144' },
        geometry: { type: 'Point', coordinates: [-111.895, 40.75] }
    }]);
    session = runCalloutAssignment(session);
    return {
        type: 'plan-set-callouts',
        open: true,
        state: serializeCalloutSession(session)
    };
}

function buildSheetWidgetEntry() {
    let session = createSheetCuttingSession({ projectName: 'Fiber Plan' });
    session = { ...session, routeLine: sampleRoute };
    session = configureSheetTemplate(session, { scale: 200 });
    session = generateSheetSet(session);
    return {
        type: 'sheet-cutting',
        open: true,
        state: serializeSheetSession(session)
    };
}

describe('plan readiness engine', () => {
    beforeEach(() => resetIdSequence());

    it('calculates readiness score from findings', () => {
        const score = calculateReadinessScore([
            { severity: 'error' },
            { severity: 'warning' }
        ]);
        expect(score).toBeLessThan(100);
        expect(score).toBeGreaterThanOrEqual(0);
    });

    it('flags cross-widget project name mismatch', () => {
        const findings = runCrossWidgetConsistencyChecks({
            fiberSession: { project: { projectName: 'Alpha' } },
            calloutSession: { project: { projectName: 'Beta' } }
        });
        expect(findings.some((entry) => entry.code === 'project_name_mismatch')).toBe(true);
    });

    it('runs aggregated readiness check', () => {
        const assembly = assembleFromWidgetEntries([
            buildFiberWidgetEntry(),
            buildCalloutWidgetEntry(),
            buildSheetWidgetEntry()
        ]);
        const result = runPlanReadinessCheck(assembly);
        expect(result.findings.length).toBeGreaterThan(0);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.summary.widgetsLinked.fiber).toBe(true);
    });

    it('builds readiness report csv', () => {
        const csv = buildReadinessReportCsv([
            { severity: 'warning', widgetLabel: 'Fiber', step: 'Conduit', code: 'test', message: 'Test message' }
        ]);
        expect(csv).toContain('warning');
        expect(csv).toContain('Test message');
    });
});

describe('plan production export builder', () => {
    beforeEach(() => resetIdSequence());

    it('enriches assembly with widget export packages', () => {
        const assembly = assembleFromWidgetEntries([buildFiberWidgetEntry()]);
        const enriched = enrichAssemblyForExport(assembly);
        expect(enriched.fiberExport?.geojson?.conduit?.features?.length).toBeGreaterThan(0);
    });

    it('builds procurement export package', () => {
        const assembly = assembleFromWidgetEntries([
            buildFiberWidgetEntry(),
            buildCalloutWidgetEntry(),
            buildSheetWidgetEntry()
        ]);
        assembly.readiness = runPlanReadinessCheck(assembly);
        const enriched = enrichAssemblyForExport(assembly);
        const exportPackage = buildProfessionalPlanExport(enriched, 'procurement');

        expect(exportPackage.files.length).toBeGreaterThan(5);
        expect(exportPackage.files.some((file) => file.filename.endsWith('_project_bundle.json'))).toBe(true);
        expect(exportPackage.files.some((file) => file.filename.includes('quantity_summary'))).toBe(true);
        expect(exportPackage.revision).toBeTruthy();
    });

    it('builds plan set profile with sheets and callouts', () => {
        const assembly = assembleFromWidgetEntries([
            buildFiberWidgetEntry(),
            buildCalloutWidgetEntry(),
            buildSheetWidgetEntry()
        ]);
        assembly.readiness = runPlanReadinessCheck(assembly);
        const exportPackage = buildProfessionalPlanExport(enrichAssemblyForExport(assembly), 'plan_set');
        expect(exportPackage.files.some((file) => file.filename.includes('sheet'))).toBe(true);
        expect(exportPackage.files.some((file) => file.filename.includes('symbology'))).toBe(true);
    });

    it('requires sheets for plan_set profile when missing', () => {
        const assembly = assembleFromWidgetEntries([buildFiberWidgetEntry()]);
        expect(() => buildProfessionalPlanExport(enrichAssemblyForExport(assembly), 'plan_set')).toThrow();
    });

    it('builds symbology and layer manifests', () => {
        const assembly = enrichAssemblyForExport(assembleFromWidgetEntries([buildFiberWidgetEntry()]));
        expect(buildSymbologyManifestCsv(assembly)).toContain('symbol_key');
        expect(buildLayerManifestCsv(assembly)).toContain('conduit');
    });
});

describe('plan production export engine', () => {
    beforeEach(() => resetIdSequence());

    it('assembles widget entries into linked sessions', () => {
        const assembly = assembleFromWidgetEntries([
            buildFiberWidgetEntry(),
            buildSheetWidgetEntry()
        ]);
        expect(assembly.sources['fiber-procurement-design']).toBe(true);
        expect(assembly.sources['sheet-cutting']).toBe(true);
        expect(assembly.fiberSession?.design?.conduitSegments?.length).toBeGreaterThan(0);
    });

    it('runs readiness and builds export through session API', () => {
        let session = createPlanProductionSession({ projectName: 'Export Test' });
        session = linkWidgetAssembly(session, assembleFromWidgetEntries([
            buildFiberWidgetEntry(),
            buildCalloutWidgetEntry(),
            buildSheetWidgetEntry()
        ]));
        session = runReadinessCheck(session);
        session = setExportProfile(session, 'procurement');
        session = buildProductionExport(session);

        expect(session.readiness?.score).toBeGreaterThanOrEqual(0);
        expect(session.lastExport?.files?.length).toBeGreaterThan(0);
        expect(EXPORT_PROFILES.procurement.label).toBe('Procurement bid package');
    });
});
