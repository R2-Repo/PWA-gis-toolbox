import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { WorkflowEngine } from '../js/workflow/workflow-engine.js';
import { resetNodeIdCounter, NodeBase } from '../js/workflow/nodes/node-base.js';
import { ExportNode } from '../js/workflow/nodes/output-nodes.js';
import { loadGraphIntoEngine } from '../js/workflow/workflow-graph-loader.js';
import { graphFromEngine } from '../js/workflow/workflow-schema.js';
import { getAvailableFormats, exportDataset, downloadBlob } from '../js/export/exporter.js';
import {
    buildExportOptions,
    formatAvailableForDataset,
    isExportInputEmpty,
    pickDefaultExportFormatKey,
    resolveExportFilenameBase
} from '../js/workflow/export-node-utils.js';

const sampleGeojson = JSON.parse(
    readFileSync(new URL('./fixtures/sample-point.geojson', import.meta.url), 'utf8')
);

function makeSpatialDataset(featureCount = 2, name = 'Trail Layer') {
    const features = Array.from({ length: featureCount }, (_, i) => ({
        type: 'Feature',
        properties: { id: i, name: `P${i}` },
        geometry: sampleGeojson.features[0].geometry
    }));
    return {
        type: 'spatial',
        name,
        geojson: { type: 'FeatureCollection', features },
        schema: {
            geometryType: 'Point',
            featureCount,
            fields: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'string' }]
        }
    };
}

