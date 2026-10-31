import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as restClient from '../js/arcgis/rest-client.js';
import { downloadUdotFiberLayer } from '../js/symbology/udot-fiber/download.js';
import { ArcGISRestImporter } from '../js/arcgis/rest-importer.js';
import { queryFeatureServerEnvelope } from '../js/live-layers/firewatch/fetch.js';
import { queryFiberFeaturesByEnvelope } from '../js/widgets/sheet-cutting/fiber-operational-fetch.js';
import { queryFeatures } from '../js/widgets/route-milepost-segment/arcgis-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const ARCGIS_LOOP_FILES = [
    'js/arcgis/rest-importer.js',
    'js/live-layers/firewatch/fetch.js',
    'js/live-layers/live-layer-engine.js',
    'js/widgets/sheet-cutting/fiber-operational-fetch.js',
    'js/widgets/route-milepost-segment/arcgis-client.js',
    'js/symbology/udot-fiber/download.js'
];

describe('ArcGIS fetch migration guard', () => {
    it('does not leave raw ArcGIS fetch calls outside rest-client.js', () => {
        for (const rel of ARCGIS_LOOP_FILES) {
            const src = readFileSync(join(root, rel), 'utf8');
            const lines = src.split('\n');
            lines.forEach((line, idx) => {
                if (!line.includes('fetch(')) return;
                if (rel.endsWith('live-layer-engine.js') && line.includes('fetch(runtime.url)')) {
                    return;
                }
                throw new Error(`${rel}:${idx + 1} still uses fetch(): ${line.trim()}`);
            });
        }
    });
});

describe('migrated loops use rest-client', () => {
    beforeEach(() => {
        vi.spyOn(restClient, 'arcgisFetchJson').mockResolvedValue({ features: [] });
        vi.spyOn(restClient, 'arcgisQueryGeoJsonPages').mockResolvedValue({ features: [], truncated: false });
        vi.spyOn(restClient, 'arcgisQueryFeaturesPage').mockResolvedValue({ features: [] });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('firewatch envelope query uses arcgisQueryGeoJsonPages', async () => {
        await queryFeatureServerEnvelope(
            'https://example.com/FeatureServer/0',
            ['OBJECTID'],
            100
        );
        expect(restClient.arcgisQueryGeoJsonPages).toHaveBeenCalled();
    });

    it('sheet fiber envelope query uses arcgisQueryGeoJsonPages', async () => {
        await queryFiberFeaturesByEnvelope(
            'https://example.com/FeatureServer/2',
            { west: -112, south: 40, east: -111, north: 41 }
        );
        expect(restClient.arcgisQueryGeoJsonPages).toHaveBeenCalled();
    });

    it('route-milepost queryFeatures uses arcgisQueryFeaturesPage', async () => {
        vi.spyOn(restClient, 'arcgisFetchJson').mockResolvedValue({
            name: 'Routes',
            fields: [{ name: 'OBJECTID', type: 'esriFieldTypeOID' }],
            geometryType: 'esriGeometryPolyline',
            objectIdField: 'OBJECTID',
            maxRecordCount: 1000
        });

        await queryFeatures('https://example.com/FeatureServer/0', { where: '1=1' });
        expect(restClient.arcgisQueryFeaturesPage).toHaveBeenCalled();
    });

    it('udot fiber download wires abort signal into importer downloadFeatures', async () => {
        vi.spyOn(ArcGISRestImporter.prototype, 'fetchMetadata').mockResolvedValue({
            name: 'Lines',
            url: 'https://example.com/FeatureServer/2',
            fields: [],
            objectIdField: 'OBJECTID'
        });
        const downloadSpy = vi.spyOn(ArcGISRestImporter.prototype, 'downloadFeatures').mockResolvedValue({
            geojson: { type: 'FeatureCollection', features: [] }
        });
        const signal = new AbortController().signal;
        await downloadUdotFiberLayer(2, { signal });
        expect(downloadSpy).toHaveBeenCalledWith(expect.objectContaining({ signal }));
    });
});
