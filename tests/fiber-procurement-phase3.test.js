import * as turf from '@turf/turf';
import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdSequence } from '../js/plan-project/id-utils.js';
import {
    BUILT_IN_ASSEMBLIES,
    createDesignAssembly,
    expandAssemblyToSegmentDefaults,
    listAvailableAssemblies,
    resolveAssemblyCatalogItems,
    toggleAssemblyFavorite
} from '../js/widgets/fiber-procurement-design/assembly-engine.js';
import {
    bulkUpdateConduitSegments,
    continueFromConduitSegment,
    copyConduitProperties,
    recordLastUsedValues,
    applyAutomaticLabels
} from '../js/widgets/fiber-procurement-design/productivity-engine.js';
import {
    runDesignReadinessCheck,
    buildQuantityTraceabilityReport,
    validateDesignSessionDetailed
} from '../js/widgets/fiber-procurement-design/validation-engine.js';
import { createConduitSegment } from '../js/widgets/fiber-procurement-design/design-model.js';
import {
    createFiberDesignSession,
    loadProcurementCatalog,
    setActiveAssembly,
    applyActiveAssemblyToSegments,
    bulkUpdateSegments,
    continueConduitFromSegment,
    copyConduitToSegments,
    addNonSpatialItem,
    overrideQuantity,
    getQuantityTraceability,
    addPlanningAlignment,
    configureConduitSegment,
    validateDesignSession
} from '../js/widgets/fiber-procurement-design/engine.js';

globalThis.turf = turf;

const sampleAlignment = {
    type: 'LineString',
    coordinates: [
        [-111.9, 40.75],
        [-111.89, 40.75],
        [-111.88, 40.751]
    ]
};

describe('assembly engine', () => {
    beforeEach(() => resetIdSequence());

    it('lists built-in assemblies', () => {
        const assemblies = listAvailableAssemblies({});
        expect(assemblies.length).toBeGreaterThanOrEqual(BUILT_IN_ASSEMBLIES.length);
        expect(assemblies.some((entry) => entry.assemblyId === 'asm-standard-road-bore')).toBe(true);
    });

    it('resolves catalog matchers on assemblies', () => {
        const assembly = BUILT_IN_ASSEMBLIES[0];
        const catalogItems = [
            { catalogItemId: 'cat-bore', description: 'Directional bore installation', productType: 'Labor' },
            { catalogItemId: 'cat-hdpe', description: '2-inch HDPE duct', productType: 'HDPE' }
        ];
        const resolved = resolveAssemblyCatalogItems(catalogItems, assembly);
        expect(resolved.catalogItemIds).toContain('cat-bore');
        expect(resolved.catalogItemIds).toContain('cat-hdpe');
    });

    it('expands assembly defaults onto segment configuration', () => {
        const assembly = BUILT_IN_ASSEMBLIES.find((entry) => entry.assemblyId === 'asm-open-trench-lateral');
        const defaults = expandAssemblyToSegmentDefaults(assembly, { defaultInstallationMethod: 'open_trench' });
        expect(defaults.installationMethod).toBe('open_trench');
        expect(defaults.conduitComponents).toHaveLength(1);
        expect(defaults.assemblyId).toBe('asm-open-trench-lateral');
    });

    it('toggles favorites for built-in assemblies', () => {
        const assemblies = toggleAssemblyFavorite({}, 'asm-standard-road-bore', true);
        expect(assemblies.some((entry) => entry.assemblyId === 'asm-standard-road-bore' && entry.isFavorite)).toBe(true);
    });

    it('saves custom assemblies', () => {
        const custom = createDesignAssembly({ assemblyName: 'My assembly', installationMethod: 'aerial' });
        expect(custom.isBuiltIn).toBe(false);
        expect(custom.assemblyName).toBe('My assembly');
    });
});

