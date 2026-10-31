import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowEngine } from '../js/workflow/workflow-engine.js';
import { WorkflowStore, WORKFLOW_CACHE_IDB_NAME } from '../js/workflow/workflow-store.js';
import { loadGraphIntoEngine } from '../js/workflow/workflow-graph-loader.js';
import {
    CURRENT_WORKFLOW_SCHEMA_VERSION,
    graphFromEngine,
    migrateWorkflowGraph,
    unwrapWorkflowInput
} from '../js/workflow/workflow-schema.js';
import {
    WORKFLOW_LIBRARY_IDB_NAME,
    WORKFLOW_VERSION_CAP,
    _dangerouslyClearLibraryForTests,
    clearAutosaveDraft,
    deleteSavedGraph,
    duplicateSavedGraph,
    listGraphVersions,
    listSavedGraphs,
    loadAutosaveDraft,
    loadVersionGraph,
    openSavedGraph,
    renameSavedGraph,
    saveAutosaveDraft,
    saveGraphVersion,
    saveNewGraph
} from '../js/workflow/workflow-library-db.js';
import { NodeBase, resetNodeIdCounter } from '../js/workflow/nodes/node-base.js';
import { UNKNOWN_PLACEHOLDER_NODE_TYPE, createUnknownPlaceholderNode } from '../js/workflow/nodes/unknown-placeholder-node.js';
import { FilterRowsNode } from '../js/workflow/nodes/transform-nodes.js';

const pipelinesDir = join(process.cwd(), 'pipelines');

function presetFiles() {
    return readdirSync(pipelinesDir)
        .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'manifest.json');
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

class PassthroughNode extends NodeBase {
    constructor(id) {
        super('pass', { name: 'Pass', category: 'transform', color: '#00f' });
        this.id = id;
        this.inputPorts = [{ id: 'in', label: 'In', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Out', dataType: 'dataset' }];
    }

    async execute(inputs) {
        return inputs[0];
    }
}

function tinyDataset() {
    return {
        type: 'spatial',
        name: 't',
        geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { a: 1 }, geometry: { type: 'Point', coordinates: [0, 0] } }] },
        schema: { fields: [{ name: 'a', type: 'integer' }], featureCount: 1 }
    };
}

describe('workflow schema migration', () => {
    it('adds schemaVersion to unversioned graph JSON', () => {
        const raw = {
            nodes: [{ id: 'node-1', type: 'preview', position: { x: 0, y: 0 }, config: {} }],
            wires: []
        };
        const migrated = migrateWorkflowGraph(raw);
        expect(migrated.schemaVersion).toBe(CURRENT_WORKFLOW_SCHEMA_VERSION);
        expect(migrated.nodes).toHaveLength(1);
    });

    it('unwraps export wrapper and inner pipeline', () => {
        const wrapped = {
            _format: 'gis-toolbox-workflow',
            version: 1,
            pipeline: { nodes: [{ id: 'n1', type: 'x' }], wires: [] }
        };
        const inner = unwrapWorkflowInput(wrapped);
        expect(inner.nodes).toHaveLength(1);
        const migrated = migrateWorkflowGraph(wrapped);
        expect(migrated.schemaVersion).toBe(CURRENT_WORKFLOW_SCHEMA_VERSION);
    });
});

describe('workflow preset migration', () => {
    it('migrates each preset pipeline without error', () => {
        const files = presetFiles();
        expect(files.length).toBe(10);
        for (const file of files) {
            const config = JSON.parse(readFileSync(join(pipelinesDir, file), 'utf8'));
            const migrated = migrateWorkflowGraph(config);
            expect(migrated.schemaVersion).toBe(CURRENT_WORKFLOW_SCHEMA_VERSION);
            expect(migrated.nodes.length).toBeGreaterThan(0);
        }
    });
});

function installSessionStorageMock() {
    const store = new Map();
    const mock = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
        clear: () => { store.clear(); }
    };
    globalThis.sessionStorage = mock;
    return store;
}

