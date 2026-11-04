import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as restClient from '../js/arcgis/rest-client.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MOCK_FEATURE_SERVER = `http://127.0.0.1:${process.env.ARCGIS_MOCK_PORT || '18765'}/mock/FeatureServer/5`;

const workspaceBatches = [];

vi.mock('../js/workspace/workspace-store.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        createWorkspaceLayer: vi.fn(async () => {}),
        appendWorkspaceBatch: vi.fn(async (_layerId, features) => {
            workspaceBatches.push(features);
            return 'chunk-0';
        }),
        flushSpatialIndexSave: vi.fn(async () => {})
    };
});

describe('ArcGIS REST import picture markers', () => {
    beforeEach(() => {
        workspaceBatches.length = 0;
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
        await importer.fetchMetadata(MOCK_FEATURE_SERVER);
        const dataset = await importer.downloadFeatures({ allowLargeDownload: true });
        expect(dataset._arcgisPictureMarkers?.markers?.length).toBeGreaterThan(0);
        const stamped = dataset.geojson.features.filter((f) => f.properties?._udotGlyph);
        expect(stamped.length).toBeGreaterThan(0);
        expect(stamped[0].properties._udotGlyph).toMatch(/^arcgis-pms-/);
    });

    it('workspace stream path stamps _udotGlyph on chunked batches', async () => {
        const { ArcGISRestImporter } = await import('../js/arcgis/rest-importer.js');
        const importer = new ArcGISRestImporter();
        await importer.fetchMetadata(MOCK_FEATURE_SERVER);
        const dataset = await importer.downloadFeatures({
            allowLargeDownload: true,
            useWorkspace: true
        });
        expect(dataset.type).toBe('spatial-chunked');
        expect(dataset._arcgisPictureMarkers?.markers?.length).toBeGreaterThan(0);
        expect(workspaceBatches.length).toBeGreaterThan(0);
        const stored = workspaceBatches.flat();
        const stamped = stored.filter((f) => f.properties?._udotGlyph);
        expect(stamped.length).toBeGreaterThan(0);
        expect(stamped[0].properties._udotGlyph).toMatch(/^arcgis-pms-/);
    });
});
