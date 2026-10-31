import { describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { createSpatialDataset } from '../js/core/data-model.js';
import {
    computeWorkflowSimplify,
    referenceLatitudeFromGeojson
} from '../js/workflow/compute/simplify-units.js';
import {
    CURRENT_WORKFLOW_SCHEMA_VERSION,
    migrateWorkflowGraph
} from '../js/workflow/workflow-schema.js';
import { runNodeCompute } from '../js/workflow/worker/node-compute-registry.js';
import { handleWorkflowWorkerMessage } from '../js/workflow/worker/workflow-worker.js';
import { WORKFLOW_WORKER_MSG } from '../js/workflow/worker/workflow-worker-protocol.js';

function zigzagLine(lat, lon0 = -112, segments = 40, amplitudeDeg = 0.002) {
    const coords = [];
    for (let i = 0; i <= segments; i++) {
        const lon = lon0 + i * 0.001;
        const latOff = i % 2 === 0 ? amplitudeDeg : -amplitudeDeg;
        coords.push([lon, lat + latOff]);
    }
    return turf.lineString(coords);
}

function maxDeviationMetres(originalLine, simplifiedLine) {
    let max = 0;
    const simplified = simplifiedLine.geometry.type === 'LineString'
        ? simplifiedLine
        : turf.lineString(simplifiedLine.geometry.coordinates[0]);
    walkVertices(originalLine, (pt) => {
        const nearest = turf.nearestPointOnLine(simplified, pt);
        const d = turf.distance(pt, nearest, { units: 'meters' });
        if (d > max) max = d;
    });
    return max;
}

function walkVertices(feature, fn) {
    const geom = feature.geometry;
    const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
    for (const line of lines) {
        for (const c of line) fn(turf.point(c));
    }
}

function datasetFromFeature(f, name = 'layer') {
    return createSpatialDataset(name, { type: 'FeatureCollection', features: [f] }, {
        format: 'derived',
        schema: { featureCount: 1, fields: [] }
    });
}

describe('workflow Simplify tolerance units', () => {
    it('schema v2 migration sets toleranceUnit deg on legacy Simplify nodes', () => {
        const raw = {
            schemaVersion: 1,
            nodes: [
                {
                    id: 'node-1',
                    type: 'simplify',
                    position: { x: 0, y: 0 },
                    config: { tolerance: 0.01 }
                }
            ],
            wires: []
        };
        const migrated = migrateWorkflowGraph(raw);
        expect(migrated.schemaVersion).toBe(CURRENT_WORKFLOW_SCHEMA_VERSION);
        expect(migrated.nodes[0].config.toleranceUnit).toBe('deg');
    });

    it('migration leaves deg-mode simplify output unchanged', () => {
        const line = zigzagLine(40.5);
        const ds = datasetFromFeature(line);
        const legacy = computeWorkflowSimplify([structuredClone(ds)], { tolerance: 0.01 }, null);
        const explicit = computeWorkflowSimplify(
            [structuredClone(ds)],
            { tolerance: 0.01, toleranceUnit: 'deg' },
            null
        );
        expect(explicit.geojson).toEqual(legacy.geojson);
    });

    it('does not mutate the input dataset geojson', () => {
        const line = zigzagLine(40.5);
        const ds = datasetFromFeature(line);
        const before = JSON.stringify(ds.geojson);
        computeWorkflowSimplify([ds], { tolerance: 25, toleranceUnit: 'm' }, null);
        expect(JSON.stringify(ds.geojson)).toBe(before);
    });

    it('metre tolerance yields similar ground deviation at ~40°N and ~60°N', () => {
        const toleranceM = 40;
        const line40 = zigzagLine(40, -112, 50, 0.0015);
        const line60 = zigzagLine(60, -112, 50, 0.0015);
        const out40 = computeWorkflowSimplify(
            [datasetFromFeature(line40)],
            { tolerance: toleranceM, toleranceUnit: 'm' },
            null
        );
        const out60 = computeWorkflowSimplify(
            [datasetFromFeature(line60)],
            { tolerance: toleranceM, toleranceUnit: 'm' },
            null
        );
        const dev40 = maxDeviationMetres(line40, out40.geojson.features[0]);
        const dev60 = maxDeviationMetres(line60, out60.geojson.features[0]);
        expect(dev40).toBeLessThanOrEqual(toleranceM + 2);
        expect(dev60).toBeLessThanOrEqual(toleranceM + 2);
        expect(Math.abs(dev40 - dev60)).toBeLessThan(15);
    });

    it('feet tolerance matches metres × 0.3048', () => {
        const line = zigzagLine(45);
        const metres = 30;
        const feet = metres / 0.3048;
        const fromM = computeWorkflowSimplify(
            [datasetFromFeature(line)],
            { tolerance: metres, toleranceUnit: 'm' },
            null
        );
        const fromFt = computeWorkflowSimplify(
            [datasetFromFeature(line)],
            { tolerance: feet, toleranceUnit: 'ft' },
            null
        );
        expect(fromFt.geojson).toEqual(fromM.geojson);
    });

    it('worker registry and main-thread fallback match for metre simplify', async () => {
        const ds = datasetFromFeature(zigzagLine(39.5));
        const config = { tolerance: 20, toleranceUnit: 'm' };
        const main = runNodeCompute('simplify', [ds], config, {});
        let workerResult;
        await new Promise((resolve, reject) => {
            handleWorkflowWorkerMessage(
                {
                    type: WORKFLOW_WORKER_MSG.RUN,
                    requestId: 'simp-units',
                    nodeType: 'simplify',
                    config,
                    inputs: [ds]
                },
                (msg) => {
                    if (msg.type === WORKFLOW_WORKER_MSG.DONE) {
                        workerResult = msg.result;
                        resolve();
                    }
                    if (msg.type === WORKFLOW_WORKER_MSG.ERROR) reject(new Error(msg.error));
                }
            );
        });
        expect(workerResult.geojson).toEqual(main.geojson);
    });

    it('reference latitude uses bbox centre', () => {
        const fc = {
            type: 'FeatureCollection',
            features: [
                turf.point([0, 10]),
                turf.point([0, 30])
            ]
        };
        expect(referenceLatitudeFromGeojson(fc)).toBe(20);
    });
});
