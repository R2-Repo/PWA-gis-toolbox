/**
 * Local vector-tile rendering constants (dependency-free; shared with worker).
 */

/** Workspace layers at/above this feature count render as local vector tiles. */
export const TILED_RENDER_THRESHOLD = 50_000;

/** MapLibre protocol scheme for locally generated tiles. */
export const GIS_TILE_PROTOCOL = 'gis-tiles';

/** MVT grid extent (standard). */
export const TILE_EXTENT = 4096;

/** Tile clip buffer in extent units (standard 64/4096). */
export const TILE_BUFFER = 64;

/** Tiles are generated up to this zoom; MapLibre overzooms beyond it. */
export const TILE_SOURCE_MAX_ZOOM = 16;

/** Hard cap of features encoded into one tile. */
export const MAX_TILE_FEATURES = 20_000;

/** Drop non-point features smaller than this many screen pixels at a zoom. */
export const MIN_FEATURE_PIXELS = 0.75;

/** Source-layer name inside generated tiles. */
export const TILE_SOURCE_LAYER = 'features';

/** Parsed workspace chunks kept in the tile worker's LRU cache. */
export const TILE_CHUNK_CACHE_SIZE = 48;

/** Max workspace chunks loaded for a single tile (chunk-level sampling above). */
export const MAX_CHUNKS_PER_TILE = 64;

export default {
    TILED_RENDER_THRESHOLD,
    GIS_TILE_PROTOCOL,
    TILE_EXTENT,
    TILE_BUFFER,
    TILE_SOURCE_MAX_ZOOM,
    MAX_TILE_FEATURES,
    MIN_FEATURE_PIXELS,
    TILE_CHUNK_CACHE_SIZE,
    MAX_CHUNKS_PER_TILE
};
