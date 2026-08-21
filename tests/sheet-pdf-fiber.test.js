import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildUdotFiberLayerStyle } from '../js/symbology/udot-fiber/resolve-style.js';
import {
    prepareUdotFiberExportFeatures,
    resolveUdotFiberLayerKey,
    resolveUdotFiberSheetPdfStyle,
    udotFiberExportWhere,
    udotFiberSheetDrawOrder
} from '../js/symbology/udot-fiber/sheet-export.js';
import { UDOT_FIBER_LINE_CORE_WIDTH } from '../js/symbology/udot-fiber/paint.js';
import { resolveVectorFeatureStyle } from '../js/widgets/sheet-cutting/sheet-pdf-vector.js';
import {
    keepPdfTextUpright,
    midpointAlongPolyline
} from '../js/widgets/sheet-cutting/sheet-pdf-fiber.js';
import {
    collectGeometryCoords,
    collectSheetDesignFeatures,
    envelopeFromCoords,
    envelopeFromSheetSession
} from '../js/widgets/sheet-cutting/design-features.js';
import { queryArcgisVectorEnvelope } from '../js/live-layers/arcgis-vector-query.js';
import { udotFiberIconPxAtZoom, UDOT_FIBER_GROUND_LOCK_ZOOM } from '../js/symbology/udot-fiber/zoom-scale.js';

const FIBER_URL = 'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6';
const CONDUIT_URL = 'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/7';

describe('UDOT Fiber sheet export styles', () => {
    it('resolves fiber layer keys from live service URLs', () => {
        expect(resolveUdotFiberLayerKey({ service: { url: FIBER_URL } })).toBe('fiber');
        expect(resolveUdotFiberLayerKey({ service: { url: CONDUIT_URL } })).toBe('conduit');
        expect(resolveUdotFiberLayerKey({ _udotFiberLayerKey: 'cabinets' })).toBe('cabinets');
        expect(resolveUdotFiberLayerKey({ url: 'https://example.com/MapServer/0' })).toBeNull();
    });

    it('matches map class color and casing stack for fiber lines', () => {
        const style = buildUdotFiberLayerStyle('fiber');
        const feature = {
            type: 'Feature',
            properties: {
                _udotFiberKey: 'fiber',
                FIBER_SYMBOLS: '2',
                Fiber_Label: 'Some unlabeled sheath'
            },
            geometry: { type: 'LineString', coordinates: [[-111, 40], [-111.01, 40.01]] }
        };
        const pdf = resolveUdotFiberSheetPdfStyle('fiber', feature, style);
        expect(pdf.kind).toBe('line');
        expect(pdf.strokeColor).toBe('#878700');
        expect(pdf.strokeWidth).toBe(UDOT_FIBER_LINE_CORE_WIDTH.fiber);
        expect(pdf.casing?.color).toBe('#0a0a0a');
        expect(pdf.glow?.color).toBe('#878700');
        expect(pdf.labelField).toBe('Fiber_Label');
        expect(pdf.color).toBe('#878700');
        expect(pdf.haloColor).toBe('#ffffff');
    });

    it('keeps conduit dashed with no grey casing underlay', () => {
        const style = buildUdotFiberLayerStyle('conduit');
        const feature = {
            type: 'Feature',
            properties: { _udotFiberKey: 'conduit', CONDUIT_SYM: '1 in' },
            geometry: { type: 'LineString', coordinates: [[-111, 40], [-111.01, 40]] }
        };
        const pdf = resolveUdotFiberSheetPdfStyle('conduit', feature, style);
        expect(pdf.dash).toEqual([3, 2]);
        expect(pdf.casing).toBeNull();
        expect(pdf.glow).toBeNull();
        expect(pdf.strokeWidth).toBe(UDOT_FIBER_LINE_CORE_WIDTH.conduit);
        expect(pdf.labelSize).toBeLessThan(
            resolveUdotFiberSheetPdfStyle('fiber', {
                properties: { FIBER_SYMBOLS: '2' },
                geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
            }, buildUdotFiberLayerStyle('fiber')).labelSize
        );
    });

    it('uses lookalike glyphs for cabinets, splices, and boxes', () => {
        const cabinet = resolveUdotFiberSheetPdfStyle('cabinets', {
            properties: { MODEL: 'Cabinet' },
            geometry: { type: 'Point', coordinates: [-111, 40] }
        });
        expect(cabinet.glyph.kind).toBe('square-x');
        expect(cabinet.glyph.color).toBe('#00ff00');
        expect(cabinet.radius).toBeCloseTo(udotFiberIconPxAtZoom('cabinets', UDOT_FIBER_GROUND_LOCK_ZOOM), 5);

        const splice = resolveUdotFiberSheetPdfStyle('splices', {
            properties: { MODEL: 'Splice' },
            geometry: { type: 'Point', coordinates: [-111, 40] }
        });
        expect(splice.glyph.kind).toBe('bowtie');
        expect(splice.glyph.color).toBe('#ff0000');

        const box = resolveUdotFiberSheetPdfStyle('boxes', {
            properties: { DT_RSCENCLOSURE_NAME: 'Type I' },
            geometry: { type: 'Point', coordinates: [-111, 40] }
        });
        expect(box.glyph.kind).toBe('rect');
        expect(box.glyph.color).toBe('#111111');
    });

    it('hooks fiber styles through the sheet vector resolver', () => {
        const style = resolveVectorFeatureStyle(
            {
                properties: { _udotFiberKey: 'fiber', FIBER_SYMBOLS: '4-12' },
                geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
            },
            buildUdotFiberLayerStyle('fiber')
        );
        expect(style.strokeColor).toBe('#0000ff');
        expect(style.casing).toBeTruthy();
        expect(style.labelField).toBe('Fiber_Label');
    });

    it('draws fiber layers in map stack order', () => {
        const conduit = udotFiberSheetDrawOrder({ properties: { _udotFiberKey: 'conduit' } });
        const fiber = udotFiberSheetDrawOrder({ properties: { _udotFiberKey: 'fiber' } });
        const boxes = udotFiberSheetDrawOrder({ properties: { _udotFiberKey: 'boxes' } });
        const splices = udotFiberSheetDrawOrder({ properties: { _udotFiberKey: 'splices' } });
        const cabinets = udotFiberSheetDrawOrder({ properties: { _udotFiberKey: 'cabinets' } });
        expect(conduit).toBeLessThan(fiber);
        expect(fiber).toBeLessThan(boxes);
        expect(boxes).toBeLessThan(splices);
        expect(splices).toBeLessThan(cabinets);
    });

    it('stamps fiber keys and skips excluded box classes', () => {
        const prepared = prepareUdotFiberExportFeatures('boxes', [
            { type: 'Feature', properties: { DT_RSCENCLOSURE_NAME: 'Type II' }, geometry: { type: 'Point', coordinates: [0, 0] } },
            { type: 'Feature', properties: { DT_RSCENCLOSURE_NAME: 'POE' }, geometry: { type: 'Point', coordinates: [1, 1] } }
        ], { layerId: 'lyr-boxes' });
        expect(prepared).toHaveLength(1);
        expect(prepared[0].properties._udotFiberKey).toBe('boxes');
        expect(prepared[0].properties._sourceLayerId).toBe('lyr-boxes');
        expect(udotFiberExportWhere('boxes')).toContain('POE');
    });

    it('offsets multi-sheath fiber copies once', () => {
        const line = {
            type: 'Feature',
            properties: { MULTISHEATH: 3, Fiber_Label: 'parallel' },
            geometry: { type: 'LineString', coordinates: [[0, 40], [0.01, 40]] }
        };
        const first = prepareUdotFiberExportFeatures('fiber', [line, { ...line }], { layerId: 'f' });
        const again = prepareUdotFiberExportFeatures('fiber', first, { layerId: 'f' });
        expect(first.some((feature) => feature.properties._udotDisplayOffsetM)).toBe(true);
        expect(again[1].geometry.coordinates[0][1]).toBeCloseTo(first[1].geometry.coordinates[0][1], 8);
    });
});

