/**
 * Grid spatial index for workspace chunks (viewport queries).
 */
export class GridSpatialIndex {
    /**
     * @param {number} [cellSizeDeg=0.5]
     */
    constructor(cellSizeDeg = 0.5) {
        this.cellSize = cellSizeDeg;
        /** @type {Map<string, string[]>} cellKey -> chunkIds */
        this.cells = new Map();
        /** @type {Map<string, { chunkId: string, layerId: string, bbox: number[], featureCount: number }>} */
        this.chunks = new Map();
    }

    _cellKey(lon, lat) {
        const x = Math.floor(lon / this.cellSize);
        const y = Math.floor(lat / this.cellSize);
        return `${x},${y}`;
    }

    /**
     * @param {string} chunkId
     * @param {string} layerId
     * @param {[number,number,number,number]} bbox [west,south,east,north]
     * @param {number} featureCount
     */
    insert(chunkId, layerId, bbox, featureCount) {
        this.chunks.set(chunkId, { chunkId, layerId, bbox, featureCount });
        const [west, south, east, north] = bbox;
        const x0 = Math.floor(west / this.cellSize);
        const x1 = Math.floor(east / this.cellSize);
        const y0 = Math.floor(south / this.cellSize);
        const y1 = Math.floor(north / this.cellSize);
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                const key = `${x},${y}`;
                if (!this.cells.has(key)) this.cells.set(key, []);
                const list = this.cells.get(key);
                if (!list.includes(chunkId)) list.push(chunkId);
            }
        }
    }

    /**
     * @param {[number,number,number,number]} bounds [west,south,east,north]
     * @param {string} [layerId]
     * @returns {string[]} chunkIds
     */
    query(bounds, layerId = null) {
        const [west, south, east, north] = bounds;
        const seen = new Set();
        const out = [];
        const x0 = Math.floor(west / this.cellSize);
        const x1 = Math.floor(east / this.cellSize);
        const y0 = Math.floor(south / this.cellSize);
        const y1 = Math.floor(north / this.cellSize);
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                const ids = this.cells.get(`${x},${y}`) || [];
                for (const id of ids) {
                    if (seen.has(id)) continue;
                    const rec = this.chunks.get(id);
                    if (!rec) continue;
                    if (layerId && rec.layerId !== layerId) continue;
                    const [cw, cs, ce, cn] = rec.bbox;
                    if (ce < west || cw > east || cn < south || cs > north) continue;
                    seen.add(id);
                    out.push(id);
                }
            }
        }
        return out;
    }

    remove(chunkId) {
        if (!this.chunks.has(chunkId)) return;
        this.chunks.delete(chunkId);
        for (const [key, ids] of this.cells) {
            this.cells.set(key, ids.filter((id) => id !== chunkId));
        }
    }

    removeLayer(layerId) {
        for (const [id, rec] of this.chunks) {
            if (rec.layerId === layerId) this.chunks.delete(id);
        }
        // Keep cell entries whose chunk still exists (i.e. belongs to another layer).
        for (const [key, ids] of this.cells) {
            this.cells.set(key, ids.filter((id) => this.chunks.has(id)));
        }
    }

    toJSON() {
        return {
            cellSize: this.cellSize,
            chunks: [...this.chunks.values()]
        };
    }

    static fromJSON(data) {
        const idx = new GridSpatialIndex(data?.cellSize ?? 0.5);
        for (const rec of data?.chunks || []) {
            idx.insert(rec.chunkId, rec.layerId, rec.bbox, rec.featureCount);
        }
        return idx;
    }
}

/**
 * @param {import('geojson').Feature[]} features
 * @returns {[number,number,number,number]}
 */
export function bboxFromFeatures(features) {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    const stack = [];
    for (const f of features) {
        if (f?.geometry?.coordinates) stack.push(f.geometry.coordinates);
    }
    while (stack.length) {
        const coords = stack.pop();
        if (typeof coords[0] === 'number') {
            const x = coords[0];
            const y = coords[1];
            if (x < west) west = x;
            if (y < south) south = y;
            if (x > east) east = x;
            if (y > north) north = y;
            continue;
        }
        for (let i = 0; i < coords.length; i++) {
            stack.push(coords[i]);
        }
    }
    if (!isFinite(west)) return [-180, -90, 180, 90];
    return [west, south, east, north];
}

export default { GridSpatialIndex, bboxFromFeatures };
