import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import toGeoJSON from '@mapbox/togeojson';
import { parseProjectKit } from '../js/core/project-kit.js';
import { prepareLayersFromKitSection } from '../js/core/layer-restore.js';
import { TaskRunner } from '../js/core/task-runner.js';
import {
    createSpatialDataset,
    getLayerFeatureCount,
    syncSpatialSchemaFeatureCount
} from '../js/core/data-model.js';
import { importGPX } from '../js/import/gpx-importer.js';
import { finalizeImportedDatasets } from '../js/import/post-import.js';
import { exportGeoJSON } from '../js/export/geojson-exporter.js';
import { parseGpxText } from '../js/import/parsers/parse-gpx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kitPath = path.join(__dirname, 'fixtures/import-mini.gis-toolbox');
const gpxPath = path.join(__dirname, 'fixtures/gpx-wpt-rte-multiseg.gpx');

describe('project kit import (regression)', () => {
    it('parses a mini kit and materializes spatial layers for registration', async () => {
        const buffer = readFileSync(kitPath);
        const snapshot = await parseProjectKit(buffer, JSZip);
        expect(snapshot.layers?.index?.length).toBeGreaterThan(0);

        const { datasets } = await prepareLayersFromKitSection({
            layersSection: snapshot.layers,
            kitZip: snapshot._zip
        });

        expect(datasets.length).toBeGreaterThan(0);
        expect(datasets[0].type).toBe('spatial');
        expect(datasets[0].geojson?.features?.length).toBeGreaterThan(0);
        expect(getLayerFeatureCount(datasets[0])).toBe(datasets[0].geojson.features.length);
    });
});

describe('GPX feature count vs GeoJSON export (regression)', () => {
    it('layer list count matches GeoJSON export after import (multi-seg track fixture)', async () => {
        const text = readFileSync(gpxPath, 'utf8');
        const file = new File([text], 'gpx-wpt-rte-multiseg.gpx', { type: 'application/gpx+xml' });
        const task = new TaskRunner('test', 'GPX');
        const dataset = await importGPX(file, task);

        const { expanded } = await finalizeImportedDatasets([dataset]);
        expect(expanded.length).toBeGreaterThan(0);

        for (const layer of expanded) {
            layer.schema = { ...layer.schema, featureCount: 3 };
            syncSpatialSchemaFeatureCount(layer);
            const listed = getLayerFeatureCount(layer);
            const { text: exportedText } = await exportGeoJSON(layer, {}, null);
            const exported = JSON.parse(exportedText);
            expect(listed, layer.name).toBe(exported.features.length);
            expect(listed).toBe(layer.geojson.features.length);
        }
    });

    it('parseGpxText materializes waypoints, route, and multi-segment track as features', () => {
        const text = readFileSync(gpxPath, 'utf8');
        const { geojson } = parseGpxText(text, {
            DOMParserImpl: DOMParser,
            toGeoJsonLib: toGeoJSON
        });
        expect(geojson.features.length).toBeGreaterThanOrEqual(4);
        const types = new Set(geojson.features.map((f) => f.geometry?.type));
        expect(types.has('Point')).toBe(true);
        expect(types.has('LineString') || types.has('MultiLineString')).toBe(true);
    });

    it('getLayerFeatureCount prefers stored geojson over stale schema for in-memory layers', () => {
        const layer = createSpatialDataset('stale-schema', {
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', properties: { id: 1 }, geometry: { type: 'Point', coordinates: [0, 0] } },
                { type: 'Feature', properties: { id: 2 }, geometry: { type: 'Point', coordinates: [1, 1] } }
            ]
        });
        layer.schema.featureCount = 99;
        expect(getLayerFeatureCount(layer)).toBe(2);
    });
});
