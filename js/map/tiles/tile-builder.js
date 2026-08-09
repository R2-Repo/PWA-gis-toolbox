/**
 * Encode a set of GeoJSON features into one MVT tile using geojson-vt
 * (clipping + simplification) and vt-pbf (encoding). Pure module.
 */
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { TILE_EXTENT, TILE_BUFFER, TILE_SOURCE_LAYER } from './tile-constants.js';

export { TILE_SOURCE_LAYER };

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
            tolerance: opts.tolerance ?? 3,
            extent: TILE_EXTENT,
            buffer: TILE_BUFFER
        }
    );

    const tile = index.getTile(z, x, y);
    if (!tile || !tile.features?.length) return null;

    return vtpbf.fromGeojsonVt({ [TILE_SOURCE_LAYER]: tile }, { version: 2 });
}

export default { buildTileFromFeatures, TILE_SOURCE_LAYER };
