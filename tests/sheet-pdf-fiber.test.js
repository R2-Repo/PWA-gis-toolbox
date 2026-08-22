// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { UDOT_FIBER_SERVICE_URL } from '../js/symbology/udot-fiber/constants.js';
import {
    buildUdotFiberPdfStyle,
    collectUdotFiberSheetFeatures,
    isUdotFiberPaintLayer,
    layoutUdotFiberPdfBox,
    listVisibleUdotFiberLayerIds,
    omitRasterizedLiveFeatures,
    suspendUdotFiberLineLabels,
    UDOT_PDF_BOX_ASPECT,
    wrapUdotFiberPdfBoxLabel
} from '../js/widgets/sheet-cutting/sheet-pdf-fiber.js';

describe('sheet PDF Fiber capture helpers', () => {
    it('detects Fiber from style metadata or MapServer URL', () => {
        expect(isUdotFiberPaintLayer({ service: { url: `${UDOT_FIBER_SERVICE_URL}/6` } })).toBe(true);
        expect(isUdotFiberPaintLayer({}, { _udotFiber: { layerKey: 'boxes' } })).toBe(true);
        expect(isUdotFiberPaintLayer({ name: 'Trails' }, { strokeColor: '#2563eb' })).toBe(false);
    });

    it('lists only visible Fiber live layers', () => {
        const visibility = new Map([
            ['fiber', true],
            ['boxes', false],
            ['trails', true]
        ]);
        const mapService = {
            getMap: () => ({
                getLayer: (id) => ({ id }),
                getLayoutProperty: (id, prop) => {
                    if (prop !== 'visibility') return 'visible';
                    const parent = id.replace(/-line$/, '');
                    return visibility.get(parent) ? 'visible' : 'none';
                }
            }),
            getLayerRecord: (layerId) => ({ layerIds: [`${layerId}-line`] }),
            getLayerStyle: (layerId) => (
                layerId === 'fiber' || layerId === 'boxes'
                    ? { _udotFiber: { layerKey: layerId } }
                    : null
            )
        };
        const layers = [
            { id: 'fiber', service: { url: `${UDOT_FIBER_SERVICE_URL}/6` } },
            { id: 'boxes', service: { url: `${UDOT_FIBER_SERVICE_URL}/4` } },
            { id: 'trails' }
        ];
        expect(listVisibleUdotFiberLayerIds(mapService, layers)).toEqual(['fiber']);
    });

    it('hides only Fiber and Conduit line labels', () => {
        const visibility = new Map([
            ['svc-fiber-line-labels', 'visible'],
            ['svc-fiber-line', 'visible'],
            ['svc-boxes-labels', 'visible']
        ]);
        const map = {
            getLayer: (id) => (visibility.has(id) ? { id } : null),
            getLayoutProperty: (id, prop) => (prop === 'visibility' ? visibility.get(id) : null),
            setLayoutProperty: (id, prop, value) => {
                if (prop === 'visibility') visibility.set(id, value);
            }
        };
        const mapService = {
            getMap: () => map,
            getLayerStyle: (id) => ({ _udotFiber: { layerKey: id } }),
            getLayerRecord: (id) => ({
                layerIds: id === 'fiber'
                    ? ['svc-fiber-line', 'svc-fiber-line-labels']
                    : ['svc-boxes-circle', 'svc-boxes-labels']
            })
        };
        const layers = [
            { id: 'fiber', _udotFiberLayerKey: 'fiber' },
            { id: 'boxes', _udotFiberLayerKey: 'boxes' }
        ];
        const restore = suspendUdotFiberLineLabels(mapService, ['fiber', 'boxes'], layers);
        expect(visibility.get('svc-fiber-line-labels')).toBe('none');
        expect(visibility.get('svc-fiber-line')).toBe('visible');
        expect(visibility.get('svc-boxes-labels')).toBe('visible');
        restore();
        expect(visibility.get('svc-fiber-line-labels')).toBe('visible');
    });

    it('builds vector Fiber/Conduit styles without along-line labels', () => {
        const fiber = buildUdotFiberPdfStyle({
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { FIBER_SYMBOLS: '48', Fiber_Label: 'UDOT 048 SMF', _udotFiberKey: 'fiber' }
        }, { _udotFiber: { layerKey: 'fiber' } });
        expect(fiber.kind).toBe('fiber_line');
        expect(fiber.labelField).toBeNull();
        expect(fiber.strokes).toHaveLength(1);
        expect(fiber.strokes[0].strokeColor).not.toBe('#0a0a0a');
        expect(fiber.strokes[0].strokeWidth).toBeLessThan(1);

        const conduit = buildUdotFiberPdfStyle({
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { CONDUIT_SYM: '1 in', CustNameRight: '2 IMD 10mm', _udotFiberKey: 'conduit' }
        }, { _udotFiber: { layerKey: 'conduit' } });
        expect(conduit.kind).toBe('fiber_line');
        expect(conduit.labelField).toBeNull();
        expect(conduit.strokes).toHaveLength(1);
        expect(conduit.strokes[0].dash).toEqual([2.1, 1.6]);
        expect(conduit.strokes[0].strokeWidth).toBeLessThan(1);
    });

    it('keeps landscape box aspect and wraps long in-box labels', () => {
        expect(wrapUdotFiberPdfBoxLabel('First Digital CentraCom')).toEqual([
            'First Digital',
            'CentraCom'
        ]);
        const empty = layoutUdotFiberPdfBox('', 4.8);
        const short = layoutUdotFiberPdfBox('II', 4.8);
        const long = layoutUdotFiberPdfBox('First Digital CentraCom', 4.8);
        expect(short.lines).toEqual(['II']);
        expect(long.lines).toEqual(['First Digital', 'CentraCom']);
        expect(short.halfWidth / short.halfHeight).toBeCloseTo(UDOT_PDF_BOX_ASPECT, 5);
        expect(long.halfWidth / long.halfHeight).toBeCloseTo(UDOT_PDF_BOX_ASPECT, 5);
        expect(empty.halfWidth / empty.halfHeight).toBeCloseTo(UDOT_PDF_BOX_ASPECT, 5);
        expect(long.halfWidth).toBeCloseTo(short.halfWidth, 5);
        expect(short.halfWidth).toBeGreaterThan(5);
        expect(long.fontSize).toBeLessThan(short.fontSize);
    });

    it('paints cabinets with the map lookalike color', () => {
        const cabinet = buildUdotFiberPdfStyle({
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { MODEL: 'CCTV(E)-R1', _udotFiberKey: 'cabinets' }
        }, { _udotFiber: { layerKey: 'cabinets' } });
        expect(cabinet.kind).toBe('fiber_point');
        expect(cabinet.glyph).toBe('square-x');
        expect(cabinet.fillColor).toBe('#00ff00');
        expect(cabinet.strokeColor).toBe('#00ff00');
    });

    it('keeps BOXLABELS on box points', () => {
        const box = buildUdotFiberPdfStyle({
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: {
                DT_RSCENCLOSURE_NAME: 'Exist Type I PC-R1',
                BOXLABELS: 'First Digital CentraCom',
                _udotBoxLabel: 1,
                _udotFiberKey: 'boxes'
            }
        }, { _udotFiber: { layerKey: 'boxes' } });
        expect(box.glyph).toBe('rect');
        expect(box.boxLabel).toBe('First Digital CentraCom');
        expect(box.fillColor).toBe('#111111');
    });

    it('collects Fiber features from the live viewport cache', () => {
        const mapService = {
            getLayerStyle: () => ({ _udotFiber: { layerKey: 'fiber' } }),
            getLayerRecord: () => ({
                geojson: {
                    features: [{
                        type: 'Feature',
                        geometry: { type: 'LineString', coordinates: [[-112, 40], [-111, 40]] },
                        properties: { Fiber_Label: 'skip me' }
                    }]
                }
            })
        };
        const layers = [{ id: 'fiber', service: { url: `${UDOT_FIBER_SERVICE_URL}/6` } }];
        const features = collectUdotFiberSheetFeatures(mapService, ['fiber'], null, layers);
        expect(features).toHaveLength(1);
        expect(features[0].properties._udotFiberKey).toBe('fiber');
        expect(buildUdotFiberPdfStyle(features[0], { _udotFiber: { layerKey: 'fiber' } }).labelField).toBeNull();
    });

    it('collects operational Fiber copies from the map record with the same PDF style', () => {
        const mapService = {
            getLayerStyle: () => ({ _udotFiber: { layerKey: 'fiber' } }),
            getLayerRecord: () => ({
                geojson: {
                    features: [{
                        type: 'Feature',
                        geometry: { type: 'LineString', coordinates: [[-112, 40.001], [-111, 40.001]] },
                        properties: { Fiber_Label: '48 SM', _udotDisplayOffsetM: 1.75 }
                    }]
                }
            })
        };
        const layers = [{
            id: 'snap-fiber',
            type: 'spatial',
            _udotFiberLayerKey: 'fiber',
            geojson: { features: [] }
        }];
        const features = collectUdotFiberSheetFeatures(mapService, ['snap-fiber'], null, layers);
        expect(features).toHaveLength(1);
        expect(features[0].properties._udotFiberKey).toBe('fiber');
        expect(features[0].properties._udotDisplayOffsetM).toBe(1.75);
        const style = buildUdotFiberPdfStyle(features[0], { _udotFiber: { layerKey: 'fiber' } });
        expect(style.kind).toBe('fiber_line');
        expect(style.strokes[0].strokeWidth).toBe(0.62);
        expect(style.labelField).toBeNull();
    });

    it('omits rasterized Fiber features but keeps sheet annotations', () => {
        const collection = {
            type: 'FeatureCollection',
            features: [
                { properties: { feature_type: 'sheet_outline' }, geometry: { type: 'Polygon', coordinates: [] } },
                { properties: { feature_type: 'matchline_see_label' }, geometry: { type: 'Point', coordinates: [0, 0] } },
                { properties: { _sourceLayerId: 'fiber' }, geometry: { type: 'LineString', coordinates: [] } },
                { properties: { _sourceLayerId: 'design-a' }, geometry: { type: 'LineString', coordinates: [] } }
            ]
        };
        const next = omitRasterizedLiveFeatures(collection, ['fiber']);
        expect(next.features.map((f) => f.properties.feature_type || f.properties._sourceLayerId)).toEqual([
            'sheet_outline',
            'matchline_see_label',
            'design-a'
        ]);
    });
});
