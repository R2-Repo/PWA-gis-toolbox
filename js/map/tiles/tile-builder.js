/**
 * Encode a set of GeoJSON features into one MVT tile using geojson-vt
 * (clipping + simplification) and vt-pbf (encoding). Pure module.
 */
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { polygonLabelAnchorFeatures, POLYGON_LABEL_ANCHOR_LAYER } from '../polygon-label-anchors.js';
import {
    TILE_EXTENT,
    TILE_BUFFER,
    TILE_SOURCE_LAYER,
    TILE_SIMPLIFY_TOLERANCE,
    HIGH_DETAIL_SIMPLIFY_ZOOM
} from './tile-constants.js';

export { TILE_SOURCE_LAYER, POLYGON_LABEL_ANCHOR_LAYER };

/**
 * @param {number} z
 * @returns {number}
 */
export function simplifyToleranceForZoom(z) {
    return z >= HIGH_DETAIL_SIMPLIFY_ZOOM ? 0 : TILE_SIMPLIFY_TOLERANCE;
}

/**
 * @param {object[]} features GeoJSON features (already selected for this tile)
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {{ tolerance?: number }} [opts]
 * @returns {Uint8Array|null} MVT bytes, or null when the tile is empty
 */
export function buildTileFromFeatures(features, z, x, y, opts = {}) {
    if (!features?.length) return null;

    const index = geojsonvt(
        { type: 'FeatureCollection', features },
        {
            maxZoom: Math.min(Math.max(z, 0), 24),
            indexMaxZoom: 0,
            indexMaxPoints: 0,
            tolerance: opts.tolerance ?? simplifyToleranceForZoom(z),
            extent: TILE_EXTENT,
            buffer: TILE_BUFFER
        }
    );

    const tile = index.getTile(z, x, y);
    if (!tile || !tile.features?.length) return null;

    const layers = { [TILE_SOURCE_LAYER]: tile };
    const anchors = polygonLabelAnchorFeatures(features);
    if (anchors.length) {
        const anchorIndex = geojsonvt(
            { type: 'FeatureCollection', features: anchors },
            {
                maxZoom: Math.min(Math.max(z, 0), 24),
                indexMaxZoom: 0,
                indexMaxPoints: 0,
                tolerance: 0,
                extent: TILE_EXTENT,
                buffer: 0
            }
        );
        const anchorTile = anchorIndex.getTile(z, x, y);
        if (anchorTile?.features?.length) layers[POLYGON_LABEL_ANCHOR_LAYER] = anchorTile;
    }

    return vtpbf.fromGeojsonVt(layers, { version: 2 });
}

export default { buildTileFromFeatures, TILE_SOURCE_LAYER, simplifyToleranceForZoom };
