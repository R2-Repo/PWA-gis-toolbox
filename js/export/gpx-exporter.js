/**
 * GPX exporter — GeoJSON to GPX via togpx.
 * GPX is lossy: styling is dropped and polygons may become track outlines.
 */
import { loadToGpx } from '../core/libs.js';
import { isWorkspaceLayer, getLayerFeatureCount } from '../core/data-model.js';
import { iterateWorkspaceFeatures } from '../workspace/workspace-store.js';
import { MAX_MATERIALIZE_FEATURES } from '../tools/gis-layer-context.js';

const EXPORT_BATCH_SIZE = 500;

function _cleanFeatureProperties(properties = {}) {
    return Object.fromEntries(
        Object.entries(properties).filter(([k]) => !k.startsWith('_'))
    );
}

function _mapFeatureForExport(feature) {
    return {
        ...feature,
        properties: _cleanFeatureProperties(feature.properties || {})
    };
}

async function _collectFeatureCollection(dataset, task) {
    if (isWorkspaceLayer(dataset)) {
        const layerId = dataset.workspaceLayerId || dataset.id;
        const features = [];
        let offset = 0;

        while (true) {
            const batch = await iterateWorkspaceFeatures(layerId, offset, EXPORT_BATCH_SIZE);
            if (!batch.length) break;
            for (const feature of batch) {
                features.push(_mapFeatureForExport(feature));
            }
            offset += batch.length;
            task?.updateProgress(
                20 + Math.min(40, Math.round((offset / Math.max(offset + 1000, 1)) * 40)),
                `Preparing… ${features.length.toLocaleString()} features`
            );
            if (batch.length < EXPORT_BATCH_SIZE) break;
        }

        return { type: 'FeatureCollection', features };
    }

    const source = dataset.geojson || { type: 'FeatureCollection', features: [] };
    return {
        type: 'FeatureCollection',
        features: (source.features || []).map((feature) => _mapFeatureForExport(feature))
    };
}

export async function exportGPX(dataset, options = {}, task) {
    if (isWorkspaceLayer(dataset) && getLayerFeatureCount(dataset) > MAX_MATERIALIZE_FEATURES) {
        throw new Error(
            `GPX export is limited to ${MAX_MATERIALIZE_FEATURES.toLocaleString()} features. `
            + 'Use GeoJSON or CSV for larger workspace layers.'
        );
    }
    task?.updateProgress(20, 'Preparing features...');
    const geojson = await _collectFeatureCollection(dataset, task);

    task?.updateProgress(60, 'Generating GPX...');
    const togpx = await loadToGpx();
    if (typeof togpx !== 'function') {
        throw new Error('togpx library not loaded');
    }

    const text = togpx(geojson, {
        creator: 'GIS Toolbox',
        metadata: options.metadata
    });

    task?.updateProgress(90, 'Done');
    return { text, mimeType: 'application/gpx+xml' };
}

export default { exportGPX };
