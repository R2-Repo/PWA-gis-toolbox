/**
 * GPX exporter — GeoJSON to GPX via togpx.
 * GPX is lossy: styling is dropped and polygons may become track outlines.
 */
import { loadToGpx } from '../core/libs.js';
import { isWorkspaceLayer, getLayerFeatureCount } from '../core/data-model.js';
import { materializeWorkspaceGeoJSON } from './stream-export-service.js';
import { MAX_MATERIALIZE_FEATURES } from '../tools/gis-layer-context.js';

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
    // Fallback for direct callers — exporter.js normally materializes first.
    if (isWorkspaceLayer(dataset) && !dataset._workspaceMaterialized) {
        const full = await materializeWorkspaceGeoJSON(dataset, task);
        return {
            type: 'FeatureCollection',
            features: full.features.map((feature) => _mapFeatureForExport(feature))
        };
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
