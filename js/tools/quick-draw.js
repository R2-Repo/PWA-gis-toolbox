/**
 * Quick Draw — one-tap shortcut to draw points on a dedicated layer.
 */
import { getLayers } from '../core/state.js';
import { createSpatialDataset } from '../core/data-model.js';

export const QUICK_DRAW_LAYER_NAME = 'Quick Draw';

/**
 * @param {object[]|null|undefined} [layers]
 * @returns {object|null}
 */
export function findQuickDrawLayer(layers = getLayers()) {
    return layers.find((layer) => layer._isQuickDrawLayer === true) ?? null;
}

/**
 * @param {object} layer
 */
export function clearQuickDrawLayerFlag(layer) {
    if (layer?._isQuickDrawLayer) {
        delete layer._isQuickDrawLayer;
    }
}

/**
 * @returns {object}
 */
export function createQuickDrawLayer() {
    const geojson = { type: 'FeatureCollection', features: [] };
    const dataset = createSpatialDataset(QUICK_DRAW_LAYER_NAME, geojson, { format: 'draw' });
    dataset._isDrawLayer = true;
    dataset._isQuickDrawLayer = true;
    return dataset;
}
