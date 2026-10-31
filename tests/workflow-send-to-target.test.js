/**
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../js/widgets/registry.js';
import '../js/workflow/workflow-send-to-target.js';
import {
    buildProducedResult,
    getCompatibleTargets,
    sendResultToTarget
} from '../js/tools/tool-result-interop.js';
import { getTool, isVisible, registerTool } from '../js/tools/tool-registry.js';
import { WorkflowEngine } from '../js/workflow/workflow-engine.js';
import { loadGraphIntoEngine } from '../js/workflow/workflow-graph-loader.js';
import { loadAutosaveDraft } from '../js/workflow/workflow-library-db.js';
import { createChunkedSpatialDataset } from '../js/core/data-model.js';
import { FilterRowsNode } from '../js/workflow/nodes/transform-nodes.js';
import { resetNodeIdCounter } from '../js/workflow/nodes/node-base.js';
import { openWorkflowCanvasWithLayerInput } from '../js/workflow/workflow-send-to-target.js';

const sampleGeojson = JSON.parse(
    readFileSync(join(process.cwd(), 'tests/fixtures/sample-point.geojson'), 'utf8')
);

const mockOpen = vi.fn().mockResolvedValue(undefined);
let mockEngine;
let mockController;

vi.mock('../js/tools/tool-handlers.js', () => ({
    getWorkflowOverlay: () => mockController
}));

async function flushSendTo() {
    for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
    }
}

function makeLayer(overrides = {}) {
    return {
        id: 'layer-1',
        name: 'Sites',
        type: 'spatial',
        geojson: sampleGeojson,
        schema: { featureCount: 1, fields: [] },
        ...overrides
    };
}

beforeEach(() => {
    mockEngine = new WorkflowEngine();
    mockOpen.mockClear();
    mockController = {
        engine: mockEngine,
        open: mockOpen,
        refreshCanvasViews: vi.fn()
    };
});

describe('workflow-canvas send-to registration', () => {
    it('registers once with expected metadata', () => {
        const entry = getTool('workflow-canvas');
        expect(entry).toBeTruthy();
        expect(entry.kind).toEqual(['widget']);
        expect(entry.version).toBe(1);
        expect(typeof entry.open).toBe('function');
        expect(entry.label).toBe('Send to workflow');
        expect(entry.surfaces).toMatchObject({ palette: false, mapPanel: false });
    });

    it('duplicate-registration guard avoids registerTool throw', () => {
        expect(getTool('workflow-canvas')).toBeTruthy();
        expect(() => {
            if (!getTool('workflow-canvas')) {
                registerTool({
                    version: 1,
                    id: 'workflow-canvas',
                    kind: ['widget'],
                    label: 'Send to workflow',
                    status: 'ga',
                    open: () => {}
                });
            }
        }).not.toThrow();
        expect(getTool('workflow-canvas')?.label).toBe('Send to workflow');
    });

    it('is compatible with layer and table results but hidden from palette', () => {
        const layerResult = buildProducedResult('buffer', {
            layerIds: ['x'],
            outputs: [{ name: 'out', type: 'layer' }]
        });
        const tableResult = buildProducedResult('fiber-slack-otdr-helper', {
            layerIds: ['t1'],
            outputs: [{ name: 'out', type: 'table' }]
        });

        const layerTargets = getCompatibleTargets(layerResult).map(({ entry }) => entry.id);
        const tableTargets = getCompatibleTargets(tableResult).map(({ entry }) => entry.id);
        expect(layerTargets).toContain('workflow-canvas');
        expect(tableTargets).toContain('workflow-canvas');
        expect(isVisible(getTool('workflow-canvas'), 'palette')).toBe(false);
    });
});

describe('sendResultToTarget → workflow-canvas', () => {
    it('creates a graph with one configured Layer Input when the canvas is empty', async () => {
        const ctx = {
            showToast: vi.fn(),
            getLayers: () => [makeLayer()]
        };
        const result = buildProducedResult('spatial-join', {
            layerIds: ['layer-1'],
            outputs: [{ name: 'out', type: 'layer' }]
        });

        sendResultToTarget(ctx, 'workflow-canvas', result);
        await flushSendTo();

        expect(mockOpen).toHaveBeenCalled();
        expect(mockEngine.nodes.size).toBe(1);
        const node = [...mockEngine.nodes.values()][0];
        expect(node.type).toBe('layer-input');
        expect(node.config.layerId).toBe('layer-1');
        expect(mockEngine.wires).toEqual([]);
        expect(ctx.showToast).toHaveBeenCalledWith('Added "Sites" to the workflow.', 'success');

        await flushSendTo();
        const draft = await loadAutosaveDraft();
        expect(draft?.nodes).toHaveLength(1);
        expect(draft.nodes[0].type).toBe('layer-input');
        expect(draft.nodes[0].config.layerId).toBe('layer-1');
    });

    it('appends a Layer Input without changing existing nodes or wires', async () => {
        resetNodeIdCounter(0);
        loadGraphIntoEngine(mockEngine, {
            nodes: [
                {
                    id: 'node-1',
                    type: 'filter-rows',
                    config: { field: 'a', operator: 'equals', value: '1' },
                    position: { x: 40, y: 60 }
                }
            ],
            wires: []
        });
        const existing = mockEngine.nodes.get('node-1');
        expect(existing).toBeInstanceOf(FilterRowsNode);
        const configBefore = structuredClone(existing.config);
        const positionBefore = { ...existing.position };

        const ctx = {
            showToast: vi.fn(),
            getLayers: () => [makeLayer({ id: 'layer-2', name: 'Joined' })]
        };
        const result = buildProducedResult('buffer', {
            layerIds: ['layer-2'],
            outputs: [{ name: 'out', type: 'layer' }]
        });

        sendResultToTarget(ctx, 'workflow-canvas', result);
        await flushSendTo();

        expect(mockEngine.nodes.size).toBe(2);
        expect(mockEngine.nodes.get('node-1')).toBe(existing);
        expect(existing.config).toEqual(configBefore);
        expect(existing.position).toEqual(positionBefore);
        expect(mockEngine.wires).toEqual([]);

        const added = [...mockEngine.nodes.values()].find((n) => n.type === 'layer-input');
        expect(added?.config.layerId).toBe('layer-2');
        expect(added?.position.x).toBeGreaterThan(40);
    });

    it('accepts spatial-chunked layer ids', async () => {
        const chunked = createChunkedSpatialDataset('Big', {
            id: 'ws-chunk-1',
            schema: { featureCount: 0, fields: [] }
        });
        const ctx = {
            showToast: vi.fn(),
            getLayers: () => [chunked]
        };

        await openWorkflowCanvasWithLayerInput(ctx, { layerId: chunked.id });
        await flushSendTo();

        const node = [...mockEngine.nodes.values()][0];
        expect(node.config.layerId).toBe('ws-chunk-1');
    });

    it('shows a toast and does not add a node when the layer is missing', async () => {
        const ctx = {
            showToast: vi.fn(),
            getLayers: () => []
        };
        const result = buildProducedResult('buffer', {
            layerIds: ['gone'],
            outputs: [{ name: 'out', type: 'layer' }]
        });

        sendResultToTarget(ctx, 'workflow-canvas', result);
        await flushSendTo();

        expect(mockEngine.nodes.size).toBe(0);
        expect(ctx.showToast).toHaveBeenCalledWith(
            'That layer is no longer in the project — it was not added to the workflow.',
            'warning'
        );
        expect(mockOpen).not.toHaveBeenCalled();
    });
});
