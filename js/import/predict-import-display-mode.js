/**
 * Predict Memory / Viewport / Tiled display mode before import completes.
 * Mirrors workspace + tile thresholds used after layers land on the map.
 */
import { WORKSPACE_FEATURE_THRESHOLD } from '../workspace/workspace-store.js';
import { TILED_RENDER_THRESHOLD } from '../map/tiles/tile-constants.js';

/**
 * @param {{
 *   featureEstimate?: number|null,
 *   coordinateEstimate?: number|null,
 *   forceWorkspace?: boolean
 * }} [input]
 * @returns {'memory'|'viewport'|'tiled'|null}
 */
export function predictImportDisplayMode(input = {}) {
    const features = Number.isFinite(input.featureEstimate)
        ? Math.max(0, Math.round(input.featureEstimate))
        : null;
    const coords = Number.isFinite(input.coordinateEstimate)
        ? Math.max(0, Math.round(input.coordinateEstimate))
        : null;

    if (features == null && input.forceWorkspace !== true) return null;

    const count = features ?? 0;
    const avgCoords = count > 0 && coords != null ? coords / count : null;
    const useWorkspace = input.forceWorkspace === true
        || (features != null && features >= WORKSPACE_FEATURE_THRESHOLD);

    if (!useWorkspace) return 'memory';
    // Workspace path, but feature count still unknown — wait for estimate.
    if (features == null) return null;

    if (count >= TILED_RENDER_THRESHOLD) return 'tiled';
    if (coords != null && coords >= 2_000_000) return 'tiled';
    if (count >= 15_000 && avgCoords != null && avgCoords >= 40) return 'tiled';

    return 'viewport';
}

export default { predictImportDisplayMode };
