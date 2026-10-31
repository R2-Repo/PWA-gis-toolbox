/**
 * Send-to target: open workflow canvas with a configured Layer Input node.
 */
import { bus } from '../core/event-bus.js';
import { registerTool, getTool } from '../tools/tool-registry.js';
import { findNodeDef } from './node-catalog.js';
import { WorkflowStore } from './workflow-store.js';

/** @param {import('./workflow-engine.js').WorkflowEngine} engine */
export function computeFreePositionForLayerInput(engine) {
    const nodes = [...engine.nodes.values()];
    if (!nodes.length) return { x: 100, y: 100 };

    const nodeWidth = 220;
    const gap = 40;
    let maxRight = 0;
    let sumY = 0;
    for (const n of nodes) {
        const x = n.position?.x ?? 0;
        const y = n.position?.y ?? 0;
        maxRight = Math.max(maxRight, x + nodeWidth);
        sumY += y;
    }
    const avgY = sumY / nodes.length;
    return {
        x: Math.round((maxRight + gap) / 20) * 20,
        y: Math.round(avgY / 20) * 20
    };
}

/**
 * @param {import('../widgets/widget-types.js').WidgetContext} ctx
 * @param {{ layerId?: string, inputName?: string, result?: object } | null | undefined} initialInput
 */
export async function openWorkflowCanvasWithLayerInput(ctx, initialInput) {
    const layerId = initialInput?.layerId;
    if (!layerId) {
        ctx.showToast?.('No layer to send.', 'warning');
        return;
    }

    const layer = ctx.getLayers?.().find((l) => l.id === layerId);
    if (!layer) {
        ctx.showToast?.('That layer is no longer in the project — it was not added to the workflow.', 'warning');
        return;
    }

    const { getWorkflowOverlay } = await import('../tools/tool-handlers.js');
    const wf = getWorkflowOverlay?.();
    if (!wf?.engine) {
        ctx.showToast?.('Workflow editor is not ready yet.', 'warning');
        return;
    }

    await wf.open();

    const def = findNodeDef('layer-input');
    if (!def) {
        ctx.showToast?.('Layer Input node is unavailable.', 'warning');
        return;
    }

    const node = def.create();
    node.config = { ...node.config, layerId };
    node.position = computeFreePositionForLayerInput(wf.engine);

    wf.engine.addNode(node);
    bus.emit('workflow:node-selected', { nodeId: node.id });
    wf.refreshCanvasViews?.({ center: false });
    WorkflowStore.save(wf.engine);

    const layerLabel = layer.name ? `"${layer.name}"` : 'Layer';
    ctx.showToast?.(`Added ${layerLabel} to the workflow.`, 'success');
}

if (!getTool('workflow-canvas')) {
    registerTool({
        version: 1,
        id: 'workflow-canvas',
        kind: ['widget'],
        label: 'Send to workflow',
        icon: '🔀',
        category: 'workflow',
        status: 'ga',
        surfaces: {
            palette: false,
            mapPanel: false
        },
        inputs: [
            { name: 'in', type: 'layer' },
            { name: 'in', type: 'table' }
        ],
        open(ctx, { initialInput } = {}) {
            void openWorkflowCanvasWithLayerInput(ctx, initialInput);
        }
    });
}
