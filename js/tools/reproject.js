/**
 * Layer reprojection wrapper — browser proj4 path.
 */
import { reprojectDataset } from '../crs/reproject.js';
import { getLayerCrs } from '../crs/layer-crs.js';
import { normalizeCrsCode } from '../crs/registry.js';

/**
 * @param {object} dataset
 * @param {{ fromCrs?: string, toCrs?: string, name?: string }} options
 */
export async function reprojectLayer(dataset, options = {}) {
    const fromCrs = normalizeCrsCode(options.fromCrs || getLayerCrs(dataset));
    const toCrs = normalizeCrsCode(options.toCrs || 'EPSG:4326');

    return reprojectDataset(dataset, {
        fromCrs,
        toCrs,
        name: options.name
    });
}
