import { describe, expect, it } from 'vitest';
import {
    resolveEsriLineDasharray,
    decorateFeaturesWithPictureMarkers,
    esriLineStyleToDash,
    pictureMarkersFromDrawingInfo,
    attachPictureMarkersToDataset
} from '../js/arcgis/picture-markers.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('ArcGIS picture markers', () => {
    it('maps ESRI line styles to dash arrays', () => {
        expect(esriLineStyleToDash('esriSLSSolid')).toBeNull();
        expect(esriLineStyleToDash('esriSLSDash')).toEqual([3, 2]);
        expect(resolveEsriLineDasharray([
            { value: '1 in', style: 'esriSLSDash' },
            { value: '2 in', style: 'esriSLSDash' }
        ])).toEqual([3, 2]);
        expect(resolveEsriLineDasharray([
            { value: '48', style: 'esriSLSSolid' }
        ])).toBeNull();
    });

    it('extracts esriPMS imageData from uniqueValue renderer', () => {
        const pack = pictureMarkersFromDrawingInfo({
            renderer: {
                type: 'uniqueValue',
                field1: 'MODEL',
                uniqueValueInfos: [
                    {
                        value: 'CCTV(E)-R1',
                        label: 'ITS Cabinet',
                        symbol: {
                            type: 'esriPMS',
                            url: 'abc123',
                            imageData: PNG,
                            contentType: 'image/png'
                        }
                    }
                ]
            }
        });
        expect(pack.field).toBe('MODEL');
        expect(pack.matchMode).toBe('unique');
        expect(pack.markers).toHaveLength(1);
        expect(pack.markers[0].value).toBe('CCTV(E)-R1');
        expect(pack.markers[0].imageData).toBe(PNG);
        expect(pack.markers[0].esriWidth).toBe(24);
    });

    it('stamps matching features with the published icon id', () => {
        const pack = {
            field: 'MODEL',
            markers: [{ value: 'Cabinet', imageId: 'arcgis-pms-cab' }]
        };
        const out = decorateFeaturesWithPictureMarkers([
            { type: 'Feature', properties: { MODEL: 'Cabinet' }, geometry: null },
            { type: 'Feature', properties: { MODEL: 'Other' }, geometry: null }
        ], pack);
        expect(out[0].properties._udotGlyph).toBe('arcgis-pms-cab');
        expect(out[0].properties._udotEsriWidth).toBe(24);
        expect(out[1].properties._udotGlyph).toBeUndefined();
    });

    it('extracts esriPMS from a simple renderer symbol', () => {
        const pack = pictureMarkersFromDrawingInfo({
            renderer: {
                type: 'simple',
                symbol: {
                    type: 'esriPMS',
                    url: 'pin1',
                    imageData: PNG,
                    width: 18,
                    height: 18
                }
            }
        });
        expect(pack.matchMode).toBe('all');
        expect(pack.field).toBeNull();
        expect(pack.markers).toHaveLength(1);
        expect(pack.markers[0].esriWidth).toBe(18);
        const out = decorateFeaturesWithPictureMarkers([
            { type: 'Feature', properties: { NAME: 'A' }, geometry: null },
            { type: 'Feature', properties: {}, geometry: null }
        ], pack);
        expect(out[0].properties._udotGlyph).toMatch(/^arcgis-pms-/);
        expect(out[1].properties._udotGlyph).toMatch(/^arcgis-pms-/);
    });

    it('attachPictureMarkersToDataset stamps geojson on import shell', () => {
        const ds = {
            geojson: {
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', properties: { MODEL: 'Cabinet' }, geometry: { type: 'Point', coordinates: [0, 0] } }
                ]
            }
        };
        attachPictureMarkersToDataset(ds, {
            renderer: {
                type: 'uniqueValue',
                field1: 'MODEL',
                uniqueValueInfos: [{
                    value: 'Cabinet',
                    symbol: { type: 'esriPMS', url: 'cab', imageData: PNG, width: 24 }
                }]
            }
        });
        expect(ds._arcgisPictureMarkers?.markers).toHaveLength(1);
        expect(ds.geojson.features[0].properties._udotGlyph).toMatch(/^arcgis-pms-/);
    });
});