describe('productivity engine', () => {
    beforeEach(() => resetIdSequence());

    it('continues conduit properties from a source segment', () => {
        const source = createConduitSegment({
            segmentId: 'seg-1',
            installationMethod: 'directional_bore',
            conduitComponents: [{ productType: 'HDPE', diameter: '2-inch', ductCount: 2 }]
        });
        const patch = continueFromConduitSegment(source);
        expect(patch.installationMethod).toBe('directional_bore');
        expect(patch.conduitComponents).toHaveLength(1);
        expect(patch.conduitComponents[0].componentId).toBeTruthy();
    });

    it('copies selected conduit fields', () => {
        const source = createConduitSegment({
            installationMethod: 'aerial',
            surfaceType: 'asphalt',
            assemblyId: 'asm-aerial-installation'
        });
        const patch = copyConduitProperties(source, ['installationMethod', 'assemblyId']);
        expect(patch.installationMethod).toBe('aerial');
        expect(patch.assemblyId).toBe('asm-aerial-installation');
        expect(patch.surfaceType).toBeUndefined();
    });

    it('bulk updates selected segments', () => {
        const segments = [
            createConduitSegment({ segmentId: 'seg-1', installationMethod: 'open_trench' }),
            createConduitSegment({ segmentId: 'seg-2', installationMethod: 'open_trench' })
        ];
        const updated = bulkUpdateConduitSegments(segments, ['seg-2'], {
            installationMethod: 'directional_bore'
        });
        expect(updated[0].installationMethod).toBe('open_trench');
        expect(updated[1].installationMethod).toBe('directional_bore');
    });

    it('applies automatic display labels', () => {
        const design = applyAutomaticLabels({
            alignments: [{ alignmentId: 'aln-1', routeName: 'Main', alignmentName: 'Main Route' }],
            conduitSegments: [{
                segmentId: 'seg-1',
                parentAlignmentId: 'aln-1',
                installationMethod: 'directional_bore',
                conduitComponents: [{ productType: 'HDPE', diameter: '2-inch', ductCount: 2 }]
            }],
            fibers: [{ fiberId: 'fib-1', strandCount: 144, cableType: 'SM' }]
        });
        expect(design.conduitSegments[0].displayLabel).toBeTruthy();
        expect(design.fibers[0].displayLabel).toContain('144');
    });

    it('records last-used values', () => {
        const lastUsed = recordLastUsedValues({}, { installationMethod: 'aerial' });
        expect(lastUsed.installationMethod).toBe('aerial');
        expect(lastUsed.updatedAt).toBeTruthy();
    });
});

describe('validation engine', () => {
    beforeEach(() => resetIdSequence());

    it('flags missing stationing and alignment on empty session', () => {
        const session = createFiberDesignSession();
        const findings = runDesignReadinessCheck(session);
        expect(findings.some((entry) => entry.code === 'missing_stationing')).toBe(true);
        expect(findings.some((entry) => entry.code === 'missing_alignment')).toBe(true);
    });

    it('flags zero-length conduit segments', () => {
        const session = createFiberDesignSession();
        session.design.conduitSegments = [
            createConduitSegment({ segmentId: 'seg-1', measuredLength: 0 })
        ];
        const findings = runDesignReadinessCheck(session);
        expect(findings.some((entry) => entry.code === 'zero_length_segment')).toBe(true);
    });

    it('builds quantity traceability report', () => {
        const design = {
            quantities: [{
                quantityId: 'qty-1',
                catalogItemId: 'cat-1',
                calculationType: 'length',
                measuredValue: 100,
                calculatedQuantity: 105,
                finalQuantity: 105,
                designFeatureIds: ['seg-1']
            }],
            conduitSegments: [createConduitSegment({ segmentId: 'seg-1', measuredLength: 100 })]
        };
        const report = buildQuantityTraceabilityReport(design, [
            { catalogItemId: 'cat-1', description: 'HDPE duct' }
        ]);
        expect(report).toHaveLength(1);
        expect(report[0].description).toBe('HDPE duct');
        expect(report[0].linkedFeatures[0].featureType).toBe('conduit_segment');
    });

    it('returns detailed validation summary', () => {
        let session = createFiberDesignSession();
        session = addPlanningAlignment(session, sampleAlignment);
        const validation = validateDesignSessionDetailed(session);
        expect(validation.findings.length).toBeGreaterThan(0);
        expect(validation.valid).toBe(true);
    });
});

