import { describe, expect, it } from 'vitest';
import {
    CLUSTER_LABEL_GEOMETRY_TYPES,
    LINE_LABEL_GEOMETRY_TYPES,
    POINT_LABEL_GEOMETRY_TYPES,
    buildMapLabelLayerSpec,
    buildPolygonAnchorLabelLayerSpec,
    labelGeometryPresence,
    labelPlacementHint,
    shouldInstallLabelLayer
} from '../js/map/map-labels.js';
import { polygonLabelAnchorFeatures } from '../js/map/polygon-label-anchors.js';
import { styleFromDrawingInfo } from '../js/arcgis/drawing-info.js';

const POINT_LABELS = { field: 'name', placement: 'point' };
const LINE_LABELS = { field: 'name', placement: 'line' };

function filterTypes(filter) {
    const match = JSON.stringify(filter);
    return ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']
        .filter((type) => match.includes(`"${type}"`));
}

describe('map label geometry filters', () => {
    it('places point labels on points and multi-points', () => {
        const spec = buildMapLabelLayerSpec('parcels', 'src-parcels', POINT_LABELS, false);
        expect(spec.id).toBe('parcels-labels');
        expect(spec.layout['symbol-placement']).toBe('point');
        expect(filterTypes(spec.filter)).toEqual(POINT_LABEL_GEOMETRY_TYPES);
        expect(filterTypes(spec.filter)).not.toContain('Polygon');
    });

    it('labels each polygon once from an anchor point', () => {
        const polygon = {
            type: 'Feature',
            properties: { NAME: 'Wide' },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-112, 40], [-111, 40], [-111, 41], [-112, 41], [-112, 40]
                ]]
            }
        };
        const anchors = polygonLabelAnchorFeatures([polygon, polygon, {
            type: 'Feature',
            properties: { NAME: 'Line' },
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
        }]);
        expect(anchors).toHaveLength(2);
        expect(anchors.every((feature) => feature.geometry.type === 'Point')).toBe(true);
        expect(anchors[0].properties.NAME).toBe('Wide');

        const spec = buildPolygonAnchorLabelLayerSpec('parcels', 'src-parcels-poly-anchors', POINT_LABELS);
        expect(spec.id).toBe('parcels-labels');
        expect(spec.source).toBe('src-parcels-poly-anchors');
        expect(spec.layout['symbol-placement']).toBe('point');
        expect(spec.layout['symbol-avoid-edges']).toBe(true);
        expect(JSON.stringify(spec.filter)).toContain('_gisPolyAnchor');
        expect(JSON.stringify(spec.filter)).not.toContain('Polygon');
    });

    it('keeps clustered labels on point geometries only', () => {
        const spec = buildMapLabelLayerSpec('sites', 'src-sites', POINT_LABELS, true);
        expect(filterTypes(spec.filter)).toEqual(CLUSTER_LABEL_GEOMETRY_TYPES);
        expect(JSON.stringify(spec.filter)).toContain('point_count');
        expect(filterTypes(spec.filter)).not.toContain('Polygon');
    });

    it('places line labels on lines and multi-lines', () => {
        const spec = buildMapLabelLayerSpec('roads', 'src-roads', LINE_LABELS, false);
        expect(spec.id).toBe('roads-line-labels');
        expect(spec.layout['symbol-placement']).toBe('line');
        expect(filterTypes(spec.filter)).toEqual(LINE_LABEL_GEOMETRY_TYPES);
    });

    it('installs point labels for polygon-only and workspace polygon schemas', () => {
        expect(shouldInstallLabelLayer(POINT_LABELS, { hasPolygons: true })).toBe(true);
        expect(shouldInstallLabelLayer(POINT_LABELS, { hasLines: true })).toBe(false);
        expect(shouldInstallLabelLayer(LINE_LABELS, { hasPolygons: true })).toBe(false);
        expect(shouldInstallLabelLayer(LINE_LABELS, { hasLines: true })).toBe(true);
        expect(shouldInstallLabelLayer({ field: 'name', enabled: false }, { hasPolygons: true })).toBe(false);

        const outsideView = labelGeometryPresence(
            [],
            'Polygon',
            { includeSchema: true }
        );
        expect(outsideView.hasPolygons).toBe(true);
        expect(shouldInstallLabelLayer(POINT_LABELS, outsideView)).toBe(true);

        const multipart = labelGeometryPresence([
            { geometry: { type: 'MultiPoint' } },
            { geometry: { type: 'MultiLineString' } },
            { geometry: { type: 'MultiPolygon' } }
        ]);
        expect(multipart).toEqual({ hasPoints: true, hasLines: true, hasPolygons: true });
    });

    it('describes polygon placement as an interior point', () => {
        expect(labelPlacementHint({ placement: 'point', hasPolygons: true })).toBe('Labels at an interior point');
        expect(labelPlacementHint({ placement: 'point', hasPoints: true })).toBe('Labels at point locations');
        expect(labelPlacementHint({ placement: 'line', hasLines: true })).toBe('Labels follow line geometry');
        expect(labelPlacementHint({ placement: 'point' })).not.toMatch(/requires point features/i);
    });

    it('applies imported ArcGIS polygon labelingInfo to polygon label layers', () => {
        const style = styleFromDrawingInfo({
            renderer: {
                type: 'simple',
                symbol: {
                    type: 'esriSFS',
                    color: [252, 229, 204, 255],
                    outline: { type: 'esriSLS', color: [110, 110, 110, 255], width: 1 }
                }
            },
            labelingInfo: [{
                labelExpression: '[NAME]',
                labelPlacement: 'esriServerPolygonPlacementAlwaysHorizontal'
            }]
        }, { geometryType: 'Polygon', displayField: 'NAME' });

        expect(style.labels.enabled).toBe(true);
        expect(style.labels.field).toBe('NAME');
        expect(style.labels.placement).toBe('point');

        const spec = buildPolygonAnchorLabelLayerSpec('poly', 'src-poly-poly-anchors', style.labels);
        expect(spec.layout['symbol-placement']).toBe('point');
        expect(spec.layout['symbol-avoid-edges']).toBe(true);
        expect(spec.layout['text-field']).toEqual(['to-string', ['get', 'NAME']]);
        expect(spec.layout['text-offset']).toEqual([0, 1.1]);
        expect(JSON.stringify(spec.filter)).not.toContain('Polygon');
        expect(shouldInstallLabelLayer(style.labels, { hasPolygons: true, hasPoints: false, hasLines: false })).toBe(true);
    });
});
