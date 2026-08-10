/**
 * Spatial workspace chunk writer — buckets features into coarse grid cells
 * during import so IndexedDB chunks have tight bboxes (Build 11).
 *
 * Feature indices remain sequential (0..N-1) across flushes. Open cell buffers
 * are LRU-capped so peak memory stays bounded.
 */

/** Match workspace-store WORKSPACE_CHUNK_SIZE (avoid importing that module). */
export const SPATIAL_CHUNK_FLUSH_SIZE = 1000;

/** Coarser than the query grid (0.5°) — fewer open buffers, still local chunks. */
export const SPATIAL_CHUNK_CELL_SIZE_DEG = 1;

/** Max cell buffers held in memory before the oldest is flushed. */
export const SPATIAL_CHUNK_MAX_OPEN_CELLS = 32;

export const NULL_GEOMETRY_CELL_KEY = '__null__';

/**
 * Representative lon/lat for bucketing (first coordinate / ring origin).
 * @param {object|null|undefined} feature
 * @returns {[number, number]|null}
 */
export function featureRepresentativePoint(feature) {
    const geometry = feature?.geometry;
    if (!geometry?.coordinates) return null;
    const { type, coordinates: coords } = geometry;
    if (!type || coords == null) return null;

    switch (type) {
        case 'Point':
            return Number.isFinite(coords[0]) && Number.isFinite(coords[1])
                ? [coords[0], coords[1]]
                : null;
        case 'MultiPoint':
        case 'LineString':
            return _firstPair(coords);
        case 'MultiLineString':
        case 'Polygon':
            return _firstPair(coords?.[0]);
        case 'MultiPolygon':
            return _firstPair(coords?.[0]?.[0]);
        case 'GeometryCollection':
            for (const g of geometry.geometries || []) {
                const pt = featureRepresentativePoint({ geometry: g });
                if (pt) return pt;
            }
            return null;
        default:
            return null;
    }
}

function _firstPair(coords) {
    if (!coords?.length) return null;
    if (typeof coords[0] === 'number') {
        return Number.isFinite(coords[0]) && Number.isFinite(coords[1])
            ? [coords[0], coords[1]]
            : null;
    }
    return _firstPair(coords[0]);
}

/**
 * @param {number} lon
 * @param {number} lat
 * @param {number} cellSizeDeg
 * @returns {string}
 */
export function spatialCellKey(lon, lat, cellSizeDeg = SPATIAL_CHUNK_CELL_SIZE_DEG) {
    const size = cellSizeDeg > 0 ? cellSizeDeg : SPATIAL_CHUNK_CELL_SIZE_DEG;
    return `${Math.floor(lon / size)},${Math.floor(lat / size)}`;
}

/**
 * @param {object} feature
 * @param {number} [cellSizeDeg]
 * @returns {string}
 */
export function featureSpatialCellKey(feature, cellSizeDeg = SPATIAL_CHUNK_CELL_SIZE_DEG) {
    const pt = featureRepresentativePoint(feature);
    if (!pt) return NULL_GEOMETRY_CELL_KEY;
    return spatialCellKey(pt[0], pt[1], cellSizeDeg);
}

/**
 * @param {{
 *   chunkSize?: number,
 *   cellSizeDeg?: number,
 *   maxOpenCells?: number,
 *   initialIndex?: number,
 *   onFlush: (features: object[], startIndex: number) => Promise<void>|void
 * }} options
 */
export function createSpatialChunkWriter(options) {
    const chunkSize = options.chunkSize ?? SPATIAL_CHUNK_FLUSH_SIZE;
    const cellSizeDeg = options.cellSizeDeg ?? SPATIAL_CHUNK_CELL_SIZE_DEG;
    const maxOpenCells = options.maxOpenCells ?? SPATIAL_CHUNK_MAX_OPEN_CELLS;
    const onFlush = options.onFlush;
    if (typeof onFlush !== 'function') {
        throw new Error('createSpatialChunkWriter requires onFlush');
    }

    /** @type {Map<string, object[]>} */
    const cells = new Map();
    /** @type {string[]} least-recent → most-recent */
    const lru = [];
    let nextIndex = Math.max(0, Number(options.initialIndex) || 0);
    let buffered = 0;

    function touch(key) {
        const i = lru.indexOf(key);
        if (i >= 0) lru.splice(i, 1);
        lru.push(key);
    }

    function dropLru(key) {
        const i = lru.indexOf(key);
        if (i >= 0) lru.splice(i, 1);
    }

    async function flushKey(key) {
        const buf = cells.get(key);
        if (!buf?.length) {
            cells.delete(key);
            dropLru(key);
            return 0;
        }
        cells.delete(key);
        dropLru(key);
        const batch = buf.splice(0, buf.length);
        buffered -= batch.length;
        const startIndex = nextIndex;
        nextIndex += batch.length;
        await onFlush(batch, startIndex);
        return batch.length;
    }

    async function evictIfNeeded() {
        while (cells.size > maxOpenCells) {
            const oldest = lru[0];
            if (!oldest) break;
            await flushKey(oldest);
        }
    }

    return {
        get writtenCount() {
            return nextIndex;
        },
        get bufferedCount() {
            return buffered;
        },
        get featureCount() {
            return nextIndex + buffered;
        },
        get openCellCount() {
            return cells.size;
        },
        get cellSizeDeg() {
            return cellSizeDeg;
        },

        /**
         * @param {object} feature
         */
        async add(feature) {
            const key = featureSpatialCellKey(feature, cellSizeDeg);
            let buf = cells.get(key);
            if (!buf) {
                buf = [];
                cells.set(key, buf);
            }
            buf.push(feature);
            buffered += 1;
            touch(key);

            if (buf.length >= chunkSize) {
                await flushKey(key);
            } else {
                await evictIfNeeded();
            }
        },

        /** Flush every open cell buffer. */
        async flush() {
            const keys = [...cells.keys()];
            for (const key of keys) {
                await flushKey(key);
            }
        }
    };
}

export default {
    SPATIAL_CHUNK_FLUSH_SIZE,
    SPATIAL_CHUNK_CELL_SIZE_DEG,
    SPATIAL_CHUNK_MAX_OPEN_CELLS,
    NULL_GEOMETRY_CELL_KEY,
    featureRepresentativePoint,
    spatialCellKey,
    featureSpatialCellKey,
    createSpatialChunkWriter
};
