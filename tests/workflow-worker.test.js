import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleWorkflowWorkerMessage } from '../js/workflow/worker/workflow-worker.js';
import { WORKFLOW_WORKER_MSG } from '../js/workflow/worker/workflow-worker-protocol.js';
import {
    WorkflowWorkerClient,
    __setWorkflowWorkerConstructorForTests,
    __setWorkflowWorkerTerminateGraceMsForTests,
    workflowWorkerClient
} from '../js/workflow/workflow-worker-client.js';
import { runNodeCompute } from '../js/workflow/worker/node-compute-registry.js';
import { WorkflowEngine } from '../js/workflow/workflow-engine.js';
import { NodeBase, resetNodeIdCounter } from '../js/workflow/nodes/node-base.js';
import { FilterRowsNode, DeduplicateNode } from '../js/workflow/nodes/transform-nodes.js';
import { SimplifyNode } from '../js/workflow/nodes/spatial-nodes.js';

const sampleGeojson = JSON.parse(
    readFileSync(new URL('./fixtures/sample-point.geojson', import.meta.url), 'utf8')
);

function makeSpatialDataset(featureCount = 5, idPrefix = 'f') {
    const features = Array.from({ length: featureCount }, (_, i) => ({
        type: 'Feature',
        properties: { id: i, group: i % 2 === 0 ? 'a' : 'b', key: `k${i % 3}` },
        geometry: sampleGeojson.features[0].geometry
    }));
    return {
        type: 'spatial',
        name: 'test',
        geojson: { type: 'FeatureCollection', features },
        schema: { featureCount, fields: [{ name: 'id', type: 'integer' }, { name: 'group', type: 'string' }] }
    };
}

class InProcessWorker {
    constructor() {
        this.onmessage = null;
        this.onerror = null;
        queueMicrotask(() => {
            this.onmessage?.({ data: { type: WORKFLOW_WORKER_MSG.READY } });
        });
    }

    postMessage(data) {
        handleWorkflowWorkerMessage(data, (msg) => {
            queueMicrotask(() => this.onmessage?.({ data: msg }));
        });
    }

    terminate() {}
}

class StaticInputNode extends NodeBase {
    constructor(id, dataset) {
        super('static-input', { name: 'Static', category: 'input', color: '#000' });
        this.id = id;
        this._dataset = dataset;
        this.outputPorts = [{ id: 'out', label: 'Out', dataType: 'dataset' }];
    }

    async execute() {
        return this._dataset;
    }
}