describe('workflow library IndexedDB', () => {
    beforeEach(async () => {
        installSessionStorageMock();
        await _dangerouslyClearLibraryForTests();
    });

    it('save, list, open, rename, delete', async () => {
        const engine = new WorkflowEngine();
        const filter = new FilterRowsNode();
        engine.addNode(filter);

        const id = await saveNewGraph('Test flow', graphFromEngine(engine));
        let list = await listSavedGraphs();
        expect(list.some((g) => g.id === id && g.name === 'Test flow' && g.nodeCount === 1)).toBe(true);

        const opened = await openSavedGraph(id);
        expect(opened?.nodes).toHaveLength(1);

        await renameSavedGraph(id, 'Renamed');
        list = await listSavedGraphs();
        expect(list.find((g) => g.id === id)?.name).toBe('Renamed');

        await deleteSavedGraph(id);
        list = await listSavedGraphs();
        expect(list.find((g) => g.id === id)).toBeUndefined();
    });

    it('adds version history, caps at WORKFLOW_VERSION_CAP, and restores', async () => {
        const engine = new WorkflowEngine();
        engine.addNode(new FilterRowsNode());
        const id = await saveNewGraph('Versioned', graphFromEngine(engine));

        for (let i = 0; i < WORKFLOW_VERSION_CAP + 2; i++) {
            engine.addNode(new FilterRowsNode());
            await saveGraphVersion(id, 'Versioned', graphFromEngine(engine), { label: `v${i}` });
        }

        const versions = await listGraphVersions(id);
        expect(versions.length).toBe(WORKFLOW_VERSION_CAP);

        const head = versions[0];
        const graph = await loadVersionGraph(head.id);
        expect(graph?.nodes?.length).toBeGreaterThan(1);
    });

    it('duplicates a saved graph', async () => {
        const engine = new WorkflowEngine();
        engine.addNode(new FilterRowsNode());
        const id = await saveNewGraph('Original', graphFromEngine(engine));
        const copyId = await duplicateSavedGraph(id, 'Copy');
        expect(copyId).not.toBe(id);
        const copy = await openSavedGraph(copyId);
        expect(copy?.nodes).toHaveLength(1);
    });
});

describe('workflow autosave and sessionStorage migration', () => {
    beforeEach(async () => {
        installSessionStorageMock();
        await _dangerouslyClearLibraryForTests();
        WorkflowStore._resetSessionMigrationForTests();
    });

    it('autosaves and restores via a fresh store load', async () => {
        const engine = new WorkflowEngine();
        const n = new FilterRowsNode();
        n.id = 'node-5';
        engine.addNode(n);
        await saveAutosaveDraft(graphFromEngine(engine));

        const draft = await loadAutosaveDraft();
        expect(draft?.nodes?.[0]?.id).toBe('node-5');

        const engine2 = new WorkflowEngine();
        const { loaded } = await WorkflowStore.load(engine2);
        expect(loaded).toBe(true);
        expect(engine2.nodes.has('node-5')).toBe(true);
    });

    it('migrates legacy sessionStorage graph on first load', async () => {
        const legacy = {
            nodes: [{ id: 'node-2', type: 'preview', position: { x: 10, y: 10 }, config: {} }],
            wires: []
        };
        sessionStorage.setItem('gis-toolbox-workflow', JSON.stringify(legacy));

        const engine = new WorkflowEngine();
        const result = await WorkflowStore.load(engine);
        expect(result.loaded).toBe(true);
        expect(engine.nodes.has('node-2')).toBe(true);
        expect(sessionStorage.getItem('gis-toolbox-workflow')).toBeNull();
        expect(sessionStorage.getItem('gis-toolbox-workflow-idb-migrated')).toBe('1');
    });

    it('clear removes autosave draft', async () => {
        const engine = new WorkflowEngine();
        engine.addNode(new FilterRowsNode());
        WorkflowStore.save(engine);
        await new Promise((r) => setTimeout(r, 20));
        WorkflowStore.clear();
        await new Promise((r) => setTimeout(r, 20));
        expect(await loadAutosaveDraft()).toBeNull();
    });
});

