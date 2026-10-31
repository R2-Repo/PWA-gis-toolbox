/**
 * Send-to interop: typed tool/widget results, compatible targets, and open-with-input.
 * Workflow canvas can subscribe via onToolResult(TOOL_RESULT_EVENT) or call getCompatibleTargets.
 */
import { emitToolResult, getTool, isVisible, listTools } from './tool-registry.js';

/** @typedef {{ name: string, type: 'layer' | 'table', geometry?: string | string[] }} ToolResultOutput */
/**
 * @typedef {object} ToolProducedResult
 * @property {string} sourceId
 * @property {string[]} layerIds
 * @property {ToolResultOutput[]} outputs
 * @property {{ inCount?: number, outCount?: number, failed?: number, [key: string]: * }} stats
 */

/** @type {{ targetId: string, layerId: string, inputName: string } | null} */
let pendingSendTo = null;

/**
 * @param {string} sourceId
 * @param {{ layerIds?: string[], outputs?: ToolResultOutput[], stats?: object }} detail
 * @returns {ToolProducedResult}
 */
export function buildProducedResult(sourceId, detail = {}) {
    const layerIds = [...(detail.layerIds || [])];
    const outputs = [...(detail.outputs || [])];
    if (!outputs.length && layerIds.length) {
        outputs.push({ name: 'out', type: 'layer' });
    }
    return {
        sourceId,
        layerIds,
        outputs,
        stats: { ...(detail.stats || {}) }
    };
}

/**
 * Emit `result:produced` with the typed payload (also sets legacy `id` for older listeners).
 * @param {ToolProducedResult} result
 */
export function emitProducedResult(result) {
    if (!result?.sourceId) return;
    emitToolResult({
        id: result.sourceId,
        sourceId: result.sourceId,
        layerIds: result.layerIds,
        outputs: result.outputs,
        stats: result.stats
    });
}

/**
 * Infer primary geometry types from a map layer dataset.
 * @param {import('../core/data-model.js').Dataset | undefined} layer
 * @returns {string[] | undefined}
 */
export function inferLayerGeometryTypes(layer) {
    const features = layer?.geojson?.features;
    if (!features?.length) return undefined;
    const types = new Set();
    for (const feature of features) {
        const g = feature?.geometry?.type;
        if (g) types.add(g);
    }
    return types.size ? [...types] : undefined;
}

/**
 * @param {string} sourceId
 * @param {import('../core/data-model.js').Dataset} layer
 * @param {{ outputName?: string, stats?: object }} [opts]
 */
export function emitLayerProducedResult(sourceId, layer, opts = {}) {
    const geometry = inferLayerGeometryTypes(layer);
    emitProducedResult(buildProducedResult(sourceId, {
        layerIds: layer?.id ? [layer.id] : [],
        outputs: [{
            name: opts.outputName || 'out',
            type: 'layer',
            ...(geometry ? { geometry } : {})
        }],
        stats: {
            outCount: layer?.geojson?.features?.length ?? 0,
            ...(opts.stats || {})
        }
    }));
}

/**
 * @param {ToolProducedResult} result
 * @param {{ excludeSelf?: boolean, kinds?: ('tool' | 'widget')[] }} [opts]
 * @returns {{ entry: import('./tool-registry.js').ToolRegistryEntry, inputName: string, score: number }[]}
 */
