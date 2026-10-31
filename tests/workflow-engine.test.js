import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { WorkflowEngine } from '../js/workflow/workflow-engine.js';
import { NodeBase, resetNodeIdCounter } from '../js/workflow/nodes/node-base.js';
import { FilterRowsNode } from '../js/workflow/nodes/transform-nodes.js';
import { findNodeDef } from '../js/workflow/node-catalog.js';

const sampleGeojson = JSON.parse(
    readFileSync(new URL('./fixtures/sample-point.geojson', import.meta.url), 'utf8')
);

function makeSpatialDataset(featureCount = 3, idPrefix = 'f') {
    const features = Array.from({ length: featureCount }, (_, i) => ({
        type: 'Feature',
        properties: { id: i, group: i % 2 === 0 ? 'a' : 'b', val: i },
        geometry: sampleGeojson.features[0].geometry
    }));
    return {
        type: 'spatial',
        name: 'test',
        geojson: { type: 'FeatureCollection', features },
        schema: { featureCount, fields: [{ name: 'id', type: 'integer' }] }
    };
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

class FailingNode extends NodeBase {
    constructor(id, message = 'boom') {
        super('fail', { name: 'Fail', category: 'transform', color: '#f00' });
        this.id = id;
        this.message = message;
        this.inputPorts = [{ id: 'in', label: 'In', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Out', dataType: 'dataset' }];
    }

    async execute(inputs) {
        if (!inputs[0]) throw new Error('No input');
        throw new Error(this.message);
    }
}

class PassthroughNode extends NodeBase {
    constructor(id, name = 'Pass') {
        super('pass', { name, category: 'transform', color: '#00f' });
        this.id = id;
        this.inputPorts = [{ id: 'in', label: 'In', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Out', dataType: 'dataset' }];
    }

    async execute(inputs) {
        return inputs[0];
    }
}

class SlowCountNode extends NodeBase {
    constructor(id, steps = 8000, stepMs = 0) {
        super('slow', { name: 'Slow', category: 'transform', color: '#888' });
        this.id = id;
        this.steps = steps;
        this.stepMs = stepMs;
        this.inputPorts = [{ id: 'in', label: 'In', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Out', dataType: 'dataset' }];
    }

    async execute(inputs, context) {
        const data = inputs[0];
        for (let i = 0; i < this.steps; i++) {
            if (i % 64 === 0) {
                context?.reportProgress?.({
                    progress: i / this.steps,
                    processed: i,
                    total: this.steps
                });
                await new Promise((resolve) => setTimeout(resolve, 0));
                if (context?.signal?.aborted) {
                    throw new DOMException('cancelled', 'AbortError');
                }
            }
        }
        return data;
    }
}

describe('WorkflowEngine.run', () => {
    beforeEach(() => {
        resetNodeIdCounter(0);
    });

    it('runs a linear pipeline successfully', async () => {
        const engine = new WorkflowEngine();
        const input = new StaticInputNode('node-1', makeSpatialDataset(2));
        const filter = new FilterRowsNode();
        filter.id = 'node-2';
        filter.config.rules = [{ field: 'group', operator: 'equals', value: 'a' }];

        engine.addNode(input);
        engine.addNode(filter);
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });

        const result = await engine.run({});
        expect(result.status).toBe('success');
        expect(filter._runStatus).toBe('done');
        expect(filter._outputData.geojson.features).toHaveLength(1);
    });

    it('isolates branch errors and skips only downstream of failure', async () => {
        const engine = new WorkflowEngine();
        const root = new StaticInputNode('node-1', makeSpatialDataset(1));
        const fail = new FailingNode('node-2');
        const goodBranch = new PassthroughNode('node-3', 'Good');
        const badDownstream = new PassthroughNode('node-4', 'BadDown');
        const goodDownstream = new PassthroughNode('node-5', 'GoodDown');

        engine.addNode(root);
        engine.addNode(fail);
        engine.addNode(goodBranch);
        engine.addNode(badDownstream);
        engine.addNode(goodDownstream);

        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-3', toPort: 'in' });
        engine.addWire({ from: 'node-2', fromPort: 'out', to: 'node-4', toPort: 'in' });
        engine.addWire({ from: 'node-3', fromPort: 'out', to: 'node-5', toPort: 'in' });

        const result = await engine.run({});
        expect(result.status).toBe('partial');
        expect(fail._runStatus).toBe('error');
        expect(badDownstream._runStatus).toBe('skipped');
        expect(goodBranch._runStatus).toBe('done');
        expect(goodDownstream._runStatus).toBe('done');
    });

    it('cancels between nodes via AbortSignal', async () => {
        const engine = new WorkflowEngine();
        const a = new StaticInputNode('node-1', makeSpatialDataset(1));
        const b = new PassthroughNode('node-2', 'B');
        const c = new PassthroughNode('node-3', 'C');

        engine.addNode(a);
        engine.addNode(b);
        engine.addNode(c);
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });
        engine.addWire({ from: 'node-2', fromPort: 'out', to: 'node-3', toPort: 'in' });

        const ac = new AbortController();
        engine.subscribeRunEvents((evt) => {
            if (evt.type === 'node' && evt.nodeId === 'node-1' && evt.status === 'done') {
                ac.abort();
            }
        });

        const result = await engine.run({}, { signal: ac.signal });
        expect(result.status).toBe('cancelled');
        expect(a._runStatus).toBe('done');
        expect(b._runStatus).toBe('cancelled');
        expect(c._runStatus).toBe('cancelled');
    });

    it('cancels mid-loop in a slow node', async () => {
        const engine = new WorkflowEngine();
        const a = new StaticInputNode('node-1', makeSpatialDataset(1));
        const slow = new SlowCountNode('node-2', 8000, 0);
        engine.addNode(a);
        engine.addNode(slow);
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });

        const ac = new AbortController();
        const runPromise = engine.run({}, { signal: ac.signal });
        setTimeout(() => ac.abort(), 10);

        const result = await runPromise;
        expect(result.status).toBe('cancelled');
        expect(slow._runStatus).toBe('cancelled');
    });

    it('emits ordered status events', async () => {
        const engine = new WorkflowEngine();
        const a = new StaticInputNode('node-1', makeSpatialDataset(1));
        const b = new PassthroughNode('node-2');
        engine.addNode(a);
        engine.addNode(b);
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });

        const events = [];
        engine.subscribeRunEvents((evt) => events.push(evt));

        await engine.run({});

        const nodeStatuses = events.filter((e) => e.type === 'node').map((e) => `${e.nodeId}:${e.status}`);
        expect(nodeStatuses).toContain('node-1:running');
        expect(nodeStatuses).toContain('node-1:done');
        expect(nodeStatuses).toContain('node-2:running');
        expect(nodeStatuses).toContain('node-2:done');
        expect(events.some((e) => e.type === 'run' && e.status === 'start')).toBe(true);
        expect(events.some((e) => e.type === 'run' && e.status === 'done')).toBe(true);
    });

    it('preserves upstream feature payloads when filter-rows produces a subset', async () => {
        const engine = new WorkflowEngine();
        const dataset = makeSpatialDataset(3);
        const input = new StaticInputNode('node-1', dataset);
        const filter = new FilterRowsNode();
        filter.id = 'node-2';
        filter.config.rules = [{ field: 'group', operator: 'equals', value: 'a' }];

        engine.addNode(input);
        engine.addNode(filter);
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });

        await engine.run({});
        expect(dataset.geojson.features).toHaveLength(3);
        expect(input._outputData.geojson).not.toBe(filter._outputData.geojson);
    });

    it('can run again immediately after cancel', async () => {
        const engine = new WorkflowEngine();
        const a = new StaticInputNode('node-1', makeSpatialDataset(1));
        engine.addNode(a);

        const ac = new AbortController();
        ac.abort();
        const cancelled = await engine.run({}, { signal: ac.signal });
        expect(cancelled.status).toBe('cancelled');
        expect(engine.isRunning).toBe(false);

        const second = await engine.run({});
        expect(second.status).toBe('success');
        expect(a._runStatus).toBe('done');
    });

    it('supports engine.cancel() during run', async () => {
        const engine = new WorkflowEngine();
        const a = new StaticInputNode('node-1', makeSpatialDataset(1));
        const slow = new SlowCountNode('node-2', 8000, 0);
        engine.addNode(a);
        engine.addNode(slow);
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });

        const runPromise = engine.run({});
        setTimeout(() => engine.cancel(), 10);
        const result = await runPromise;
        expect(result.status).toBe('cancelled');
    });
});

