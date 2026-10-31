/**
 * Load migrated graph JSON into a WorkflowEngine (including unknown-node placeholders).
 */
import { findNodeDef } from './node-catalog.js';
import { resetNodeIdCounter } from './nodes/node-base.js';
import {
    createUnknownPlaceholderNode,
    UNKNOWN_PLACEHOLDER_NODE_TYPE
} from './nodes/unknown-placeholder-node.js';
import { migrateWorkflowGraph } from './workflow-schema.js';

/**
 * @param {import('./workflow-engine.js').WorkflowEngine} engine
 * @param {unknown} graphInput
 * @returns {{ loaded: boolean, unknownTypes: string[] }}
 */
export function loadGraphIntoEngine(engine, graphInput) {
    const graph = migrateWorkflowGraph(graphInput);
    if (!graph.nodes?.length) {
        return { loaded: false, unknownTypes: [] };
    }

    engine.clear();

    let maxId = 0;
    for (const nd of graph.nodes) {
        const num = parseInt(String(nd.id).replace('node-', ''), 10);
        if (!isNaN(num) && num > maxId) maxId = num;
    }
    resetNodeIdCounter(maxId);

    const unknownTypes = [];

    for (const nd of graph.nodes) {
        if (nd.type === UNKNOWN_PLACEHOLDER_NODE_TYPE) {
            engine.addNode(createUnknownPlaceholderNode(nd));
            unknownTypes.push(nd.config?.originalType || 'unknown');
            continue;
        }

        const def = findNodeDef(nd.type);
        if (!def) {
            unknownTypes.push(nd.type);
            engine.addNode(createUnknownPlaceholderNode(nd));
            continue;
        }

        const node = def.create();
        node.id = nd.id;
        node.position = nd.position || { x: 0, y: 0 };
        node.config = { ...node.config, ...nd.config };
        if (nd.comment) node.comment = nd.comment;
        engine.addNode(node);
    }

    for (const w of graph.wires || []) {
        engine.addWire(w);
    }

    return {
        loaded: true,
        unknownTypes: [...new Set(unknownTypes.filter(Boolean))]
    };
}
