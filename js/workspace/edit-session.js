/**
 * Edit sessions for workspace-backed (heavy) layers — load a selection,
 * mutate attributes, write back to IndexedDB, invalidate map tiles/viewport.
 */
import {
    getWorkspaceLayer,
    getWorkspaceFeatureAttributes,
    getWorkspaceFeatureRecord,
    updateWorkspaceFeatureAttributes,
    updateWorkspaceFeatureAttributesBatch
} from './workspace-store.js';
import { coercePropertyValue } from '../widgets/bulk-update/engine.js';
import { LGID_PROP } from './feature-identity.js';

/**
 * @param {string} layerId
 * @param {number[]} featureIndices
 * @returns {Promise<{ layerId: string, features: object[], byIndex: Map<number, object> }>}
 */
export async function loadEditSession(layerId, featureIndices = []) {
    const meta = await getWorkspaceLayer(layerId);
    if (!meta) throw new Error('Workspace layer not found.');

    const indices = [...new Set(
        (featureIndices || []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0)
    )];

    const features = [];
    const byIndex = new Map();
    for (const featureIndex of indices) {
        const record = await getWorkspaceFeatureRecord(layerId, featureIndex);
        const properties = record?.properties || await getWorkspaceFeatureAttributes(layerId, featureIndex) || {};
        const feature = {
            type: 'Feature',
            geometry: null,
            properties: {
                ...properties,
                _featureIndex: featureIndex,
                _datasetId: layerId,
                ...(record?.lgid ? { [LGID_PROP]: record.lgid } : {})
            }
        };
        features.push(feature);
        byIndex.set(featureIndex, feature);
    }

    return { layerId, featureCount: meta.featureCount || 0, features, byIndex };
}

/**
 * Apply field updates to selected workspace features (attribute writeback).
 * @param {object} params
 * @param {string} params.layerId
 * @param {number[]} [params.selectedIndices]
 * @param {boolean} [params.applyToAll] when true, update every feature 0..featureCount-1
 * @param {Array<{ field: string, value: any }>} params.updates
 * @returns {Promise<{ updatedCount: number, fieldCount: number }>}
 */
export async function commitWorkspaceBulkUpdate({
    layerId,
    selectedIndices = [],
    applyToAll = false,
    updates = []
} = {}) {
    const safeUpdates = (updates || []).filter((entry) => entry?.field);
    if (!safeUpdates.length) throw new Error('Add at least one field update.');

    const patch = {};
    for (const entry of safeUpdates) {
        patch[entry.field] = coercePropertyValue(entry.value);
    }

    if (applyToAll) {
        const meta = await getWorkspaceLayer(layerId);
        const count = meta?.featureCount || 0;
        if (!count) throw new Error('No selected features found for this layer.');
        let updatedCount = 0;
        const batchSize = 500;
        for (let start = 0; start < count; start += batchSize) {
            const end = Math.min(count, start + batchSize);
            const edits = [];
            for (let i = start; i < end; i++) edits.push({ featureIndex: i, patch });
            updatedCount += await updateWorkspaceFeatureAttributesBatch(layerId, edits);
        }
        return { updatedCount, fieldCount: safeUpdates.length };
    }

    if (!selectedIndices.length) throw new Error('No selected features found for this layer.');
    const edits = selectedIndices.map((featureIndex) => ({ featureIndex, patch }));
    const updatedCount = await updateWorkspaceFeatureAttributesBatch(layerId, edits);
    return { updatedCount, fieldCount: safeUpdates.length };
}

/**
 * Commit a single-feature attribute edit.
 * @param {string} layerId
 * @param {number} featureIndex
 * @param {object} properties full replacement of hot user properties (plus retained lgid)
 */
export async function commitWorkspaceFeatureEdit(layerId, featureIndex, properties) {
    await updateWorkspaceFeatureAttributes(layerId, featureIndex, properties);
    return { updatedCount: 1 };
}

export default {
    loadEditSession,
    commitWorkspaceBulkUpdate,
    commitWorkspaceFeatureEdit
};
