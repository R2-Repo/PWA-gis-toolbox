import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import { applyUdotFiberDisplayOffsets } from '../js/symbology/udot-fiber/display-offsets.js';
import { SHEET_FIBER_SNAPSHOT_FORMAT } from '../js/symbology/udot-fiber/constants.js';
import {
    buildSheetFiberOperationalSpec,
    clipFeaturesToSheetCoverage,
    envelopeFromFeatures,
    isSheetFiberSnapshotLayer,
    liveFiberIdsForPdfExport,
    omitIdsForSheetPdfFiber,
    stripLiveFiberDisplayProps,
    unionSheetFrameCoverage
} from '../js/widgets/sheet-cutting/fiber-operational.js';

globalThis.turf = turf;

describe('sheet Fiber operational copies', () => {
    const west = turf.polygon([[
        [-112.0, 40.0],
        [-111.95, 40.0],
        [-111.95, 40.02],
        [-112.0, 40.02],
        [-112.0, 40.0]
    ]], { sheet_id: 'a' });
    const east = turf.polygon([[
        [-111.95, 40.0],
        [-111.9, 40.0],
        [-111.9, 40.02],
        [-111.95, 40.02],
        [-111.95, 40.0]
    ]], { sheet_id: 'b' });

    it('unions adjacent sheet frames into one coverage polygon', () => {
        const coverage = unionSheetFrameCoverage([west, east]);
        expect(coverage?.geometry).toBeTruthy();
        expect(turf.booleanPointInPolygon([-111.97, 40.01], coverage)).toBe(true);
        expect(turf.booleanPointInPolygon([-111.92, 40.01], coverage)).toBe(true);
        expect(turf.booleanPointInPolygon([-111.8, 40.01], coverage)).toBe(false);
    });

    it('clips crossing fiber to the sheet coverage and strips live display props', () => {
        const fiber = turf.lineString(
            [[-112.05, 40.01], [-111.85, 40.01]],
            {
                OBJECTID: 44,
                FIBER_SYMBOLS: '48',
                _datasetId: 'live-fiber',
                _udotDisplayOffsetM: 1.75,
                _udotFiberKey: 'fiber'
            }
        );
        const clipped = clipFeaturesToSheetCoverage([fiber], [west, east]);
        expect(clipped).toHaveLength(1);
        expect(clipped[0].properties.OBJECTID).toBe(44);
        expect(clipped[0].properties.FIBER_SYMBOLS).toBe('48');
        expect(clipped[0].properties._datasetId).toBeUndefined();
        expect(clipped[0].properties._udotDisplayOffsetM).toBeUndefined();
        expect(clipped[0].properties._udotFiberKey).toBeUndefined();
        const coords = clipped[0].geometry.coordinates;
        expect(coords[0][0]).toBeGreaterThanOrEqual(-112.001);
        expect(coords[coords.length - 1][0]).toBeLessThanOrEqual(-111.899);
    });

    it('leaves PDF live-fiber id lists unchanged when no snapshots exist', () => {
        const liveIds = ['udot-fiber-lines', 'udot-fiber-boxes'];
        const layers = [
            { id: 'udot-fiber-lines', type: 'service' },
            { id: 'udot-fiber-boxes', type: 'service' }
        ];
        expect(liveFiberIdsForPdfExport(liveIds, layers)).toEqual(liveIds);
        expect(omitIdsForSheetPdfFiber(liveIds, layers)).toEqual(liveIds);
    });

    it('keeps live Fiber ids for PDF and omits snapshot copies so they cannot double-draw', () => {
        const liveIds = ['live-fiber', 'snap-fiber'];
        const layers = [
            { id: 'live-fiber', type: 'service' },
            {
                id: 'snap-fiber',
                type: 'spatial',
                source: { format: SHEET_FIBER_SNAPSHOT_FORMAT, projectName: 'Job' },
                _udotFiberLayerKey: 'fiber'
            }
        ];
        expect(liveFiberIdsForPdfExport(liveIds, layers)).toEqual(['live-fiber']);
        expect(omitIdsForSheetPdfFiber(liveIds, layers)).toEqual(['live-fiber', 'snap-fiber']);
        expect(isSheetFiberSnapshotLayer(layers[1])).toBe(true);
        expect(isSheetFiberSnapshotLayer(layers[0])).toBe(false);
    });

    it('builds a spatial snapshot spec without mutating live layer identity', () => {
        const spec = buildSheetFiberOperationalSpec({
            projectName: 'SR-68',
            liveLayer: { id: 'live-1', name: 'UDOT Fiber', service: { url: 'https://example/MapServer/6' } },
            fiberKey: 'fiber',
            features: [turf.lineString([[-112, 40], [-111.9, 40]], { OBJECTID: 1, _datasetId: 'live-1' })]
        });
        expect(spec.name).toBe('SR-68 UDOT Fiber');
        expect(spec.source.format).toBe(SHEET_FIBER_SNAPSHOT_FORMAT);
        expect(spec.source.fiberKey).toBe('fiber');
        expect(spec.geojson.features[0].properties._datasetId).toBeUndefined();
        expect(spec.geojson.features[0].properties.OBJECTID).toBe(1);
    });

    it('does not double-offset features that already have a display offset', () => {
        const line = turf.lineString([[-112, 40], [-111.9, 40]], {
            MULTISHEATH: 2,
            _udotDisplayOffsetM: 1.75
        });
        const [next] = applyUdotFiberDisplayOffsets([line]);
        expect(next.geometry.coordinates).toEqual(line.geometry.coordinates);
    });

    it('computes an envelope from sheet frames', () => {
        const env = envelopeFromFeatures([west, east]);
        expect(env.west).toBeCloseTo(-112, 5);
        expect(env.east).toBeCloseTo(-111.9, 5);
    });

    it('stripLiveFiberDisplayProps keeps user attributes', () => {
        const cleaned = stripLiveFiberDisplayProps({
            type: 'Feature',
            properties: { Fiber_Label: '48 SM', _udotGlyph: 'x', OBJECTID: 9 }
        });
        expect(cleaned.properties.Fiber_Label).toBe('48 SM');
        expect(cleaned.properties.OBJECTID).toBe(9);
        expect(cleaned.properties._udotGlyph).toBeUndefined();
    });
});
