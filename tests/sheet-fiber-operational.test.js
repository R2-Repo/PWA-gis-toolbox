import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import { applyUdotFiberDisplayOffsets } from '../js/symbology/udot-fiber/display-offsets.js';
import { SHEET_FIBER_SNAPSHOT_FORMAT, UDOT_FIBER_SERVICE_URL } from '../js/symbology/udot-fiber/constants.js';
import {
    buildSheetFiberOperationalSpec,
    clipFeaturesToSheetCoverage,
    envelopeFromFeatures,
    isSheetFiberSnapshotLayer,
    liveFiberIdsForPdfExport,
    omitIdsForSheetPdfFiber,
    replaceLiveFiberIdsInDesignList,
    resolveFiberLayerIdsForPdfExport,
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
        expect(resolveFiberLayerIdsForPdfExport(liveIds, layers).refreshLiveIds).toEqual(liveIds);
    });

    it('uses visible snapshot copies for PDF collect and omits the converted live layer', () => {
        const liveUrl = `${UDOT_FIBER_SERVICE_URL}/6`;
        const liveIds = ['snap-fiber'];
        const layers = [
            {
                id: 'live-fiber',
                type: 'service',
                service: { url: liveUrl },
                _udotFiberLayerKey: 'fiber'
            },
            {
                id: 'snap-fiber',
                type: 'spatial',
                source: {
                    format: SHEET_FIBER_SNAPSHOT_FORMAT,
                    projectName: 'Job',
                    fiberKey: 'fiber',
                    sourceLayerId: 'live-fiber',
                    url: liveUrl
                },
                _udotFiberLayerKey: 'fiber'
            }
        ];
        const resolved = resolveFiberLayerIdsForPdfExport(liveIds, layers);
        expect(resolved.fiberLayerIds).toEqual(['snap-fiber']);
        expect(resolved.refreshLiveIds).toEqual([]);
        expect(resolved.omitIds).toEqual(expect.arrayContaining(['snap-fiber', 'live-fiber']));
        expect(liveFiberIdsForPdfExport(liveIds, layers)).toEqual(['snap-fiber']);
        expect(isSheetFiberSnapshotLayer(layers[1])).toBe(true);
        expect(isSheetFiberSnapshotLayer(layers[0])).toBe(false);
    });

    it('mixes converted Fiber with remaining live Conduit by key', () => {
        const fiberUrl = `${UDOT_FIBER_SERVICE_URL}/6`;
        const conduitUrl = `${UDOT_FIBER_SERVICE_URL}/7`;
        const layers = [
            {
                id: 'live-fiber',
                type: 'service',
                service: { url: fiberUrl },
                _udotFiberLayerKey: 'fiber'
            },
            {
                id: 'live-conduit',
                type: 'service',
                service: { url: conduitUrl },
                _udotFiberLayerKey: 'conduit'
            },
            {
                id: 'snap-fiber',
                type: 'spatial',
                source: {
                    format: SHEET_FIBER_SNAPSHOT_FORMAT,
                    fiberKey: 'fiber',
                    sourceLayerId: 'live-fiber',
                    url: fiberUrl
                },
                _udotFiberLayerKey: 'fiber'
            }
        ];
        const resolved = resolveFiberLayerIdsForPdfExport(['snap-fiber', 'live-conduit'], layers);
        expect(resolved.fiberLayerIds).toEqual(['snap-fiber', 'live-conduit']);
        expect(resolved.refreshLiveIds).toEqual(['live-conduit']);
        expect(resolved.omitIds).toEqual(expect.arrayContaining(['snap-fiber', 'live-fiber', 'live-conduit']));
        expect(resolved.omitIds).not.toContain(undefined);
    });

    it('prefers the snapshot when converted live Fiber is still visible', () => {
        const liveUrl = `${UDOT_FIBER_SERVICE_URL}/6`;
        const layers = [
            {
                id: 'live-fiber',
                type: 'service',
                service: { url: liveUrl },
                _udotFiberLayerKey: 'fiber'
            },
            {
                id: 'snap-fiber',
                type: 'spatial',
                source: {
                    format: SHEET_FIBER_SNAPSHOT_FORMAT,
                    fiberKey: 'fiber',
                    sourceLayerId: 'live-fiber'
                },
                _udotFiberLayerKey: 'fiber'
            }
        ];
        const resolved = resolveFiberLayerIdsForPdfExport(['live-fiber', 'snap-fiber'], layers);
        expect(resolved.fiberLayerIds).toEqual(['snap-fiber']);
        expect(resolved.refreshLiveIds).toEqual([]);
        expect(resolved.omitIds).toEqual(expect.arrayContaining(['snap-fiber', 'live-fiber']));
    });

    it('swaps converted live ids for snapshot ids on the design layer list', () => {
        expect(replaceLiveFiberIdsInDesignList(
            ['design-a', 'live-fiber', 'live-boxes'],
            ['live-fiber', 'live-boxes'],
            ['snap-fiber', 'snap-boxes']
        )).toEqual(['design-a', 'snap-fiber', 'snap-boxes']);
    });

    it('drops prior snapshot ids when converting again', () => {
        expect(replaceLiveFiberIdsInDesignList(
            ['design-a', 'old-snap', 'live-fiber'],
            ['live-fiber', 'old-snap'],
            ['new-snap']
        )).toEqual(['design-a', 'new-snap']);
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
