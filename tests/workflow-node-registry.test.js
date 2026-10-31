import { describe, expect, it } from 'vitest';
import '../js/tools/tool-catalog.js';
import { getTool, isVisible, listTools } from '../js/tools/tool-registry.js';
import { isPipelineNodeEnabled } from '../js/tools/tool-catalog.js';
import { NODE_CATEGORIES, findNodeDef, getNodeRegistryCanvasSyncReport } from '../js/workflow/node-catalog.js';
import { migrateWorkflowGraph } from '../js/workflow/workflow-schema.js';
import { loadGraphIntoEngine } from '../js/workflow/workflow-graph-loader.js';
import { WorkflowEngine } from '../js/workflow/workflow-engine.js';
import { resetNodeIdCounter } from '../js/workflow/nodes/node-base.js';
import {
    REGISTRY_PARAM_TO_CANVAS,
    REGISTRY_PARAMS_EXPLICITLY_UNMAPPED
} from '../js/workflow/workflow-registry-param-map.js';
import { RenameFieldsNode } from '../js/workflow/nodes/transform-nodes.js';

function paletteVisibleTypes(isVisibleFn) {
    const types = new Set();
    for (const cat of NODE_CATEGORIES) {
        for (const def of cat.nodes) {
            if (isVisibleFn(def)) types.add(def.type);
        }
    }
    return types;
}

describe('workflow node catalog (registry Job 7)', () => {
    it('builds NODE_CATEGORIES from listTools({ kind: node }) with canvas create()', () => {
        const catalogTypes = new Set(NODE_CATEGORIES.flatMap((c) => c.nodes.map((n) => n.type)));
        const registryNodeIds = listTools({ kind: 'node' })
            .map((e) => e.id)
            .filter((id) => findNodeDef(id));
        expect(catalogTypes.size).toBe(registryNodeIds.length);
        for (const id of registryNodeIds) {
            expect(catalogTypes.has(id)).toBe(true);
            const def = findNodeDef(id);
            expect(def?.create).toBeTypeOf('function');
            expect(def?.label).toBeTruthy();
            expect(def?.icon).toBeTruthy();
        }
    });

    it('palette visibility matches legacy isPipelineNodeEnabled gate', () => {
        for (const cat of NODE_CATEGORIES) {
            for (const def of cat.nodes) {
                const legacy = isPipelineNodeEnabled(def.type);
                const registry = isVisible(getTool(def.type), 'palette');
                expect(registry).toBe(legacy);
            }
        }

        const legacySet = paletteVisibleTypes((def) => isPipelineNodeEnabled(def.type));
        const registrySet = paletteVisibleTypes((def) => isVisible(getTool(def.type), 'palette'));
        expect(registrySet).toEqual(legacySet);
    });

    it('reports registry vs canvas sync gaps', () => {
        const report = getNodeRegistryCanvasSyncReport();
        expect(report).toEqual({ registryWithoutCanvas: [], canvasWithoutRegistry: [] });
    });
});

describe('workflow graph alias resolution (Job 7)', () => {
    it('migrates clip-extent and bbox-clip aliases to canonical clip', () => {
        const graph = migrateWorkflowGraph({
            nodes: [
                { id: 'node-1', type: 'clip-extent', config: {}, position: { x: 0, y: 0 } },
                { id: 'node-2', type: 'bbox-clip', config: {}, position: { x: 0, y: 0 } }
            ],
            wires: []
        });
        expect(graph.nodes[0].type).toBe('clip');
        expect(graph.nodes[1].type).toBe('clip');
    });

    it('loads hidden registry nodes and can execute them', async () => {
        resetNodeIdCounter(0);
        const engine = new WorkflowEngine();
        const { loaded, unknownTypes } = loadGraphIntoEngine(engine, {
            nodes: [
                {
                    id: 'node-2',
                    type: 'rename-fields',
                    config: { mappings: [{ from: 'a', to: 'alpha' }] },
                    position: { x: 0, y: 0 }
                }
            ],
            wires: []
        });

        expect(loaded).toBe(true);
        expect(unknownTypes).toEqual([]);
        expect(getTool('rename-fields')?.status).toBe('hidden');

        const renameNode = engine.nodes.get('node-2');
        expect(renameNode).toBeInstanceOf(RenameFieldsNode);

        const dataset = {
            type: 'spatial',
            name: 'src',
            geojson: {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: { a: 1, b: 2 },
                        geometry: { type: 'Point', coordinates: [0, 0] }
                    }
                ]
            },
            schema: { featureCount: 1, fields: [] }
        };

        const out = await renameNode.execute([dataset], {});
        expect(out.geojson.features[0].properties.alpha).toBe(1);
        expect(out.geojson.features[0].properties.a).toBeUndefined();
    });

    it('uses placeholder for unknown node types', () => {
        resetNodeIdCounter(0);
        const engine = new WorkflowEngine();
        const { unknownTypes } = loadGraphIntoEngine(engine, {
            nodes: [{ id: 'node-9', type: 'not-a-real-node', config: {}, position: { x: 0, y: 0 } }],
            wires: []
        });
        expect(unknownTypes).toContain('not-a-real-node');
        expect(engine.nodes.get('node-9')?.type).toBe('unknown-node-type');
    });
});

describe('workflow registry param map (Job 7)', () => {
    it('covers every registry node param or lists it as explicitly unmapped', () => {
        const missing = [];
        for (const entry of listTools({ kind: 'node' })) {
            for (const param of entry.params || []) {
                const mapped = REGISTRY_PARAM_TO_CANVAS[entry.id]?.[param.name];
                const explicit = (REGISTRY_PARAMS_EXPLICITLY_UNMAPPED[entry.id] || []).includes(param.name);
                if (!mapped && !explicit) {
                    missing.push(`${entry.id}.${param.name}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });
});