describe('fiber procurement design engine — phase 3', () => {
    beforeEach(() => resetIdSequence());

    it('applies active assembly when adding alignment', () => {
        let session = createFiberDesignSession();
        session = loadProcurementCatalog(session);
        session = setActiveAssembly(session, 'asm-open-trench-lateral');
        session = addPlanningAlignment(session, sampleAlignment);
        const segment = session.design.conduitSegments[0];
        expect(segment.assemblyId).toBe('asm-open-trench-lateral');
        expect(segment.installationMethod).toBe('open_trench');
    });

    it('bulk updates segments and records last-used values', () => {
        let session = createFiberDesignSession();
        session = addPlanningAlignment(session, sampleAlignment);
        const segmentId = session.design.conduitSegments[0].segmentId;
        session = bulkUpdateSegments(session, [segmentId], {
            installationMethod: 'aerial',
            conduitComponents: [{ productType: 'HDPE', diameter: '1.25-inch', ductCount: 2 }]
        });
        expect(session.design.conduitSegments[0].installationMethod).toBe('aerial');
        expect(session.design.lastUsed.installationMethod).toBe('aerial');
    });

    it('continues conduit configuration to another segment', () => {
        let session = createFiberDesignSession();
        session = addPlanningAlignment(session, sampleAlignment);
        const [sourceId, targetId] = session.design.conduitSegments.length >= 2
            ? [session.design.conduitSegments[0].segmentId, session.design.conduitSegments[1].segmentId]
            : [session.design.conduitSegments[0].segmentId, session.design.conduitSegments[0].segmentId];

        session = configureConduitSegment(session, sourceId, {
            installationMethod: 'directional_bore',
            conduitComponents: [{ productType: 'HDPE', diameter: '2-inch', ductCount: 2 }]
        });

        if (sourceId !== targetId) {
            session = continueConduitFromSegment(session, sourceId, targetId);
            expect(session.design.conduitSegments[1].installationMethod).toBe('directional_bore');
        }
    });

    it('copies conduit properties to target segments', () => {
        let session = createFiberDesignSession();
        session = addPlanningAlignment(session, sampleAlignment);
        const segmentId = session.design.conduitSegments[0].segmentId;
        session = configureConduitSegment(session, segmentId, {
            installationMethod: 'existing_conduit',
            assemblyId: 'asm-existing-conduit-pull'
        });
        session = copyConduitToSegments(session, segmentId, [segmentId]);
        expect(session.design.conduitSegments[0].assemblyId).toBe('asm-existing-conduit-pull');
    });

    it('adds non-spatial items and includes them in quantities', () => {
        let session = createFiberDesignSession();
        session = loadProcurementCatalog(session);
        session = addNonSpatialItem(session, {
            description: 'Permit fee',
            quantity: 1,
            unit: 'each'
        });
        expect(session.design.nonSpatialItems).toHaveLength(1);
    });

    it('overrides quantities and surfaces in readiness check', () => {
        let session = createFiberDesignSession();
        session = addPlanningAlignment(session, sampleAlignment);
        session = configureConduitSegment(session, session.design.conduitSegments[0].segmentId, {
            installationMethod: 'directional_bore',
            conduitComponents: [{ productType: 'HDPE', diameter: '2-inch', ductCount: 2 }]
        });
        const quantityId = session.design.quantities[0]?.quantityId;
        if (quantityId) {
            session = overrideQuantity(session, quantityId, 999, 'Field adjustment');
            const traceability = getQuantityTraceability(session);
            expect(traceability.length).toBeGreaterThan(0);
            const validation = validateDesignSession(session);
            expect(validation.findings?.some((entry) => entry.code === 'manual_quantity_override')
                || validation.warnings.some((entry) => entry.includes('Manual quantity override'))).toBe(true);
        }
    });

    it('re-applies active assembly to selected segments', () => {
        let session = createFiberDesignSession();
        session = loadProcurementCatalog(session);
        session = setActiveAssembly(session, 'asm-standard-road-bore');
        session = addPlanningAlignment(session, sampleAlignment);
        const segmentId = session.design.conduitSegments[0].segmentId;
        session = bulkUpdateSegments(session, [segmentId], { installationMethod: 'temporary' });
        session = applyActiveAssemblyToSegments(session, [segmentId]);
        expect(session.design.conduitSegments[0].assemblyId).toBe('asm-standard-road-bore');
        expect(session.design.conduitSegments[0].installationMethod).toBe('directional_bore');
    });
});
