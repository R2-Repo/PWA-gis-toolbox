/**
 * Streaming .shp record parser — reads fixed-structure shapefile records one
 * at a time from a byte reader and emits GeoJSON geometries (2D; Z/M values
 * are dropped — the original file is preserved in OPFS). Pure module.
 */

export const SHP_HEADER_BYTES = 100;

/** Base type for Z (11,13,15,18) and M (21,23,25,28) variants maps to 1,3,5,8. */
function _baseShapeType(type) {
    if (type >= 11 && type <= 18) return type - 10;
    if (type >= 21 && type <= 28) return type - 20;
    return type;
}

/**
 * @param {Uint8Array} bytes first 100 bytes of the .shp
 * @returns {{ shapeType: number, bbox: [number,number,number,number] }}
 */
export function parseShpHeader(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = dv.getInt32(0, false);
    if (magic !== 9994) {
        throw new Error('Not a shapefile (.shp magic number missing).');
    }
    return {
        shapeType: dv.getInt32(32, true),
        bbox: [
            dv.getFloat64(36, true),
            dv.getFloat64(44, true),
            dv.getFloat64(52, true),
            dv.getFloat64(60, true)
        ]
    };
}

/** Signed ring area via shoelace — positive means clockwise (shapefile outer). */
export function ringIsClockwise(ring) {
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        sum += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
    }
    return sum > 0;
}

function _pointInRing(point, ring) {
    // Ray casting
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

/**
 * Assemble shapefile polygon rings into GeoJSON Polygon/MultiPolygon.
 * Clockwise rings are outers; counter-clockwise rings are holes assigned to
 * the containing outer (falling back to promotion when nothing contains them).
 * @param {Array<[number,number][]>} rings
 */
export function assemblePolygon(rings) {
    if (!rings.length) return null;
    const outers = [];
    const holes = [];
    for (const ring of rings) {
        if (ring.length < 4) continue;
        (ringIsClockwise(ring) ? outers : holes).push(ring);
    }
    if (!outers.length) {
        // Non-spec writer (all rings share one winding) — classify by
        // containment depth instead: rings inside an odd number of other
        // rings are holes.
        const rings = holes.splice(0);
        for (const ring of rings) {
            const depth = rings.filter((other) => other !== ring && _pointInRing(ring[0], other)).length;
            (depth % 2 === 0 ? outers : holes).push(ring);
        }
    }

    const polygons = outers.map((outer) => [outer]);
    for (const hole of holes) {
        const probe = hole[0];
        let host = null;
        if (polygons.length === 1) {
            host = polygons[0];
        } else {
            host = polygons.find((poly) => _pointInRing(probe, poly[0])) || null;
        }
        if (host) {
            host.push(hole);
        } else {
            polygons.push([hole]);
        }
    }

    if (!polygons.length) return null;
    if (polygons.length === 1) {
        return { type: 'Polygon', coordinates: polygons[0] };
    }
    return { type: 'MultiPolygon', coordinates: polygons };
}

/**
 * Parse one record's content into a GeoJSON geometry (or null for null shapes).
 * @param {DataView} dv record content
 */
export function parseShpRecordContent(dv) {
    const type = dv.getInt32(0, true);
    if (type === 0) return null;
    const base = _baseShapeType(type);

    if (base === 1) {
        // Point: x,y at offset 4
        return { type: 'Point', coordinates: [dv.getFloat64(4, true), dv.getFloat64(12, true)] };
    }

    if (base === 8) {
        // MultiPoint: box(32) numPoints(4) points
        const numPoints = dv.getInt32(36, true);
        const coords = [];
        for (let i = 0; i < numPoints; i++) {
            coords.push([dv.getFloat64(40 + i * 16, true), dv.getFloat64(48 + i * 16, true)]);
        }
        if (!coords.length) return null;
        if (coords.length === 1) return { type: 'Point', coordinates: coords[0] };
        return { type: 'MultiPoint', coordinates: coords };
    }

    if (base === 3 || base === 5) {
        // PolyLine/Polygon: box(32) numParts(4) numPoints(4) parts points
        const numParts = dv.getInt32(36, true);
        const numPoints = dv.getInt32(40, true);
        const partStarts = [];
        for (let i = 0; i < numParts; i++) {
            partStarts.push(dv.getInt32(44 + i * 4, true));
        }
        const ptsBase = 44 + numParts * 4;
        const parts = [];
        for (let p = 0; p < numParts; p++) {
            const start = partStarts[p];
            const end = p + 1 < numParts ? partStarts[p + 1] : numPoints;
            const pts = [];
            for (let i = start; i < end; i++) {
                pts.push([dv.getFloat64(ptsBase + i * 16, true), dv.getFloat64(ptsBase + i * 16 + 8, true)]);
            }
            if (pts.length) parts.push(pts);
        }
        if (!parts.length) return null;

        if (base === 3) {
            if (parts.length === 1) return { type: 'LineString', coordinates: parts[0] };
            return { type: 'MultiLineString', coordinates: parts };
        }
        return assemblePolygon(parts);
    }

    throw new Error(`Unsupported shapefile shape type ${type}.`);
}

/**
 * Async generator of { recordNumber, geometry } from a .shp byte reader.
 * @param {ReturnType<import('./byte-reader.js').createByteReader>} byteReader
 */
export async function* iterateShpRecords(byteReader) {
    const header = await byteReader.readExact(SHP_HEADER_BYTES);
    if (!header) throw new Error('Empty .shp file.');
    parseShpHeader(header);

    while (true) {
        const recHeader = await byteReader.readExact(8);
        if (recHeader == null) break;
        const hv = new DataView(recHeader.buffer, recHeader.byteOffset, 8);
        const recordNumber = hv.getInt32(0, false);
        const contentBytes = hv.getInt32(4, false) * 2;
        if (contentBytes < 4 || contentBytes > 256 * 1024 * 1024) {
            throw new Error(`Corrupt shapefile record #${recordNumber} (content ${contentBytes} bytes).`);
        }
        const content = await byteReader.readExact(contentBytes);
        if (content == null) {
            throw new Error(`Truncated shapefile at record #${recordNumber}.`);
        }
        const dv = new DataView(content.buffer, content.byteOffset, content.byteLength);
        yield { recordNumber, geometry: parseShpRecordContent(dv) };
    }
}

export default {
    SHP_HEADER_BYTES,
    parseShpHeader,
    parseShpRecordContent,
    assemblePolygon,
    ringIsClockwise,
    iterateShpRecords
};