describe('workflow worker protocol', () => {
    beforeEach(() => {
        workflowWorkerClient.resetForTests();
        __setWorkflowWorkerConstructorForTests(InProcessWorker);
        __setWorkflowWorkerTerminateGraceMsForTests(400);
    });

    afterEach(() => {
        __setWorkflowWorkerConstructorForTests(typeof Worker !== 'undefined' ? Worker : null);
        __setWorkflowWorkerTerminateGraceMsForTests(400);
    });

    it('handles run → progress → done', async () => {
        const client = new WorkflowWorkerClient();
        const dataset = makeSpatialDataset(200);
        const progress = [];
        const result = await client.runNode({
            nodeType: 'filter-rows',
            config: { rules: [{ field: 'group', operator: 'equals', value: 'a' }], logic: 'AND' },
            inputs: [dataset],
            reportProgress: (u) => progress.push(u)
        });
        expect(result.geojson.features.length).toBeGreaterThan(0);
        expect(progress.length).toBeGreaterThan(0);
    });

    it('maps worker errors to thrown Error', async () => {
        const client = new WorkflowWorkerClient();
        await expect(
            client.runNode({
                nodeType: 'filter-rows',
                config: { rules: [], logic: 'AND' },
                inputs: [null]
            })
        ).rejects.toThrow('No input data');
    });

    it('soft-aborts an in-flight worker run', async () => {
        const client = new WorkflowWorkerClient();
        const ac = new AbortController();
        ac.abort();
        await expect(
            client.runNode({
                nodeType: 'deduplicate',
                config: { keyFields: ['key'], keep: 'first' },
                inputs: [makeSpatialDataset(5000)],
                signal: ac.signal
            })
        ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('soft-aborts during worker compute loop', async () => {
        const client = new WorkflowWorkerClient();
        const ac = new AbortController();
        const runPromise = client.runNode({
            nodeType: 'deduplicate',
            config: { keyFields: ['key'], keep: 'first' },
            inputs: [makeSpatialDataset(120_000)],
            signal: ac.signal
        });
        ac.abort();
        await expect(runPromise).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('terminate fallback after cancel grace when worker ignores cancel', async () => {
        class StubbornWorker {
            constructor() {
                this.onmessage = null;
                queueMicrotask(() => {
                    this.onmessage?.({ data: { type: WORKFLOW_WORKER_MSG.READY } });
                });
            }

            postMessage(data) {
                if (data?.type === WORKFLOW_WORKER_MSG.RUN) {
                    this._runMessage = data;
                }
            }

            terminate() {
                this._terminated = true;
            }
        }

        __setWorkflowWorkerConstructorForTests(StubbornWorker);
        __setWorkflowWorkerTerminateGraceMsForTests(20);
        const client = new WorkflowWorkerClient();
        const ac = new AbortController();
        const runPromise = client.runNode({
            nodeType: 'filter-rows',
            config: { rules: [{ field: 'group', operator: 'equals', value: 'a' }], logic: 'AND' },
            inputs: [makeSpatialDataset(10)],
            signal: ac.signal
        });
        ac.abort();
        await expect(runPromise).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('worker vs main-thread parity (fixtures)', () => {
    const cases = [
        {
            type: 'filter-rows',
            config: { rules: [{ field: 'group', operator: 'equals', value: 'a' }], logic: 'AND' }
        },
        {
            type: 'deduplicate',
            config: { keyFields: ['key'], keep: 'first' }
        },
        {
            type: 'simplify',
            config: { tolerance: 0.01 }
        }
    ];

    it.each(cases)('$type produces identical output on main thread and in-process worker', async ({ type, config }) => {
        const dataset = makeSpatialDataset(8);
        const main = runNodeCompute(type, [dataset], config, {});
        let workerResult;
        await new Promise((resolve, reject) => {
            handleWorkflowWorkerMessage(
                {
                    type: WORKFLOW_WORKER_MSG.RUN,
                    requestId: 'parity-1',
                    nodeType: type,
                    config,
                    inputs: [dataset]
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
        expect(workerResult).toEqual(main);
    });
});

describe('WorkflowEngine with worker-backed nodes', () => {
    beforeEach(() => {
        resetNodeIdCounter(0);
        workflowWorkerClient.resetForTests();
        __setWorkflowWorkerConstructorForTests(InProcessWorker);
        __setWorkflowWorkerTerminateGraceMsForTests(400);
    });

    afterEach(() => {
        __setWorkflowWorkerConstructorForTests(typeof Worker !== 'undefined' ? Worker : null);
    });

    it('forwards progress from worker nodes', async () => {
        const engine = new WorkflowEngine();
        const input = new StaticInputNode('node-1', makeSpatialDataset(300));
        const filter = new FilterRowsNode();
        filter.id = 'node-2';
        filter.config.rules = [{ field: 'group', operator: 'equals', value: 'a' }];

        engine.addNode(input);
        engine.addNode(filter);
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });

        const progressEvents = [];
        engine.subscribeRunEvents((evt) => {
            if (evt.type === 'node' && evt.status === 'progress') progressEvents.push(evt);
        });

        await engine.run({});
        expect(progressEvents.some((e) => e.nodeId === 'node-2')).toBe(true);
    });

    it('isolates branch errors for worker node failures', async () => {
        const engine = new WorkflowEngine();
        const root = new StaticInputNode('node-1', makeSpatialDataset(2));
        const bad = new FilterRowsNode();
        bad.id = 'node-2';
        bad.config.rules = [{ field: 'group', operator: 'equals', value: 'a' }];

        class BrokenWorker extends InProcessWorker {
            postMessage(data) {
                if (data?.type === WORKFLOW_WORKER_MSG.RUN && data.nodeType === 'filter-rows') {
                    queueMicrotask(() => {
                        this.onmessage?.({
                            data: {
                                type: WORKFLOW_WORKER_MSG.ERROR,
                                requestId: data.requestId,
                                error: 'worker boom'
                            }
                        });
                    });
                    return;
                }
                super.postMessage(data);
            }
        }

        __setWorkflowWorkerConstructorForTests(BrokenWorker);
        workflowWorkerClient.resetForTests();
        __setWorkflowWorkerConstructorForTests(BrokenWorker);

        const good = new DeduplicateNode();
        good.id = 'node-3';
        good.config = { keyFields: ['key'], keep: 'first' };
        const badDown = new SimplifyNode();
        badDown.id = 'node-4';
        badDown.config = { tolerance: 0.01 };
        const goodDown = new SimplifyNode();
        goodDown.id = 'node-5';
        goodDown.config = { tolerance: 0.01 };

        engine.addNode(root);
        engine.addNode(bad);
        engine.addNode(good);
        engine.addNode(badDown);
        engine.addNode(goodDown);
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-3', toPort: 'in' });
        engine.addWire({ from: 'node-2', fromPort: 'out', to: 'node-4', toPort: 'in' });
        engine.addWire({ from: 'node-3', fromPort: 'out', to: 'node-5', toPort: 'in' });

        const result = await engine.run({});
        expect(result.status).toBe('partial');
        expect(bad._runStatus).toBe('error');
        expect(badDown._runStatus).toBe('skipped');
        expect(good._runStatus).toBe('done');
        expect(goodDown._runStatus).toBe('done');
    });

    it('falls back to main-thread compute when Worker is unavailable', async () => {
        __setWorkflowWorkerConstructorForTests(null);
        const engine = new WorkflowEngine();
        const input = new StaticInputNode('node-1', makeSpatialDataset(4));
        const dedupe = new DeduplicateNode();
        dedupe.id = 'node-2';
        dedupe.config = { keyFields: ['key'], keep: 'first' };
        engine.addNode(input);
        engine.addNode(dedupe);
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });

        const direct = runNodeCompute('deduplicate', [input._dataset], dedupe.config, {});
        await engine.run({});
        expect(dedupe._outputData).toEqual(direct);
    });
});

describe('shared workflowWorkerClient singleton', () => {
    beforeEach(() => {
        workflowWorkerClient.resetForTests();
        __setWorkflowWorkerConstructorForTests(InProcessWorker);
    });

    afterEach(() => {
        __setWorkflowWorkerConstructorForTests(typeof Worker !== 'undefined' ? Worker : null);
    });

    it('exposes runNode after worker injection', async () => {
        const out = await workflowWorkerClient.runNode({
            nodeType: 'filter-rows',
            config: { rules: [{ field: 'group', operator: 'equals', value: 'b' }], logic: 'AND' },
            inputs: [makeSpatialDataset(4)]
        });
        expect(out.geojson.features.length).toBeGreaterThan(0);
    });
});
