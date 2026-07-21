/**
 * Shared full-layer download for UDOT Fiber Network (PWA import + desktop sync).
 */
import { ArcGISRestImporter } from '../../arcgis/rest-importer.js';
import { UDOT_FIBER_LAYERS, layerUrl } from './constants.js';

/**
 * @param {string|number} layerId
 * @param {{ onProgress?: (p: object) => void, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ layerKey: string, layerId: number, name: string, geojson: object, featureCount: number }>}
 */
export async function downloadUdotFiberLayer(layerId, opts = {}) {
    const meta = UDOT_FIBER_LAYERS.find((l) => l.id === Number(layerId));
    if (!meta) throw new Error(`Unknown UDOT Fiber layer id: ${layerId}`);

    const importer = new ArcGISRestImporter();
    const url = layerUrl(meta.id);
    await importer.fetchMetadata(url);

    // In-memory GeoJSON for SQLite sync / style bake (not workspace streaming).
    const dataset = await importer.downloadFeatures({
        useWorkspace: false,
        allowLargeDownload: true,
        returnGeometry: true
    });

    const geojson = dataset?.geojson || {
        type: 'FeatureCollection',
        features: []
    };

    opts.onProgress?.({
        stage: 'downloaded',
        layerKey: meta.key,
        featureCount: geojson.features?.length || 0
    });

    return {
        layerKey: meta.key,
        layerId: meta.id,
        name: meta.name,
        geojson: {
            type: 'FeatureCollection',
            features: geojson.features || []
        },
        featureCount: geojson.features?.length || 0
    };
}

/**
 * @param {{ onProgress?: (p: object) => void, signal?: AbortSignal, layerKeys?: string[] }} [opts]
 */
export async function downloadAllUdotFiberLayers(opts = {}) {
    const keys = opts.layerKeys || UDOT_FIBER_LAYERS.map((l) => l.key);
    const layers = [];
    for (const key of keys) {
        const meta = UDOT_FIBER_LAYERS.find((l) => l.key === key);
        if (!meta) continue;
        opts.onProgress?.({ stage: 'layer', layerKey: key, name: meta.name });
        // eslint-disable-next-line no-await-in-loop
        const layer = await downloadUdotFiberLayer(meta.id, opts);
        layers.push(layer);
    }
    return layers;
}