describe('WorkflowEngine preset golden outputs (local sampleData)', () => {
    beforeEach(() => {
        resetNodeIdCounter(0);
        vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' });
    });

    async function runPreset(fileName) {
        const raw = readFileSync(new URL(`../pipelines/${fileName}`, import.meta.url), 'utf8');
        const config = JSON.parse(raw);
        const engine = new WorkflowEngine();

        let maxId = 0;
        for (const nd of config.pipeline.nodes) {
            const num = parseInt(String(nd.id).replace('node-', ''), 10);
            if (!isNaN(num) && num > maxId) maxId = num;
        }
        resetNodeIdCounter(maxId);

        for (const nd of config.pipeline.nodes) {
            const def = findNodeDef(nd.type);
            if (!def) throw new Error(`Unknown node ${nd.type}`);
            const node = def.create();
            node.id = nd.id;
            node.position = nd.position || { x: 0, y: 0 };
            node.config = { ...node.config, ...nd.config };
            if (nd.type === 'file-import' && config.sampleData?.[nd.id]) {
                node._cachedResult = config.sampleData[nd.id];
            }
            engine.addNode(node);
        }
        for (const w of config.pipeline.wires || []) {
            engine.addWire(w);
        }

        const context = {
            getLayers: () => [],
            importFile: vi.fn(),
            showPreview: vi.fn(),
            addToMap: vi.fn(),
            updateMapLayer: vi.fn(),
            removeFromMap: vi.fn()
        };

        const result = await engine.run(context);
        return { engine, result, config };
    }

    it('Filter and Preview preset matches filtered feature count', async () => {
        const { engine, result } = await runPreset('Filter and Preview.json');
        expect(result.status).toBe('success');
        const filterNode = engine.nodes.get('node-2');
        expect(filterNode?._runStatus).toBe('done');
        expect(filterNode?._outputData?.geojson?.features?.length).toBe(5);
        const previewNode = engine.nodes.get('node-3');
        expect(previewNode?._runStatus).toBe('done');
    });

    it('Sort Deduplicate and Preview preset completes', async () => {
        const { result } = await runPreset('Sort Deduplicate and Preview.json');
        expect(result.status).toBe('success');
    });
});
