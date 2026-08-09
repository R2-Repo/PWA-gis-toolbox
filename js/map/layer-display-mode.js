/**
 * Human-facing display-mode copy for workspace-backed layers.
 * Map drawing mode ≠ import completeness — full data stays in IndexedDB.
 */
import { isWorkspaceLayer, getLayerFeatureCount } from '../core/data-model.js';
import { TILED_RENDER_THRESHOLD } from './tiles/tile-constants.js';
import { RENDER_LIMITS } from './render-limits.js';

/** @typedef {'memory'|'viewport'|'tiled'} LayerDisplayModeId */

/**
 * @param {object|null|undefined} layer
 * @param {{ tiled?: boolean }|null|undefined} mapEntry
 * @returns {{
 *   mode: LayerDisplayModeId,
 *   badge: string,
 *   shortLabel: string,
 *   toastMessage: string,
 *   title: string,
 *   summary: string,
 *   details: string[],
 *   featureCount: number
 * }|null}
 */
export function resolveLayerDisplayMode(layer, mapEntry = null) {
    if (!layer || !isWorkspaceLayer(layer)) return null;

    const featureCount = getLayerFeatureCount(layer);
    const tiled = mapEntry?.tiled === true
        || (mapEntry == null && featureCount >= TILED_RENDER_THRESHOLD);

    if (tiled) {
        return {
            mode: 'tiled',
            badge: 'TILED',
            shortLabel: 'Optimized tiles',
            toastMessage: 'This layer uses optimized map tiles. See the TILED badge for details.',
            title: 'Optimized tile display',
            summary: 'The full layer is stored on this device. The map draws it with local vector tiles so the whole layer stays visible without loading every feature into memory.',
            details: [
                `About ${featureCount.toLocaleString()} features are stored in workspace (IndexedDB).`,
                'Nothing was left out during import — display thinning can hide some lines at far zoom so the map stays fast.',
                'Zoom in to see denser detail. Export still includes the full layer.',
                'Click or identify still works; selection highlights on tiled layers are limited.'
            ],
            featureCount
        };
    }

    return {
        mode: 'viewport',
        badge: 'VIEWPORT',
        shortLabel: 'Viewport draw',
        toastMessage: 'This layer is optimized for large data. See the VIEWPORT badge for details.',
        title: 'Viewport display',
            summary: 'The full layer is stored on this device. The map draws features that intersect the current view (up to a render cap), then updates as you pan and zoom.',
            details: [
                `About ${featureCount.toLocaleString()} features are stored in workspace (IndexedDB).`,
                `The map shows up to about ${RENDER_LIMITS.maxFeaturesPerSource.toLocaleString()} features that intersect the current view at a time.`,
                'Features outside the view are still in the layer — they appear when you move the map.',
                'Very dense views may still omit some intersecting features so the map stays fast; zoom in further or export for the complete set.',
                'Export still includes the full layer.'
            ],
        featureCount
    };
}

/**
 * @param {object|null|undefined} layer
 * @param {{ tiled?: boolean }|null|undefined} mapEntry
 * @returns {boolean}
 */
export function layerHasDisplayModeBadge(layer, mapEntry = null) {
    return !!resolveLayerDisplayMode(layer, mapEntry);
}

export default {
    resolveLayerDisplayMode,
    layerHasDisplayModeBadge
};
