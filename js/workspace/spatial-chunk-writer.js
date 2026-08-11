/**
 * Spatial workspace chunk writer — buckets features into coarse grid cells
 * during import so IndexedDB chunks have tight bboxes (Build 11).
 *
 * Line/polygon features are placed into **every** cell they touch (not only the
 * first-vertex cell). That keeps chunk bboxes local so close-zoom tile queries
 * do not fan out across thousands of statewide long-line chunks.
 *
 * Logical feature indices stay unique across multi-cell copies (`__featureIndex`
 * on the in-memory feature; persisted as `_featureIndex` in appendWorkspaceBatch).
 * Open cell buffers are LRU-capped so peak memory stays bounded.
 */

/** Match workspace-store WORKSPACE_CHUNK_SIZE (avoid importing that module). */
export const SPATIAL_CHUNK_FLUSH_SIZE = 1000;

/** Coarser than the query grid (0.5°) — fewer open buffers, still local chunks. */
export const SPATIAL_CHUNK_CELL_SIZE_DEG = 1;

/** Max cell buffers held in memory before the oldest is flushed. */
export const SPATIAL_CHUNK_MAX_OPEN_CELLS = 32;

/**
 * Cap cells registered per feature. Beyond this, envelope is covered with a
 * stride so import storage cannot explode on continental geometries.
 */
export const SPATIAL_CHUNK_MAX_CELLS_PER_FEATURE = 64;

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
 * Walk lon/lat segment and add every grid cell the segment crosses.
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} cellSizeDeg
 * @param {Set<string>} out
 */
function _addSegmentCells(x0, y0, x1, y1, cellSizeDeg, out) {
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    out.add(spatialCellKey(x0, y0, cellSizeDeg));
    out.add(spatialCellKey(x1, y1, cellSizeDeg));

    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(
        1,
        Math.ceil(Math.abs(dx) / cellSizeDeg),
        Math.ceil(Math.abs(dy) / cellSizeDeg)
    );
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        out.add(spatialCellKey(x0 + dx * t, y0 + dy * t, cellSizeDeg));
    }
}

/**
 * @param {number[][]} line
 * @param {number} cellSizeDeg
 * @param {Set<string>} out
 */
function _addLineCells(line, cellSizeDeg, out) {
    if (!line?.length) return;
    for (let i = 0; i < line.length; i++) {
        const p = line[i];
        if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        out.add(spatialCellKey(p[0], p[1], cellSizeDeg));
        if (i > 0) {
            const prev = line[i - 1];
            if (prev && Number.isFinite(prev[0]) && Number.isFinite(prev[1])) {
                _addSegmentCells(prev[0], prev[1], p[0], p[1], cellSizeDeg, out);
            }
        }
    }
}

/**
 * Cover an envelope with cell keys; stride when the grid is larger than maxCells.
 * @param {[number,number,number,number]} bbox
 * @param {number} cellSizeDeg
 * @param {number} maxCells
 * @param {Set<string>} out
 */
function _addEnvelopeCells(bbox, cellSizeDeg, maxCells, out) {
    const [w, s, e, n] = bbox;
    if (![w, s, e, n].every(Number.isFinite)) return;
    const x0 = Math.floor(w / cellSizeDeg);
    const x1 = Math.floor(e / cellSizeDeg);
    const y0 = Math.floor(s / cellSizeDeg);
    const y1 = Math.floor(n / cellSizeDeg);
    const width = Math.max(1, x1 - x0 + 1);
    const height = Math.max(1, y1 - y0 + 1);
    const total = width * height;
    if (total <= 0) return;
    if (total <= maxCells) {
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                out.add(`${x},${y}`);
            }
        }
        return;
    }
    // Choose strides so width/strideX * height/strideY ≈ maxCells.
    const strideX = Math.max(1, Math.ceil(width / Math.max(1, Math.ceil(Math.sqrt(maxCells * (width / height))))));
    const strideY = Math.max(1, Math.ceil(height / Math.max(1, Math.ceil(Math.sqrt(maxCells * (height / width))))));
    const staged = [];
    for (let x = x0; x <= x1; x += strideX) {
        for (let y = y0; y <= y1; y += strideY) {
            staged.push(`${x},${y}`);
        }
    }
    staged.push(`${x1},${y1}`, `${x0},${y0}`, `${x1},${y0}`, `${x0},${y1}`);
    for (let i = 0; i < staged.length && out.size < maxCells; i++) {
        out.add(staged[i]);
    }
    // If still over (duplicates in set are fine), trim is automatic via size check above.
    if (out.size > maxCells) {
        const trimmed = [...out].slice(0, maxCells);
        out.clear();
        for (const key of trimmed) out.add(key);
    }
}

/**
 * All spatial cell keys a feature should be stored under.
 * Points → one cell. Lines/polygons → every cell the geometry touches (capped).
 *
 * @param {object} feature
 * @param {number} [cellSizeDeg]
 * @param {number} [maxCells]
 * @returns {string[]}
 */
