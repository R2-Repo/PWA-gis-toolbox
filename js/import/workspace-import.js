/**
 * Convert in-memory spatial datasets to IndexedDB workspace storage.
 */
import { analyzeSchema } from '../core/data-model.js';
import { shouldFilterFields } from './import-field-filter.js';
import {
    createWorkspaceLayer,
    appendWorkspaceBatch,
    removeWorkspaceLayer,
    flushSpatialIndexSave,
    WORKSPACE_CHUNK_SIZE,
    WORKSPACE_FEATURE_THRESHOLD
} from '../workspace/workspace-store.js';

/**
 * @param {object} dataset spatial dataset with geojson
 * @returns {Promise<object>} spatial-chunked layer ref
 */
export async function convertSpatialDatasetToWorkspace(dataset) {
    if (dataset.type !== 'spatial' || !dataset.geojson?.features?.length) {
        return dataset;
    }

    const features = dataset.geojson.features;
    if (features.length < WORKSPACE_FEATURE_THRESHOLD && dataset.storage !== 'workspace') {
        return dataset;
    }

    const layerId = dataset.id;
    try {
        await createWorkspaceLayer({
            id: layerId,
            name: dataset.name,
            source: dataset.source,
            schema: dataset.schema || analyzeSchema(dataset.geojson)
        });

        const selectedFields = dataset.source?.importSelectedFields || null;

        for (let i = 0; i < features.length; i += WORKSPACE_CHUNK_SIZE) {
            const batch = features.slice(i, i + WORKSPACE_CHUNK_SIZE);
            await appendWorkspaceBatch(
                layerId,
                batch,
                i,
                shouldFilterFields(selectedFields) ? selectedFields : null
            );
        }

        await flushSpatialIndexSave();
    } catch (err) {
        try {
            await removeWorkspaceLayer(layerId);
        } catch { /* best effort rollback */ }
        throw err;
    }

    return {
        ...dataset,
        type: 'spatial-chunked',
        storage: 'workspace',
        workspaceLayerId: layerId,
        geojson: { type: 'FeatureCollection', features: [] },
        _viewportCache: true,
        schema: {
            ...(dataset.schema || analyzeSchema(dataset.geojson)),
            featureCount: features.length
        }
    };
}

export { WORKSPACE_FEATURE_THRESHOLD };

export default { convertSpatialDatasetToWorkspace, WORKSPACE_FEATURE_THRESHOLD };
