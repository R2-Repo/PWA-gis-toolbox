/**
 * Workflow graph JSON schema version and migrations.
 * Run migrateWorkflowGraph on every load path (autosave, library, file import, presets, project kits).
 */

/** @typedef {{ schemaVersion: number, nodes: object[], wires: object[] }} WorkflowGraphJSON */

export const CURRENT_WORKFLOW_SCHEMA_VERSION = 1;

/**
 * Extract the inner pipeline graph from export wrappers and legacy shapes.
 * @param {unknown} input
 * @returns {{ nodes: object[], wires: object[], schemaVersion?: number }}
 */
export function unwrapWorkflowInput(input) {
    if (!input || typeof input !== 'object') {
        return { nodes: [], wires: [] };
    }
    const obj = /** @type {Record<string, unknown>} */ (input);
    if (obj.pipeline && typeof obj.pipeline === 'object') {
        const inner = /** @type {Record<string, unknown>} */ (obj.pipeline);
        if (Array.isArray(inner.nodes)) {
            return {
                nodes: inner.nodes,
                wires: Array.isArray(inner.wires) ? inner.wires : [],
                schemaVersion: typeof inner.schemaVersion === 'number' ? inner.schemaVersion : undefined
            };
        }
        return unwrapWorkflowInput(obj.pipeline);
    }
    if (Array.isArray(obj.nodes)) {
        return {
            nodes: obj.nodes,
            wires: Array.isArray(obj.wires) ? obj.wires : [],
            schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : undefined
        };
    }
    return { nodes: [], wires: [] };
}

/**
 * Upgrade unversioned / older graph JSON to the current schema.
 * @param {unknown} input — raw pipeline, export wrapper, or project kit fragment
 * @returns {WorkflowGraphJSON}
 */
export function migrateWorkflowGraph(input) {
    const unwrapped = unwrapWorkflowInput(input);
    let version = unwrapped.schemaVersion ?? 0;
    let nodes = Array.isArray(unwrapped.nodes) ? unwrapped.nodes.map((n) => ({ ...n })) : [];
    let wires = Array.isArray(unwrapped.wires) ? unwrapped.wires.map((w) => ({ ...w })) : [];

    while (version < CURRENT_WORKFLOW_SCHEMA_VERSION) {
        if (version === 0) {
            nodes = nodes.map(normalizeLegacyNode);
            wires = wires.map(normalizeLegacyWire);
            version = 1;
            continue;
        }
        throw new Error(`Unsupported workflow schema version ${version}`);
    }

    return {
        schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION,
        nodes,
        wires
    };
}

function normalizeLegacyNode(nd) {
    if (!nd || typeof nd !== 'object') return nd;
    const node = { ...nd };
    if (!node.position || typeof node.position !== 'object') {
        node.position = { x: 0, y: 0 };
    }
    if (node.config == null || typeof node.config !== 'object') {
        node.config = {};
    }
    return node;
}

function normalizeLegacyWire(w) {
    if (!w || typeof w !== 'object') return w;
    return { ...w };
}

/**
 * @param {import('./workflow-engine.js').WorkflowEngine} engine
 * @returns {WorkflowGraphJSON}
 */
export function graphFromEngine(engine) {
    const base = engine.toJSON();
    return {
        schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION,
        nodes: base.nodes,
        wires: base.wires
    };
}

/**
 * Attach schemaVersion to an export wrapper pipeline object.
 * @param {WorkflowGraphJSON} graph
 */
export function graphForExport(graph) {
    const migrated = migrateWorkflowGraph(graph);
    return migrated;
}
