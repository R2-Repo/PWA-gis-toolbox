/**
 * Human-facing display-mode copy for workspace-backed layers.
 * Map drawing mode ≠ import completeness — full data stays in IndexedDB.
 */
import { isWorkspaceLayer, getLayerFeatureCount } from '../core/data-model.js';
import { TILED_RENDER_THRESHOLD } from './tiles/tile-constants.js';
import { RENDER_LIMITS } from './render-limits.js';
import { profileSuggestsTiledDisplay } from '../import/dataset-profile.js';

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
        || (mapEntry == null && profileSuggestsTiledDisplay(layer, featureCount, TILED_RENDER_THRESHOLD));

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
                'Nothing was left out during import — at far zoom, dense tiles may thin some features so the map stays fast.',
                'Zoom in for denser local detail; tiles prefer geometry that actually falls in the current view.',
                'While tiles are building, squares nearer the center of the screen are preferred over the edges.',
                'Export still includes the full layer.',
                'Click, identify, and box-select work from the full workspace store; cyan highlights load selected geometries on demand.'
            ],
            featureCount
        };
    }

    const truncated = layer?._viewportTruncated === true || mapEntry?.truncated === true;
    return {
        mode: 'viewport',
        badge: 'VIEWPORT',
        shortLabel: 'Viewport draw',
        toastMessage: truncated
            ? 'This view is capped for speed — zoom in for denser detail. See the VIEWPORT badge.'
            : 'This layer is optimized for large data. See the VIEWPORT badge for details.',
        title: 'Viewport display',
        summary: truncated
            ? 'The full layer is stored on this device. The current map view hit the draw cap, so some features in view are thinned — zoom in for denser detail.'
            : 'The full layer is stored on this device. The map draws features that intersect the current view (up to a render cap), then updates as you pan and zoom.',
        details: [
            `About ${featureCount.toLocaleString()} features are stored in workspace (IndexedDB).`,
            `The map shows up to about ${RENDER_LIMITS.maxFeaturesPerSource.toLocaleString()} features that intersect the current view at a time.`,
            'When the view is dense, features near the center of the screen are drawn before features near the edges, with even spatial sampling inside that cap.',
            'Features outside the view are still in the layer — they appear when you move the map.',
            'Very dense views may still omit some intersecting features so the map stays fast; zoom in further or export for the complete set.',
            'Click, identify, and box-select work from the full workspace store; cyan highlights load selected geometries on demand.',
            'Export still includes the full layer.'
        ],
        featureCount,
        truncated
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
