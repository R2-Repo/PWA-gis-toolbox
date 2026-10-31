import { describe, expect, it } from 'vitest';
import {
    NODE_COMPUTE_BY_TYPE,
    WORKER_CAPABLE_NODE_TYPES,
    runNodeCompute
} from '../js/workflow/worker/node-compute-registry.js';
import { WORKER_CAPABLE_NODE_TYPES as PROTOCOL_TYPES } from '../js/workflow/worker/workflow-worker-protocol.js';
import { FilterRowsNode } from '../js/workflow/nodes/transform-nodes.js';
import { BufferNode, ClipNode } from '../js/workflow/nodes/spatial-nodes.js';
import { CoordConvertNode } from '../js/workflow/nodes/transform-nodes.js';
import { PreviewNode } from '../js/workflow/nodes/output-nodes.js';
import { LayerInputNode } from '../js/workflow/nodes/input-nodes.js';
import { AddElevationNode } from '../js/workflow/nodes/enrichment-nodes.js';
import { readFileSync } from 'node:fs';
import { WORKFLOW_WORKER_MSG } from '../js/workflow/worker/workflow-worker-protocol.js';
import { handleWorkflowWorkerMessage } from '../js/workflow/worker/workflow-worker.js';

const sampleGeojson = JSON.parse(
    readFileSync(new URL('./fixtures/sample-point.geojson', import.meta.url), 'utf8')
);

const EXPECTED_WORKER_TYPES = [
    'filter-rows', 'deduplicate', 'rename-fields', 'delete-fields', 'sort', 'find-replace',
    'add-unique-id', 'combine-fields', 'split-column', 'template-builder', 'type-convert',
    'join-lookup', 'calculate-field', 'conditional-value', 'unit-convert', 'add-field',
    'buffer', 'line-offset', 'simplify', 'dissolve', 'clip', 'union', 'combine',
    'spatial-join', 'nearest-join', 'intersect', 'merge-layers', 'difference',
    'summarize-within', 'split-by-geometry', 'sample', 'explode', 'polygon-to-line',
    'fill-holes', 'split-by-line', 'split-by-polygon', 'reproject'
];

const MAIN_THREAD_ONLY = [
    'coord-convert',
    'layer-input',
    'file-import',
    'preview',
    'add-to-map',
    'export',
    'add-elevation',
    'unknown-node-type'
];

describe('workflow worker registry (Job 6b)', () => {
    it('registers all worker-safe node types', () => {
        expect(WORKER_CAPABLE_NODE_TYPES.size).toBe(EXPECTED_WORKER_TYPES.length);
        for (const type of EXPECTED_WORKER_TYPES) {
            expect(NODE_COMPUTE_BY_TYPE.has(type)).toBe(true);
            expect(WORKER_CAPABLE_NODE_TYPES.has(type)).toBe(true);
        }
        expect(PROTOCOL_TYPES).toEqual(WORKER_CAPABLE_NODE_TYPES);
    });

    it('keeps main-thread-only nodes out of the registry', () => {
        for (const type of MAIN_THREAD_ONLY) {
            expect(WORKER_CAPABLE_NODE_TYPES.has(type)).toBe(false);
        }
    });

    it('marks worker-capable node classes with runsInWorker', () => {
        expect(FilterRowsNode.runsInWorker).toBe(true);
        expect(BufferNode.runsInWorker).toBe(true);
        expect(CoordConvertNode.runsInWorker).toBeUndefined();
        expect(PreviewNode.runsInWorker).toBeUndefined();
        expect(LayerInputNode.runsInWorker).toBeUndefined();
        expect(AddElevationNode.runsInWorker).toBeUndefined();
    });
});

describe('worker parity samples (6b)', () => {
    function makeDataset(n = 4) {
        const features = Array.from({ length: n }, (_, i) => ({
            type: 'Feature',
            properties: { id: i, val: i * 10, name: `n${i}` },
            geometry: sampleGeojson.features[0].geometry
        }));
        return {
            type: 'spatial',
            name: 'test',
            geojson: { type: 'FeatureCollection', features },
            schema: {
                featureCount: n,
                fields: [
                    { name: 'id', type: 'integer' },
                    { name: 'val', type: 'number' },
                    { name: 'name', type: 'string' }
                ]
            }
        };
    }

    async function workerResult(type, config, inputs) {
        let out;
        await new Promise((resolve, reject) => {
            handleWorkflowWorkerMessage(
                { type: WORKFLOW_WORKER_MSG.RUN, requestId: 'p1', nodeType: type, config, inputs },
                (msg) => {
                    if (msg.type === WORKFLOW_WORKER_MSG.DONE) {
                        out = msg.result;
                        resolve();
                    }
                    if (msg.type === WORKFLOW_WORKER_MSG.ERROR) reject(new Error(msg.error));
                }
            );
        });
        return out;
    }

    it('sort matches main-thread compute', async () => {
        const dataset = makeDataset(5);
        const config = { field: 'val', direction: 'desc' };
        const main = runNodeCompute('sort', [dataset], config, {});
        const worker = await workerResult('sort', config, [dataset]);
        expect(worker).toEqual(main);
    });

    it('rename-fields matches main-thread compute', async () => {
        const dataset = makeDataset(2);
        const config = { mappings: [{ from: 'name', to: 'label' }] };
        const main = runNodeCompute('rename-fields', [dataset], config, {});
        const worker = await workerResult('rename-fields', config, [dataset]);
        expect(worker).toEqual(main);
    });

    it('calculate-field matches main-thread compute', async () => {
        const dataset = makeDataset(3);
        const config = { expression: '[val] * 2 + 1', outputField: 'doubled' };
        const main = runNodeCompute('calculate-field', [dataset], config, {});
        const worker = await workerResult('calculate-field', config, [dataset]);
        expect(worker).toEqual(main);
    });
});
