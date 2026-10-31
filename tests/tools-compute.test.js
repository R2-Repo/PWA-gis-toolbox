import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';
import { createSpatialDataset } from '../js/core/data-model.js';
import {
    bufferFeatures,
    clipFeatures,
    dissolveFeatures,
    unionFeatures,
    spatialJoinPointsInPolygons,
    intersectLayers,
    mergeLayers,
    sampleFeatures
} from '../js/tools/gis-tools.js';
import {
    bufferFeatureCollection,
    clipFeatureCollection,
    dissolveFeatureCollection,
    unionFeatureCollection,
    spatialJoinFeatureCollections,
    intersectFeatureCollections,
    mergeFeatureCollections,
    sampleFeatureCollection
} from '../js/tools/compute/spatial-operations.js';
import { computeClip as toolsComputeClip } from '../js/tools/compute/spatial-operations.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const COMPUTE_DIR = join(__dir, '../js/tools/compute');

beforeAll(() => {
    globalThis.turf = turf;
});

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const key of Object.keys(value)) {
            deepFreeze(value[key]);
        }
    }
    return value;
}

function datasetFrom(features, name = 'test') {
    return createSpatialDataset(name, { type: 'FeatureCollection', features }, {
        format: 'derived',
        schema: { fields: [{ name: 'id', type: 'number' }], featureCount: features.length }
    });
}

function normalizeFc(fc) {
    return JSON.parse(JSON.stringify(fc));
}

describe('tools/compute parity with gis-tools', () => {
    const clipPoly = turf.bboxPolygon([-111.5, 40.5, -111.4, 40.6]).geometry;
    const highLatClip = turf.bboxPolygon([10, 70, 11, 71]).geometry;

    it('clip matches gis-tools (MultiPoint, empty, high latitude)', async () => {
        const cases = [
            turf.multiPoint([[-111.55, 40.55], [-111.45, 40.55]], { id: 1 }),
            { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [] } },
            turf.point([10.5, 70.5], { id: 'arctic' })
        ];
        for (const feat of cases) {
            const ds = datasetFrom([feat]);
            const fromTools = await clipFeatures(ds, clipPoly);
            const fromCompute = clipFeatureCollection(ds.geojson, clipPoly);
            expect(normalizeFc(fromCompute.geojson)).toEqual(normalizeFc(fromTools.geojson));
        }
        const arctic = datasetFrom([turf.point([10.5, 70.5])]);
        const toolsArctic = await clipFeatures(arctic, highLatClip);
        const computeArctic = clipFeatureCollection(arctic.geojson, highLatClip);
        expect(normalizeFc(computeArctic.geojson)).toEqual(normalizeFc(toolsArctic.geojson));
    });

    it('buffer and dissolve match gis-tools on fixtures', async () => {
        const pt = turf.point([-111.9, 40.7], { id: 1 });
        const ds = datasetFrom([pt]);
        const bufTools = await bufferFeatures(ds, 0.01, 'kilometers');
        const bufCompute = bufferFeatureCollection(ds.geojson, { distance: 0.01, units: 'kilometers' });
        expect(bufCompute.geojson.features.length).toBe(bufTools.geojson.features.length);

        const polyA = turf.polygon([[[-112, 40], [-111.9, 40], [-111.9, 40.1], [-112, 40.1], [-112, 40]]], { g: 'a' });
        const polyB = turf.polygon([[[-111.95, 40.02], [-111.85, 40.02], [-111.85, 40.08], [-111.95, 40.08], [-111.95, 40.02]]], { g: 'b' });
        const dissolveDs = datasetFrom([polyA, polyB]);
        const disTools = await dissolveFeatures(dissolveDs, 'g');
        const disCompute = dissolveFeatureCollection(dissolveDs.geojson, { field: 'g' });
        expect(disCompute.geojson.features.length).toBe(disTools.geojson.features.length);
    });

    it('union, merge, sample, spatial join, intersect match gis-tools shape', async () => {
        const p1 = turf.polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], { a: 1 });
        const p2 = turf.polygon([[[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]], { a: 2 });
        const unionDs = datasetFrom([p1, p2]);
        const unionTools = await unionFeatures(unionDs);
        const unionCompute = unionFeatureCollection(unionDs.geojson);
        expect(unionCompute.geojson.features.length).toBe(unionTools.geojson.features.length);

        const mergeTools = mergeLayers(datasetFrom([p1], 'a'), datasetFrom([p2], 'b'));
        const mergeCompute = mergeFeatureCollections(datasetFrom([p1]).geojson, datasetFrom([p2]).geojson);
        expect(mergeCompute.geojson.features.length).toBe(mergeTools.geojson.features.length);

        const sampleTools = await sampleFeatures(datasetFrom([p1, p2, turf.point([2, 2])]), 2);
        const sampleCompute = sampleFeatureCollection(datasetFrom([p1, p2, turf.point([2, 2])]).geojson, { num: 2 });
        expect(sampleCompute.geojson.features.length).toBe(sampleTools.geojson.features.length);

        const pointIn = turf.point([0.2, 0.2], { pid: 1 });
        const joinTools = await spatialJoinPointsInPolygons(
            datasetFrom([pointIn], 'pts'),
            datasetFrom([p1], 'polys'),
            ['a']
        );
        const joinCompute = spatialJoinFeatureCollections(
            datasetFrom([pointIn]).geojson,
            datasetFrom([p1]).geojson,
            { joinFields: ['a'] }
        );
        expect(joinCompute.geojson.features[0].properties.a).toBe(joinTools.geojson.features[0].properties.a);

        const ixTools = await intersectLayers(datasetFrom([p1], 'A'), datasetFrom([p2], 'B'));
        const ixCompute = intersectFeatureCollections(datasetFrom([p1]).geojson, datasetFrom([p2]).geojson);
        expect(ixCompute.geojson.features.length).toBe(ixTools.geojson.features.length);
    });

    it('null attribute rows survive spatial join', async () => {
        const pt = turf.point([0.2, 0.2], { pid: null });
        const poly = turf.polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], { name: null });
        const joinTools = await spatialJoinPointsInPolygons(
            datasetFrom([pt], 'pts'),
            datasetFrom([poly], 'polys'),
            ['name']
        );
        const joinCompute = spatialJoinFeatureCollections(
            datasetFrom([pt]).geojson,
            datasetFrom([poly]).geojson,
            { joinFields: ['name'] }
        );
        expect(joinCompute.geojson.features[0].properties.name).toBe(joinTools.geojson.features[0].properties.name);
    });
});