describe('sheet fiber PDF helpers', () => {
    it('keeps along-line labels upright', () => {
        expect(keepPdfTextUpright(170)).toBe(-10);
        expect(keepPdfTextUpright(-170)).toBe(10);
    });

    it('finds the midpoint of a polyline', () => {
        const mid = midpointAlongPolyline([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 }
        ]);
        expect(mid.x).toBeCloseTo(10, 5);
        expect(mid.y).toBeCloseTo(0, 5);
    });
});

describe('sheet design feature collection', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('builds an envelope from route coordinates', () => {
        const env = envelopeFromSheetSession({
            routeLine: {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[-112, 40], [-111, 40.1]] }
            },
            sheets: { template: { corridorWidthFt: 350 }, sheets: [] }
        });
        expect(env.west).toBeLessThan(-112);
        expect(env.east).toBeGreaterThan(-111);
        expect(env.south).toBeLessThan(40);
        expect(env.north).toBeGreaterThan(40.1);
    });

    it('walks nested geometry coordinates', () => {
        const coords = collectGeometryCoords({
            type: 'MultiLineString',
            coordinates: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]]
        });
        expect(coords).toHaveLength(4);
        expect(envelopeFromCoords(coords)).toEqual({ west: 1, south: 2, east: 7, north: 8 });
    });

    it('queries live fiber layers by corridor envelope', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: { FIBER_SYMBOLS: '2', Fiber_Label: 'MS 72' },
                    geometry: { type: 'LineString', coordinates: [[-111.5, 40.2], [-111.4, 40.21]] }
                }]
            })
        }));
        vi.stubGlobal('fetch', fetchMock);

        const features = await collectSheetDesignFeatures({
            getLayerById: () => ({
                id: 'udot-fiber-lines',
                type: 'service',
                service: { kind: 'arcgis-mapserver-vector', url: FIBER_URL },
                source: { url: FIBER_URL }
            }),
            mapService: { getLayerStyle: () => buildUdotFiberLayerStyle('fiber') }
        }, ['udot-fiber-lines'], {
            envelope: { west: -112, south: 40, east: -111, north: 41 }
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toContain('/MapServer/6/query');
        expect(features[0].properties._udotFiberKey).toBe('fiber');
        expect(features[0].properties._sourceLayerId).toBe('udot-fiber-lines');
    });
});

describe('ArcGIS envelope query', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('pages until the transfer limit clears', async () => {
        const fetchMock = vi.fn(async (url) => {
            const offset = Number(new URL(url).searchParams.get('resultOffset'));
            return {
                ok: true,
                json: async () => ({
                    type: 'FeatureCollection',
                    features: offset === 0
                        ? [{ type: 'Feature', properties: { id: 1 }, geometry: { type: 'Point', coordinates: [0, 0] } }]
                        : [],
                    exceededTransferLimit: offset === 0
                })
            };
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await queryArcgisVectorEnvelope(
            'https://example.com/MapServer/0',
            { west: 0, south: 0, east: 1, north: 1 },
            { pageSize: 1 }
        );
        expect(result.features).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