describe('workflow JSON export/import round trip', () => {
    beforeEach(() => {
        resetNodeIdCounter(0);
    });

    it('preserves schemaVersion through export wrapper', () => {
        const engine = new WorkflowEngine();
        const filter = new FilterRowsNode();
        engine.addNode(filter);
        engine.addWire({ from: filter.id, fromPort: 'out', to: filter.id, toPort: 'in' });

        const pipeline = graphFromEngine(engine);
        const file = {
            _format: 'gis-toolbox-workflow',
            version: 1,
            pipeline
        };

        const engine2 = new WorkflowEngine();
        const { loaded, unknownTypes } = loadGraphIntoEngine(engine2, file);
        expect(loaded).toBe(true);
        expect(unknownTypes).toHaveLength(0);
        expect(migrateWorkflowGraph(engine2.toJSON()).schemaVersion).toBe(CURRENT_WORKFLOW_SCHEMA_VERSION);
    });
});

describe('unknown node types', () => {
    beforeEach(() => {
        resetNodeIdCounter(0);
    });

    it('keeps unknown nodes as placeholders with wires attached', () => {
        const graph = {
            nodes: [
                { id: 'node-1', type: 'not-a-real-node-type', position: { x: 0, y: 0 }, config: { foo: 1 } },
                { id: 'node-2', type: 'preview', position: { x: 200, y: 0 }, config: {} }
            ],
            wires: [{ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' }]
        };

        const engine = new WorkflowEngine();
        const { loaded, unknownTypes } = loadGraphIntoEngine(engine, graph);
        expect(loaded).toBe(true);
        expect(unknownTypes).toEqual(['not-a-real-node-type']);
        expect(engine.nodes.size).toBe(2);
        const placeholder = engine.nodes.get('node-1');
        expect(placeholder.type).toBe(UNKNOWN_PLACEHOLDER_NODE_TYPE);
        expect(engine.wires).toHaveLength(1);

        const exported = placeholder.toJSON();
        expect(exported.type).toBe('not-a-real-node-type');
    });

    it('fails only the branch containing a placeholder when run', async () => {
        const engine = new WorkflowEngine();
        const root = new StaticInputNode('node-1', tinyDataset());
        const bad = createUnknownPlaceholderNode({
            id: 'node-2',
            type: 'missing-plugin-node',
            position: { x: 100, y: 0 },
            config: {}
        });
        const goodBranch = new PassthroughNode('node-3');
        const badDownstream = new PassthroughNode('node-4');
        const goodDownstream = new PassthroughNode('node-5');

        engine.addNode(root);
        engine.addNode(bad);
        engine.addNode(goodBranch);
        engine.addNode(badDownstream);
        engine.addNode(goodDownstream);

        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-3', toPort: 'in' });
        engine.addWire({ from: 'node-2', fromPort: 'out', to: 'node-4', toPort: 'in' });
        engine.addWire({ from: 'node-3', fromPort: 'out', to: 'node-5', toPort: 'in' });

        const result = await engine.run({});
        expect(result.status).toBe('partial');
        expect(engine.nodes.get('node-2')._runStatus).toBe('error');
        expect(engine.nodes.get('node-4')._runStatus).toBe('skipped');
        expect(engine.nodes.get('node-3')._runStatus).toBe('done');
        expect(engine.nodes.get('node-5')._runStatus).toBe('done');
    });
});

describe('workflow IDB names', () => {
    it('uses separate library and cache databases', () => {
        expect(WORKFLOW_LIBRARY_IDB_NAME).toBe('gis-toolbox-workflow-library');
        expect(WORKFLOW_CACHE_IDB_NAME).toBe('gis-toolbox-workflow-cache');
    });
});