describe('tools/compute clip semantics (shared compute)', () => {
    it('drops features when intersect fails (no centroid fallback)', () => {
        const clipLayer = datasetFrom([turf.bboxPolygon([-111.5, 40.5, -111.4, 40.6])], 'clip');
        const line = turf.lineString([[-111.55, 40.55], [-111.35, 40.55]]);
        const data = datasetFrom([line], 'data');

        const toolsOut = toolsComputeClip([data, clipLayer], {}, null);
        expect(toolsOut.geojson.features.length).toBe(0);
    });
});

describe('tools/compute immutability', () => {
    it('does not mutate deep-frozen FeatureCollection inputs', () => {
        const fc = deepFreeze({
            type: 'FeatureCollection',
            features: [
                turf.point([-111.9, 40.7], { id: 1 })
            ]
        });
        const before = structuredClone(fc);
        bufferFeatureCollection(fc, { distance: 1, units: 'meters' });
        clipFeatureCollection(fc, turf.bboxPolygon([-112, 40, -111, 41]).geometry);
        expect(fc).toEqual(before);
    });
});

describe('tools/compute import graph', () => {
    const forbidden = [
        /task-runner/,
        /tool-handlers/,
        /\bdocument\b/,
        /\bwindow\b/,
        /workflow-run-helpers/,
        /js\/workflow\/worker/
    ];

    it('js/tools/compute/** has no TaskRunner/DOM/UI/workflow helper imports', () => {
        const files = readdirSync(COMPUTE_DIR).filter(f => f.endsWith('.js'));
        for (const file of files) {
            const source = readFileSync(join(COMPUTE_DIR, file), 'utf8');
            for (const pattern of forbidden) {
                expect(source, `${file} matched ${pattern}`).not.toMatch(pattern);
            }
        }
    });
});