export function featureSpatialCellKeys(
    feature,
    cellSizeDeg = SPATIAL_CHUNK_CELL_SIZE_DEG,
    maxCells = SPATIAL_CHUNK_MAX_CELLS_PER_FEATURE
) {
    const size = cellSizeDeg > 0 ? cellSizeDeg : SPATIAL_CHUNK_CELL_SIZE_DEG;
    const cap = Math.max(1, maxCells || SPATIAL_CHUNK_MAX_CELLS_PER_FEATURE);
    const geometry = feature?.geometry;
    if (!geometry) return [NULL_GEOMETRY_CELL_KEY];

    const { type, coordinates: coords } = geometry;
    if (!type || coords == null) return [NULL_GEOMETRY_CELL_KEY];

    /** @type {Set<string>} */
    const keys = new Set();

    const collectGeometry = (g) => {
        if (!g) return;
        const gType = g.type;
        const gCoords = g.coordinates;
        switch (gType) {
            case 'Point':
                if (Number.isFinite(gCoords?.[0]) && Number.isFinite(gCoords?.[1])) {
                    keys.add(spatialCellKey(gCoords[0], gCoords[1], size));
                }
                break;
            case 'MultiPoint':
                for (const p of gCoords || []) {
                    if (Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])) {
                        keys.add(spatialCellKey(p[0], p[1], size));
                    }
                }
                break;
            case 'LineString':
                _addLineCells(gCoords, size, keys);
                break;
            case 'MultiLineString':
                for (const line of gCoords || []) _addLineCells(line, size, keys);
                break;
            case 'Polygon':
                for (const ring of gCoords || []) _addLineCells(ring, size, keys);
                break;
            case 'MultiPolygon':
                for (const poly of gCoords || []) {
                    for (const ring of poly || []) _addLineCells(ring, size, keys);
                }
                break;
            case 'GeometryCollection':
                for (const child of g.geometries || []) collectGeometry(child);
                break;
            default:
                break;
        }
    };

    collectGeometry(geometry);

    if (!keys.size) return [NULL_GEOMETRY_CELL_KEY];

    if (keys.size > cap) {
        // Too many cells — keep a strided envelope cover (plus primary cell).
        const primary = featureSpatialCellKey(feature, size);
        let w = Infinity;
        let s = Infinity;
        let e = -Infinity;
        let n = -Infinity;
        for (const key of keys) {
            if (key === NULL_GEOMETRY_CELL_KEY) continue;
            const [cx, cy] = key.split(',').map(Number);
            if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
            const west = cx * size;
            const south = cy * size;
            const east = west + size;
            const north = south + size;
            if (west < w) w = west;
            if (south < s) s = south;
            if (east > e) e = east;
            if (north > n) n = north;
        }
        keys.clear();
        if (primary !== NULL_GEOMETRY_CELL_KEY) keys.add(primary);
        if (Number.isFinite(w)) {
            const room = Math.max(1, cap - keys.size);
            _addEnvelopeCells([w, s, e, n], size, room + keys.size, keys);
        }
        if (keys.size > cap) {
            const trimmed = [...keys].slice(0, cap);
            keys.clear();
            for (const key of trimmed) keys.add(key);
        }
    }

    return [...keys];
}

/**
 * @param {{
 *   chunkSize?: number,
 *   cellSizeDeg?: number,
 *   maxOpenCells?: number,
 *   maxCellsPerFeature?: number,
 *   initialIndex?: number,
 *   initialChunkSerial?: number,
 *   onFlush: (features: object[], startIndex: number) => Promise<void>|void
 * }} options
 */
export function createSpatialChunkWriter(options) {
    const chunkSize = options.chunkSize ?? SPATIAL_CHUNK_FLUSH_SIZE;
    const cellSizeDeg = options.cellSizeDeg ?? SPATIAL_CHUNK_CELL_SIZE_DEG;
    const maxOpenCells = options.maxOpenCells ?? SPATIAL_CHUNK_MAX_OPEN_CELLS;
    const maxCellsPerFeature = options.maxCellsPerFeature ?? SPATIAL_CHUNK_MAX_CELLS_PER_FEATURE;
    const onFlush = options.onFlush;
    if (typeof onFlush !== 'function') {
        throw new Error('createSpatialChunkWriter requires onFlush');
    }

    /** @type {Map<string, object[]>} */
    const cells = new Map();
    /** @type {string[]} least-recent → most-recent */
    const lru = [];
    /** Next unique logical feature index (not copy count). */
    let nextLogicalIndex = Math.max(0, Number(options.initialIndex) || 0);
    /**
     * Monotonic chunk id token. On resume must continue past existing
     * `${layerId}:c:${n}` ids — callers pass initialChunkSerial.
     */
    let nextChunkToken = Math.max(
        nextLogicalIndex,
        Math.max(0, Number(options.initialChunkSerial) || 0)
    );
    /** Copies currently sitting in cell buffers. */
    let bufferedCopies = 0;

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
        bufferedCopies -= batch.length;
        const startIndex = nextChunkToken++;
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

    async function pushIntoCell(key, feature) {
        let buf = cells.get(key);
        if (!buf) {
            buf = [];
            cells.set(key, buf);
        }
        buf.push(feature);
        bufferedCopies += 1;
        touch(key);

        if (buf.length >= chunkSize) {
            await flushKey(key);
        } else {
            await evictIfNeeded();
        }
    }

    return {
        /** Logical features written or assigned (unique count). */
        get writtenCount() {
            return nextLogicalIndex;
        },
        get bufferedCount() {
            return bufferedCopies;
        },
        /** Alias for progress UIs — unique feature count including buffered. */
        get featureCount() {
            return nextLogicalIndex;
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
            const keys = featureSpatialCellKeys(feature, cellSizeDeg, maxCellsPerFeature);
            const featureIndex = nextLogicalIndex++;
            // Same object referenced from each cell buffer — flush stamps identity in store.
            const stamped = {
                type: 'Feature',
                geometry: feature.geometry,
                properties: feature.properties || {},
                __featureIndex: featureIndex
            };

            for (const key of keys) {
                await pushIntoCell(key, stamped);
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
    SPATIAL_CHUNK_MAX_CELLS_PER_FEATURE,
    NULL_GEOMETRY_CELL_KEY,
    featureRepresentativePoint,
    spatialCellKey,
    featureSpatialCellKey,
    featureSpatialCellKeys,
    createSpatialChunkWriter
};
