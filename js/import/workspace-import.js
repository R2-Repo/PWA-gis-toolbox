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
    updateWorkspaceLayerMeta,
    WORKSPACE_CHUNK_SIZE,
    WORKSPACE_FEATURE_THRESHOLD
} from '../workspace/workspace-store.js';
import { createSpatialChunkWriter } from '../workspace/spatial-chunk-writer.js';
import { buildDatasetProfileFromFeatures } from './dataset-profile.js';

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
    const schema = dataset.schema || analyzeSchema(dataset.geojson);
    const datasetProfile = buildDatasetProfileFromFeatures(features, {
        importMethod: dataset.source?.importMethod || 'standard',
        format: dataset.source?.format || 'unknown',
        fileSize: dataset.source?.fileSize,
        fieldCount: Array.isArray(schema?.fields) ? schema.fields.length : null
    });
    try {
        await createWorkspaceLayer({
            id: layerId,
            name: dataset.name,
            source: dataset.source,
            schema,
            datasetProfile
        });

        const selectedFields = dataset.source?.importSelectedFields || null;
        const filter = shouldFilterFields(selectedFields) ? selectedFields : null;
        const writer = createSpatialChunkWriter({
            chunkSize: WORKSPACE_CHUNK_SIZE,
            onFlush: async (batch, startIndex) => {
                await appendWorkspaceBatch(layerId, batch, startIndex, filter);
            }
        });
        for (const feature of features) {
            await writer.add(feature);
        }
        await writer.flush();
        await flushSpatialIndexSave();
        await updateWorkspaceLayerMeta(layerId, {
            schema: { ...schema, featureCount: features.length },
            datasetProfile
        });
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
        datasetProfile,
        schema: {
            ...schema,
            featureCount: features.length
        }
    };
}

export { WORKSPACE_FEATURE_THRESHOLD };

export default { convertSpatialDatasetToWorkspace, WORKSPACE_FEATURE_THRESHOLD };
