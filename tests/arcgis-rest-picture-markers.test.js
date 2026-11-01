import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as restClient from '../js/arcgis/rest-client.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('ArcGIS REST import picture markers', () => {
    beforeEach(() => {
        vi.spyOn(restClient, 'arcgisFetchJson').mockImplementation(async (url) => {
            if (String(url).includes('?f=json') && !String(url).includes('/query')) {
                return {
                    name: 'PMS Layer',
                    type: 'Feature Layer',
                    geometryType: 'esriGeometryPoint',
                    objectIdField: 'OBJECTID',
                    fields: [{ name: 'OBJECTID', type: 'esriFieldTypeOID' }, { name: 'MODEL', type: 'esriFieldTypeString' }],
                    drawingInfo: {
                        renderer: {
                            type: 'uniqueValue',
                            field1: 'MODEL',
                            uniqueValueInfos: [{
                                value: 'Cabinet',
                                symbol: {
                                    type: 'esriPMS',
                                    url: 'abc123',
                                    imageData: PNG,
                                    contentType: 'image/png',
                                    width: 24
                                }
                            }]
                        }
                    }
                };
            }
            return { count: 1 };
        });
        vi.spyOn(restClient, 'arcgisQueryFeatureCount').mockResolvedValue({ count: 1, countFailed: false });
        vi.spyOn(restClient, 'arcgisQueryAllEsriFeatures').mockImplementation(async (options) => {
            const features = [{
                attributes: { OBJECTID: 1, MODEL: 'Cabinet' },
                geometry: { x: -111.5, y: 40.5 }
            }];
            if (options.onPage) await options.onPage(features);
            return { featureCount: features.length, truncated: false, capped: false };
        });
        vi.spyOn(restClient, 'arcgisResolveLayerAttribution').mockResolvedValue('');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('downloadFeatures stamps _udotGlyph from drawingInfo (mocked fetch)', async () => {
        const { ArcGISRestImporter } = await import('../js/arcgis/rest-importer.js');
        const importer = new ArcGISRestImporter();
        await importer.fetchMetadata('http://127.0.0.1:18765/mock/FeatureServer/5');
        const dataset = await importer.downloadFeatures({ allowLargeDownload: true });
        expect(dataset._arcgisPictureMarkers?.markers?.length).toBeGreaterThan(0);
        const stamped = dataset.geojson.features.filter((f) => f.properties?._udotGlyph);
        expect(stamped.length).toBeGreaterThan(0);
        expect(stamped[0].properties._udotGlyph).toMatch(/^arcgis-pms-/);
    });
});