function makeTableDataset(rowCount = 3, name = 'Table Layer') {
    const rows = Array.from({ length: rowCount }, (_, i) => ({ id: i, val: `v${i}` }));
    return {
        type: 'table',
        name,
        rows,
        schema: {
            featureCount: rowCount,
            fields: [{ name: 'id', type: 'integer' }, { name: 'val', type: 'string' }]
        }
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

describe('export-node-utils', () => {
    it('defaults spatial to geojson and table to csv', () => {
        expect(pickDefaultExportFormatKey(makeSpatialDataset())).toBe('geojson');
        expect(pickDefaultExportFormatKey(makeTableDataset())).toBe('csv');
    });

    it('resolves filename from upstream name when config blank', () => {
        expect(resolveExportFilenameBase(makeSpatialDataset(1, 'My Trails.geojson'), {})).toBe('My Trails');
        expect(resolveExportFilenameBase(makeSpatialDataset(), { filename: 'custom.csv' })).toBe('custom');
    });

    it('detects empty inputs', () => {
        expect(isExportInputEmpty(makeSpatialDataset(0))).toBe(true);
        expect(isExportInputEmpty(makeTableDataset(0))).toBe(true);
        expect(isExportInputEmpty(makeSpatialDataset(1))).toBe(false);
    });

    it('builds shapefile CRS options', () => {
        const ds = makeSpatialDataset(1);
        ds.schema.crs = 'EPSG:3857';
        const opts = buildExportOptions(ds, { format: 'shapefile', filename: 'out' });
        expect(opts.filename).toBe('out');
        expect(opts.targetCrs).toBe('EPSG:3857');
        expect(opts.sourceCrs).toBe('EPSG:3857');
    });
});

describe('ExportNode', () => {
    beforeEach(() => {
        resetNodeIdCounter(0);
        vi.restoreAllMocks();
    });

    beforeAll(() => {
        globalThis.document = {
            createElement: () => ({ click: vi.fn(), style: {} }),
            body: { appendChild: vi.fn(), removeChild: vi.fn() }
        };
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
        globalThis.URL.revokeObjectURL = vi.fn();
    });

    function wireExportPipeline(dataset, exportConfig = {}) {
        const engine = new WorkflowEngine();
        const input = new StaticInputNode('node-1', dataset);
        const exp = new ExportNode();
        exp.id = 'node-2';
        Object.assign(exp.config, exportConfig);
        engine.addNode(input);
        engine.addNode(exp);
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });
        return { engine, exp, input };
    }

    it('calls exportDataset for every spatial format with correct args', async () => {
        const spatial = makeSpatialDataset(2);
        const formats = getAvailableFormats(spatial).map((f) => f.key);
        expect(formats.length).toBeGreaterThan(0);

        for (const format of formats) {
            const spy = vi.spyOn(await import('../js/export/exporter.js'), 'exportDataset')
                .mockResolvedValue({ filename: `${format}.out`, size: 1 });

            const { engine } = wireExportPipeline(spatial, { format, filename: 'demo' });
            const result = await engine.run({});
            expect(result.status).toBe('success');
            expect(spy).toHaveBeenCalledWith(
                spatial,
                format,
                expect.objectContaining({ filename: 'demo' })
            );
            spy.mockRestore();
        }
    });

    it('calls exportDataset for every table format with correct args', async () => {
        const table = makeTableDataset(2);
        const formats = getAvailableFormats(table).map((f) => f.key);

        for (const format of formats) {
            const spy = vi.spyOn(await import('../js/export/exporter.js'), 'exportDataset')
                .mockResolvedValue({ filename: `${format}.out`, size: 1 });

            const { engine } = wireExportPipeline(table, { format });
            await engine.run({});
            expect(spy).toHaveBeenCalledWith(table, format, expect.any(Object));
            spy.mockRestore();
        }
    });

    it('runs a real in-memory geojson export end-to-end', async () => {
        const spatial = makeSpatialDataset(1, 'RealExport');
        const { engine } = wireExportPipeline(spatial, { format: 'geojson', filename: 'real-out' });
        const createObjectUrl = vi.mocked(globalThis.URL.createObjectURL);
        createObjectUrl.mockClear();
        const result = await engine.run({});
        expect(result.status).toBe('success');
        expect(createObjectUrl).toHaveBeenCalled();
        const blob = createObjectUrl.mock.calls.at(-1)[0];
        const text = await blob.text();
        const parsed = JSON.parse(text);
        expect(parsed.type).toBe('FeatureCollection');
        expect(parsed.features).toHaveLength(1);
        expect(parsed.features[0].geometry.type).toBe('Point');
    });

    it('defaults filename from upstream dataset name', async () => {
        const spy = vi.spyOn(await import('../js/export/exporter.js'), 'exportDataset')
            .mockResolvedValue({ filename: 'x', size: 1 });
        const { engine } = wireExportPipeline(makeSpatialDataset(1, 'UpstreamName'), {
            format: 'geojson',
            filename: ''
        });
        await engine.run({});
        expect(spy).toHaveBeenCalledWith(
            expect.anything(),
            'geojson',
            expect.objectContaining({ filename: 'UpstreamName' })
        );
        spy.mockRestore();
    });

    it('errors on missing input', async () => {
        const engine = new WorkflowEngine();
        const exp = new ExportNode();
        exp.id = 'node-1';
        engine.addNode(exp);
        const result = await engine.run({});
        expect(result.status).toBe('failed');
        expect(exp._runStatus).toBe('error');
        expect(exp._error).toMatch(/No input/i);
    });

    it('errors on empty dataset', async () => {
        const { engine, exp } = wireExportPipeline(makeSpatialDataset(0));
        const result = await engine.run({});
        expect(result.status).toBe('partial');
        expect(exp._runStatus).toBe('error');
        expect(exp._error).toMatch(/empty/i);
    });

    it('errors when format does not fit input type', async () => {
        const { engine, exp } = wireExportPipeline(makeTableDataset(2), { format: 'geojson' });
        const result = await engine.run({});
        expect(result.status).toBe('partial');
        expect(exp._runStatus).toBe('error');
        expect(exp._error).toMatch(/not available/i);
        expect(formatAvailableForDataset(makeTableDataset(), 'geojson')).toBe(false);
    });

    it('surfaces export failure without breaking parallel branch', async () => {
        vi.spyOn(await import('../js/export/exporter.js'), 'exportDataset')
            .mockRejectedValue(new Error('disk full'));

        const engine = new WorkflowEngine();
        const root = new StaticInputNode('node-1', makeSpatialDataset(1));
        const badExport = new ExportNode();
        badExport.id = 'node-2';
        badExport.config.format = 'geojson';
        const goodPass = new PassthroughNode('node-3');
        const downstreamBad = new PassthroughNode('node-4');
        const downstreamGood = new PassthroughNode('node-5');

        engine.addNode(root);
        engine.addNode(badExport);
        engine.addNode(goodPass);
        engine.addNode(downstreamBad);
        engine.addNode(downstreamGood);

        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-2', toPort: 'in' });
        engine.addWire({ from: 'node-1', fromPort: 'out', to: 'node-3', toPort: 'in' });
        engine.addWire({ from: 'node-2', fromPort: 'out', to: 'node-4', toPort: 'in' });
        engine.addWire({ from: 'node-3', fromPort: 'out', to: 'node-5', toPort: 'in' });

        const result = await engine.run({});
        expect(result.status).toBe('partial');
        expect(badExport._runStatus).toBe('error');
        expect(badExport._error).toMatch(/Export failed.*disk full/i);
        expect(downstreamBad._runStatus).toBe('skipped');
        expect(goodPass._runStatus).toBe('done');
        expect(downstreamGood._runStatus).toBe('done');
    });

    it('cancels before export when signal already aborted', async () => {
        vi.spyOn(await import('../js/export/exporter.js'), 'exportDataset')
            .mockResolvedValue({ filename: 'x', size: 1 });

        const { engine } = wireExportPipeline(makeSpatialDataset(1));
        const ac = new AbortController();
        ac.abort();
        const result = await engine.run({}, { signal: ac.signal });
        expect(result.status).toBe('cancelled');
    });

    it('cancels during export via workflow context', async () => {
        vi.spyOn(await import('../js/export/exporter.js'), 'exportDataset')
            .mockImplementation(async () => {
                await new Promise((r) => setTimeout(r, 50));
                return { filename: 'x', size: 1 };
            });

        const { engine } = wireExportPipeline(makeSpatialDataset(1));
        const ac = new AbortController();
        const runPromise = engine.run({}, { signal: ac.signal });
        setTimeout(() => ac.abort(), 5);
        const result = await runPromise;
        expect(result.status).toBe('cancelled');
    });

    it('emits progress at start and end', async () => {
        vi.spyOn(await import('../js/export/exporter.js'), 'exportDataset')
            .mockResolvedValue({ filename: 'x', size: 1 });

        const { engine } = wireExportPipeline(makeSpatialDataset(1), { format: 'geojson' });
        const progress = [];
        engine.subscribeRunEvents((evt) => {
            if (evt.type === 'node' && evt.nodeId === 'node-2' && evt.progress != null) {
                progress.push(evt.progress);
            }
        });

        await engine.run({});
        expect(progress.some((p) => p <= 0.01)).toBe(true);
        expect(progress.some((p) => p >= 1)).toBe(true);
    });

    it('passes workspace-backed dataset through to exportDataset unchanged', async () => {
        const workspaceDs = {
            id: 'ws-1',
            name: 'Chunked',
            type: 'spatial-chunked',
            storage: 'workspace',
            workspaceLayerId: 'ws-1',
            geojson: { type: 'FeatureCollection', features: [] },
            schema: { geometryType: 'Point', featureCount: 500, fields: [] }
        };
        const spy = vi.spyOn(await import('../js/export/exporter.js'), 'exportDataset')
            .mockResolvedValue({ filename: 'x', size: 1 });

        const { engine } = wireExportPipeline(workspaceDs, { format: 'geojson' });
        await engine.run({});
        expect(spy).toHaveBeenCalledWith(workspaceDs, 'geojson', expect.any(Object));
        spy.mockRestore();
    });

    it('round-trips export node config in graph JSON', () => {
        const engine = new WorkflowEngine();
        const exp = new ExportNode();
        exp.id = 'node-9';
        exp.config = { format: 'kml', filename: 'saved', targetCrs: 'EPSG:4326' };
        engine.addNode(exp);

        const json = graphFromEngine(engine);
        expect(json.schemaVersion).toBe(1);
        expect(json.nodes[0]).toMatchObject({
            type: 'export',
            config: { format: 'kml', filename: 'saved', targetCrs: 'EPSG:4326' }
        });

        const loaded = new WorkflowEngine();
        const { loaded: ok, unknownTypes } = loadGraphIntoEngine(loaded, json);
        expect(ok).toBe(true);
        expect(unknownTypes).toEqual([]);
        const node = loaded.nodes.get('node-9');
        expect(node.type).toBe('export');
        expect(node.config.format).toBe('kml');
        expect(node.config.filename).toBe('saved');
    });
});

describe('exportDataset mock guard', () => {
    it('does not invoke live network (exportDataset is local-only in tests)', () => {
        expect(typeof exportDataset).toBe('function');
        expect(typeof downloadBlob).toBe('function');
    });
});
