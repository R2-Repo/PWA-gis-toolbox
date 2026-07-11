import * as turf from '@turf/turf';
import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdSequence } from '../js/plan-project/id-utils.js';
import {
    createFiberDesignSession,
    addPlanningAlignment,
    placeStructure,
    configureConduitSegment,
    addFiberRoute,
    serializeDesignSession,
    restoreDesignSession,
    validateDesignSession,
    STRUCTURE_TYPES
} from '../js/widgets/fiber-procurement-design/engine.js';
import { splitLineAtDistances } from '../js/widgets/fiber-procurement-design/relationship-engine.js';

globalThis.turf = turf;

const sampleAlignment = {
    type: 'LineString',
    coordinates: [
        [-111.9, 40.75],
        [-111.89, 40.75],
        [-111.88, 40.751]
    ]
};

describe('fiber procurement design engine', () => {
    beforeEach(() => resetIdSequence());

    it('creates a design session', () => {
        const session = createFiberDesignSession({ projectName: 'Fiber Test' });
        expect(session.project.projectName).toBe('Fiber Test');
    });

    it('adds a planning alignment and generates conduit segments', () => {
        let session = createFiberDesignSession();
        session = addPlanningAlignment(session, sampleAlignment);
        expect(session.design.alignments).toHaveLength(1);
        expect(session.design.conduitSegments).toHaveLength(1);
        expect(session.design.conduitSegments[0].measuredLength).toBeGreaterThan(0);
    });

    it('splits conduit at junction boxes', () => {
        let session = createFiberDesignSession();
        session = addPlanningAlignment(session, sampleAlignment);
        const midpoint = sampleAlignment.coordinates[1];
        session = placeStructure(session, STRUCTURE_TYPES.JUNCTION_BOX, midpoint);
        expect(session.design.structures).toHaveLength(1);
        expect(session.design.conduitSegments.length).toBeGreaterThanOrEqual(2);
    });

    it('configures conduit products and recalculates quantities', () => {
        let session = createFiberDesignSession();
        session = addPlanningAlignment(session, sampleAlignment);
        const segmentId = session.design.conduitSegments[0].segmentId;
        session = configureConduitSegment(session, segmentId, {
            installationMethod: 'directional_bore',
            conduitComponents: [{ productType: 'HDPE', diameter: '2-inch', ductCount: 2 }]
        });
        expect(session.design.conduitSegments[0].installationMethod).toBe('directional_bore');
    });

    it('generates fiber along selected conduit segments', () => {
        let session = createFiberDesignSession();
        session = addPlanningAlignment(session, sampleAlignment);
        const segmentId = session.design.conduitSegments[0].segmentId;
        session = addFiberRoute(session, {
            segmentIds: [segmentId],
            strandCount: 144,
            cableType: 'SM'
        });
        expect(session.design.fibers).toHaveLength(1);
        expect(session.design.fibers[0].calculatedLength).toBeGreaterThan(0);
    });

    it('serializes and restores a design session', () => {
        let session = createFiberDesignSession({ projectName: 'Persist Test' });
        session = addPlanningAlignment(session, sampleAlignment);
        const bundle = serializeDesignSession(session);
        const restored = restoreDesignSession(bundle);
        expect(restored.project.projectName).toBe('Persist Test');
        expect(restored.design.alignments).toHaveLength(1);
    });

    it('validates a design session', () => {
        let session = createFiberDesignSession();
        session = addPlanningAlignment(session, sampleAlignment);
        const validation = validateDesignSession(session);
        expect(validation.valid).toBe(true);
        expect(validation.warnings.some((entry) => entry.includes('stationing'))).toBe(true);
    });

    it('splits lines at structure distances', () => {
        const line = turf.lineString(sampleAlignment.coordinates);
        const total = turf.length(line, { units: 'feet' });
        const segments = splitLineAtDistances(line, [total / 2]);
        expect(segments).toHaveLength(2);
    });
});
