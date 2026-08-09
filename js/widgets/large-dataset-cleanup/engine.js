/**
 * Large Dataset Cleanup Wizard — pure logic (no DOM / mapService).
 */

export const WIDGET_ID = 'large-dataset-cleanup';

export const WIZARD_STEPS = [
    'Select layer',
    'Review footprint',
    'Choose actions',
    'Confirm & run'
];

/**
 * @param {object|null|undefined} layer
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateLayerSelection(layer) {
    if (!layer) return { valid: false, error: 'Select a workspace layer.' };
    const isWorkspace = layer.storage === 'workspace' || layer.type === 'spatial-chunked';
    if (!isWorkspace) {
        return { valid: false, error: 'Cleanup targets workspace (chunked) layers only.' };
    }
    const count = Number(layer.featureCount ?? layer.schema?.featureCount ?? 0);
    if (!Number.isFinite(count) || count <= 0) {
        return { valid: false, error: 'Selected layer has no features.' };
    }
    return { valid: true };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function buildFootprintSummary({
    layerName = '',
    featureCount = 0,
    hotFieldCount = 0,
    coldFieldCount = 0,
    sourceName = null,
    sourceSize = 0,
    sourcePreserved = false,
    storageUsage = 0,
    storageQuota = 0,
    tiled = false
} = {}) {
    return {
        layerName,
        featureCount,
        hotFieldCount,
        coldFieldCount,
        sourceName,
        sourceSize,
        sourcePreserved,
        storageUsage,
        storageQuota,
        usageRatio: storageQuota > 0 ? storageUsage / storageQuota : 0,
        tiled
    };
}

/**
 * @param {{ detachFields?: string[], removeLayer?: boolean, deleteSource?: boolean }} plan
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateCleanupPlan(plan = {}) {
    const detachFields = (plan.detachFields || []).filter(Boolean);
    const removeLayer = !!plan.removeLayer;
    const deleteSource = !!plan.deleteSource;
    if (!detachFields.length && !removeLayer && !deleteSource) {
        return { valid: false, error: 'Choose at least one cleanup action.' };
    }
    if (deleteSource && !removeLayer) {
        return {
            valid: false,
            error: 'Delete preserved source only after removing the layer (or use Storage Manager for orphans).'
        };
    }
    return { valid: true };
}

/**
 * Order: detach (needs layer) → remove layer → delete source.
 * @param {{ detachFields?: string[], removeLayer?: boolean, deleteSource?: boolean }} plan
 */
export function planCleanupOrder(plan = {}) {
    const steps = [];
    const fields = (plan.detachFields || []).filter(Boolean);
    if (fields.length) steps.push({ type: 'detach', fields });
    if (plan.removeLayer) steps.push({ type: 'removeLayer' });
    if (plan.deleteSource) steps.push({ type: 'deleteSource' });
    return steps;
}

/**
 * @param {object[]} schemaFields
 * @returns {string[]}
 */
export function listDetachableFieldNames(schemaFields = []) {
    return (schemaFields || [])
        .filter((f) => f?.name && !f.cold && !String(f.name).startsWith('_'))
        .map((f) => f.name);
}

export default {
    WIDGET_ID,
    WIZARD_STEPS,
    validateLayerSelection,
    buildFootprintSummary,
    validateCleanupPlan,
    planCleanupOrder,
    listDetachableFieldNames
};