export function getCompatibleTargets(result, opts = {}) {
    if (!result?.outputs?.length) return [];
    const kinds = opts.kinds ?? ['tool', 'widget'];
    const excludeSelf = opts.excludeSelf !== false;
    const producedTypes = new Set(result.outputs.map((o) => o.type));
    const producedGeometries = result.outputs.flatMap((o) => {
        if (!o.geometry) return [];
        return Array.isArray(o.geometry) ? o.geometry : [o.geometry];
    });

    /** @type {{ entry: import('./tool-registry.js').ToolRegistryEntry, inputName: string, score: number }[]} */
    const matches = [];

    for (const entry of listTools()) {
        if (entry.status === 'hidden') continue;
        if (!kinds.some((k) => entry.kind.includes(k))) continue;
        if (excludeSelf && entry.id === result.sourceId) continue;
        if (entry.kind.includes('widget') && typeof entry.open !== 'function') continue;
        if (entry.kind.includes('tool') && !entry.mapAction && !entry.kind.includes('widget')) continue;

        const inputs = entry.inputs || [];
        if (!inputs.length) continue;

        for (const input of inputs) {
            if (!producedTypes.has(input.type)) continue;
            if (input.required === false) continue;

            let score = 10;
            if (input.geometry?.length && producedGeometries.length) {
                const hint = input.geometry;
                const overlap = hint.filter((g) => producedGeometries.includes(g));
                if (overlap.length) score += overlap.length;
            } else if (producedGeometries.length) {
                score += 1;
            }

            const canOpen =
                (entry.kind.includes('widget') && entry.open)
                || (entry.kind.includes('tool') && entry.mapAction);
            if (!canOpen) continue;

            matches.push({ entry, inputName: input.name, score });
            break;
        }
    }

    matches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.entry.label.localeCompare(b.entry.label);
    });

    const seen = new Set();
    return matches.filter(({ entry }) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
    });
}

/**
 * @param {string} targetId
 * @param {string} layerId
 * @param {string} [inputName]
 */
export function armSendToInput(targetId, layerId, inputName = 'in') {
    pendingSendTo = { targetId, layerId, inputName };
}

/**
 * @param {string} toolId
 * @returns {string | null}
 */
export function takePendingSendToLayer(toolId) {
    if (!pendingSendTo || pendingSendTo.targetId !== toolId) return null;
    const { layerId } = pendingSendTo;
    pendingSendTo = null;
    return layerId;
}

export function clearPendingSendTo() {
    pendingSendTo = null;
}

/**
 * Set active layer from a pending Send-to before opening a map GIS tool dialog.
 * @param {string} toolId
 * @param {(id: string) => void} setActiveLayer
 */
export function applyPendingSendToActiveLayer(toolId, setActiveLayer) {
    const layerId = takePendingSendToLayer(toolId);
    if (layerId && typeof setActiveLayer === 'function') {
        setActiveLayer(layerId);
    }
}

/**
 * @param {import('../widgets/widget-types.js').WidgetContext} ctx
 * @param {string} targetId
 * @param {ToolProducedResult} result
 * @param {{ outputIndex?: number, inputName?: string }} [opts]
 */
export function sendResultToTarget(ctx, targetId, result, opts = {}) {
    const entry = getTool(targetId);
    if (!entry) {
        ctx.showToast?.('Target not found.', 'warning');
        return;
    }
    const outputIndex = opts.outputIndex ?? 0;
    const layerId = result.layerIds?.[outputIndex] || result.layerIds?.[0];
    if (!layerId) {
        ctx.showToast?.('No layer to send.', 'warning');
        return;
    }
    const compatible = getCompatibleTargets(result);
    const match = compatible.find((m) => m.entry.id === targetId);
    const inputName = opts.inputName || match?.inputName || 'in';

    if (entry.kind.includes('widget') && entry.open) {
        entry.open(ctx, {
            initialInput: { layerId, inputName, result }
        });
        return;
    }

    if (entry.mapAction) {
        armSendToInput(entry.id, layerId, inputName);
        if (typeof ctx.setActiveLayer === 'function') {
            ctx.setActiveLayer(layerId);
        }
        import('./tool-handlers.js').then(({ invokeAppAction }) => {
            invokeAppAction(entry.mapAction);
        });
        return;
    }

    ctx.showToast?.(`${entry.label} cannot accept this result yet.`, 'warning');
}

/**
 * Filter compatible targets to those visible in the widget or map panel.
 * @param {ToolProducedResult} result
 * @param {'widgetPanel' | 'mapPanel'} surface
 */
export function getVisibleCompatibleTargets(result, surface) {
    return getCompatibleTargets(result).filter(({ entry }) => {
        if (surface === 'widgetPanel') {
            return entry.kind.includes('widget') && isVisible(entry, 'widgetPanel');
        }
        return entry.kind.includes('tool') && isVisible(entry, 'mapPanel');
    });
}
