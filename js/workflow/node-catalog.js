import '../tools/tool-catalog.js';
import { getTool, listTools } from '../tools/tool-registry.js';
import { LAYER_DATA_NODE_ORDER } from '../tools/tool-catalog.js';
import { INPUT_NODES } from './nodes/input-nodes.js';
import { TRANSFORM_NODES } from './nodes/transform-nodes.js';
import { SPATIAL_NODES } from './nodes/spatial-nodes.js';
import { ENRICHMENT_NODES } from './nodes/enrichment-nodes.js';
import { OUTPUT_NODES } from './nodes/output-nodes.js';
import { getNodeDescription } from './node-descriptions.js';

function withDescription(def) {
    return { ...def, description: getNodeDescription(def) };
}

/** @type {Map<string, { type: string, label: string, icon: string, create: () => import('./nodes/node-base.js').NodeBase }>} */
const CANVAS_NODE_BY_ID = new Map(
    [...INPUT_NODES, ...TRANSFORM_NODES, ...SPATIAL_NODES, ...ENRICHMENT_NODES, ...OUTPUT_NODES].map((def) => [
        def.type,
        def
    ])
);

const CATEGORY_META = {
    input: { label: 'Inputs', color: '#d97706' },
    'layer-data': { label: 'Layer Data Tools', color: '#2563eb' },
    transform: { label: 'Transforms', color: '#2563eb' },
    spatial: { label: 'Spatial', color: '#059669' },
    enrichment: { label: 'Enrichment', color: '#0891b2' },
    output: { label: 'Outputs', color: '#7c3aed' }
};

const CATEGORY_ORDER = ['input', 'layer-data', 'transform', 'spatial', 'enrichment', 'output'];

function sortNodesInCategory(categoryKey, nodes) {
    if (categoryKey === 'layer-data') {
        const order = new Map(LAYER_DATA_NODE_ORDER.map((id, i) => [id, i]));
        return [...nodes].sort((a, b) => (order.get(a.type) ?? 999) - (order.get(b.type) ?? 999));
    }
    return nodes;
}

function buildNodeCategories() {
    const nodesByCategory = new Map();

    for (const entry of listTools({ kind: 'node' })) {
        const canvasDef = CANVAS_NODE_BY_ID.get(entry.id);
        if (!canvasDef) {
            if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
                console.warn(`[node-catalog] Registry node "${entry.id}" has no canvas class — omitted from palette`);
            }
            continue;
        }

        const categoryKey = entry.category && CATEGORY_META[entry.category] ? entry.category : 'transform';
        if (!nodesByCategory.has(categoryKey)) nodesByCategory.set(categoryKey, []);

        nodesByCategory.get(categoryKey).push(
            withDescription({
                ...canvasDef,
                type: entry.id,
                label: entry.label || canvasDef.label,
                icon: entry.icon || canvasDef.icon,
                tip: entry.tip,
                registryEntry: entry
            })
        );
    }

    for (const [type] of CANVAS_NODE_BY_ID) {
        if (!getTool(type) && typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
            console.warn(`[node-catalog] Canvas node "${type}" has no registry entry`);
        }
    }

    return CATEGORY_ORDER.filter((key) => nodesByCategory.has(key)).map((key) => ({
        key,
        ...CATEGORY_META[key],
        nodes: sortNodesInCategory(key, nodesByCategory.get(key))
    }));
}

export const NODE_CATEGORIES = buildNodeCategories();

export { getNodeDescription };

/** @returns {{ registryWithoutCanvas: string[], canvasWithoutRegistry: string[] }} */
export function getNodeRegistryCanvasSyncReport() {
    const registryNodeIds = listTools({ kind: 'node' }).map((e) => e.id);
    const canvasIds = [...CANVAS_NODE_BY_ID.keys()];
    return {
        registryWithoutCanvas: registryNodeIds.filter((id) => !CANVAS_NODE_BY_ID.has(id)).sort(),
        canvasWithoutRegistry: canvasIds.filter((id) => !getTool(id)).sort()
    };
}

/** Resolve aliases and look up a palette node definition by type id. */
export function findNodeDef(type) {
    const entry = getTool(type);
    const canonical = entry?.id ?? type;
    for (const cat of NODE_CATEGORIES) {
        const def = cat.nodes.find((n) => n.type === canonical);
        if (def) return def;
    }
    return null;
}
