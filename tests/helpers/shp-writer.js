/**
 * Minimal shapefile writer — test fixtures only (not production code).
 * Supports 2D Point / MultiPoint / PolyLine / Polygon records and DBF tables.
 */

const SHAPE_TYPES = { Point: 1, PolyLine: 3, Polygon: 5, MultiPoint: 8 };

function _ringsBbox(pointArrays) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const pts of pointArrays) {
        for (const [x, y] of pts) {
            if (x < xmin) xmin = x;
            if (y < ymin) ymin = y;
            if (x > xmax) xmax = x;
            if (y > ymax) ymax = y;
        }
    }
    if (!isFinite(xmin)) return [0, 0, 0, 0];
    return [xmin, ymin, xmax, ymax];
}

/**
 * @param {Array<{ type: 'Point'|'MultiPoint'|'PolyLine'|'Polygon', points?: [number,number][], parts?: [number,number][][] }|null>} shapes
 *   Point: { type:'Point', points:[[x,y]] } — null entry writes a null shape.
 *   MultiPoint: { type:'MultiPoint', points:[[x,y],...] }
 *   PolyLine/Polygon: { type, parts: [ [[x,y],...], ... ] }
 * @returns {Uint8Array}
 */
export function writeShp(shapes) {
    const records = [];
    let fileWords = 50; // 100-byte header

    for (let i = 0; i < shapes.length; i++) {
        const shape = shapes[i];
        let content;
        if (shape == null) {
            content = new DataView(new ArrayBuffer(4));
            content.setInt32(0, 0, true); // null shape
        } else if (shape.type === 'Point') {
            content = new DataView(new ArrayBuffer(20));
            content.setInt32(0, SHAPE_TYPES.Point, true);
            content.setFloat64(4, shape.points[0][0], true);
            content.setFloat64(12, shape.points[0][1], true);
        } else if (shape.type === 'MultiPoint') {
            const pts = shape.points;
            content = new DataView(new ArrayBuffer(40 + 16 * pts.length));
            content.setInt32(0, SHAPE_TYPES.MultiPoint, true);
            const [xmin, ymin, xmax, ymax] = _ringsBbox([pts]);
            content.setFloat64(4, xmin, true);
            content.setFloat64(12, ymin, true);
            content.setFloat64(20, xmax, true);
            content.setFloat64(28, ymax, true);
            content.setInt32(36, pts.length, true);
            pts.forEach(([x, y], j) => {
                content.setFloat64(40 + j * 16, x, true);
                content.setFloat64(48 + j * 16, y, true);
            });
        } else {
            const parts = shape.parts;
            const totalPts = parts.reduce((s, p) => s + p.length, 0);
            content = new DataView(new ArrayBuffer(44 + 4 * parts.length + 16 * totalPts));
            content.setInt32(0, SHAPE_TYPES[shape.type], true);
            const [xmin, ymin, xmax, ymax] = _ringsBbox(parts);
            content.setFloat64(4, xmin, true);
            content.setFloat64(12, ymin, true);
            content.setFloat64(20, xmax, true);
            content.setFloat64(28, ymax, true);
            content.setInt32(36, parts.length, true);
            content.setInt32(40, totalPts, true);
            let offset = 0;
            parts.forEach((p, j) => {
                content.setInt32(44 + j * 4, offset, true);
                offset += p.length;
            });
            const ptsBase = 44 + 4 * parts.length;
            let k = 0;
            for (const p of parts) {
                for (const [x, y] of p) {
                    content.setFloat64(ptsBase + k * 16, x, true);
                    content.setFloat64(ptsBase + k * 16 + 8, y, true);
                    k++;
                }
            }
        }
        records.push(content);
        fileWords += 4 + content.byteLength / 2;
    }

    const out = new Uint8Array(fileWords * 2);
    const dv = new DataView(out.buffer);
    dv.setInt32(0, 9994, false);
    dv.setInt32(24, fileWords, false);
    dv.setInt32(28, 1000, true);
    // Global shape type: first non-null shape's type
    const first = shapes.find((s) => s != null);
    dv.setInt32(32, first ? SHAPE_TYPES[first.type] : 0, true);
    // Global bbox
    const allPts = [];
    for (const s of shapes) {
        if (!s) continue;
        if (s.points) allPts.push(s.points);
        if (s.parts) allPts.push(...s.parts);
    }
    const [xmin, ymin, xmax, ymax] = _ringsBbox(allPts);
    dv.setFloat64(36, xmin, true);
    dv.setFloat64(44, ymin, true);
    dv.setFloat64(52, xmax, true);
    dv.setFloat64(60, ymax, true);

    let pos = 100;
    records.forEach((content, i) => {
        dv.setInt32(pos, i + 1, false);
        dv.setInt32(pos + 4, content.byteLength / 2, false);
        new Uint8Array(out.buffer, pos + 8, content.byteLength)
            .set(new Uint8Array(content.buffer));
        pos += 8 + content.byteLength;
    });

    return out;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {Array<{ name: string, type: 'C'|'N'|'F'|'L'|'D', length: number, decimal?: number }>} fields
 * @returns {Uint8Array}
 */
export function writeDbf(rows, fields) {
    const encoder = new TextEncoder();
    const headerLen = 32 + fields.length * 32 + 1;
    const recordLen = 1 + fields.reduce((s, f) => s + f.length, 0);
    const out = new Uint8Array(headerLen + rows.length * recordLen + 1);
    const dv = new DataView(out.buffer);

    out[0] = 0x03;
    out[1] = 95; out[2] = 7; out[3] = 26; // last-update date (arbitrary)
    dv.setUint32(4, rows.length, true);
    dv.setUint16(8, headerLen, true);
    dv.setUint16(10, recordLen, true);

    fields.forEach((f, i) => {
        const base = 32 + i * 32;
        const nameBytes = encoder.encode(f.name.slice(0, 10));
        out.set(nameBytes, base);
        out[base + 11] = f.type.charCodeAt(0);
        out[base + 16] = f.length;
        out[base + 17] = f.decimal || 0;
    });
    out[32 + fields.length * 32] = 0x0d;

    const writeCell = (value, field) => {
        let text;
        if (value == null) {
            text = '';
        } else if (field.type === 'L') {
            text = value ? 'T' : 'F';
        } else if (field.type === 'D') {
            text = String(value).replace(/-/g, '').slice(0, 8);
        } else {
            text = String(value);
        }
        if (text.length > field.length) text = text.slice(0, field.length);
        if (field.type === 'N' || field.type === 'F') {
            return text.padStart(field.length, ' ');
        }
        return text.padEnd(field.length, ' ');
    };

    rows.forEach((row, r) => {
        let pos = headerLen + r * recordLen;
        out[pos++] = 0x20; // not deleted
        for (const f of fields) {
            const cell = writeCell(row[f.name], f);
            out.set(encoder.encode(cell), pos);
            pos += f.length;
        }
    });

    out[out.length - 1] = 0x1a;
    return out;
}

export default { writeShp, writeDbf };
