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
export const TILE_CHUNK_CACHE_SIZE = 128;

/** Max workspace chunks loaded for a single tile at overview zooms. */
export const MAX_CHUNKS_PER_TILE = 64;

/**
 * At/above this zoom, scan many more chunks and skip feature-mass early-stop.
 * Close zooms often hit hundreds of statewide long-line chunk bboxes; the few
 * local lines can sit past the overview budget.
 */
export const HIGH_ZOOM_CHUNK_SCAN_ZOOM = 12;

/** Max chunks to load per tile at {@link HIGH_ZOOM_CHUNK_SCAN_ZOOM}+ (soft budget). */
export const MAX_CHUNKS_PER_TILE_HIGH_ZOOM = 512;

/**
 * After the soft high-zoom chunk budget, keep scanning while in-tile candidates
 * stay below this floor — statewide long-line chunk bboxes often fill the soft
 * budget with zero-yield chunks before the real crossing lines are reached.
 */
export const HIGH_ZOOM_SPARSE_CANDIDATE_FLOOR = 64;

/**
 * Absolute ceiling on chunks loaded per tile at close zoom (pathological
 * statewide index fan-out). Prefer exhausting ranked chunks when under the
 * sparse floor, but never unbounded.
 */
export const MAX_CHUNKS_PER_TILE_HIGH_ZOOM_HARD = 4096;

/** geojson-vt simplification tolerance below high-detail zoom. */
export const TILE_SIMPLIFY_TOLERANCE = 3;

/** geojson-vt tolerance at/above this zoom (keep short segments). */
export const HIGH_DETAIL_SIMPLIFY_ZOOM = 14;

export default {
    TILED_RENDER_THRESHOLD,
    GIS_TILE_PROTOCOL,
    TILE_EXTENT,
    TILE_BUFFER,
    TILE_SOURCE_MAX_ZOOM,
    MAX_TILE_FEATURES,
    MIN_FEATURE_PIXELS,
    TILE_CHUNK_CACHE_SIZE,
    MAX_CHUNKS_PER_TILE,
    HIGH_ZOOM_CHUNK_SCAN_ZOOM,
    MAX_CHUNKS_PER_TILE_HIGH_ZOOM,
    HIGH_ZOOM_SPARSE_CANDIDATE_FLOOR,
    MAX_CHUNKS_PER_TILE_HIGH_ZOOM_HARD,
    TILE_SIMPLIFY_TOLERANCE,
    HIGH_DETAIL_SIMPLIFY_ZOOM
};
