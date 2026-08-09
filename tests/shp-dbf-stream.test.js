import { describe, expect, it } from 'vitest';
import { createByteReader } from '../js/import/stream/byte-reader.js';
import {
    parseShpHeader,
    assemblePolygon,
    ringIsClockwise,
    iterateShpRecords
} from '../js/import/stream/shp-stream-parser.js';
import {
    readDbfHeader,
    iterateDbfRecords,
    decoderFromCpg
} from '../js/import/stream/dbf-stream-parser.js';
import { writeShp, writeDbf } from './helpers/shp-writer.js';

function chunkedStream(bytes, size = 7) {
    let i = 0;
    return new ReadableStream({
        pull(controller) {
            if (i >= bytes.length) {
                controller.close();
                return;
            }
            controller.enqueue(bytes.subarray(i, Math.min(i + size, bytes.length)));
            i += size;
        }
    });
}

async function collect(iter) {
    const out = [];
    for await (const item of iter) out.push(item);
    return out;
}

// Shapefile spec: outer rings clockwise, holes counter-clockwise.
const CW_OUTER = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
const CCW_HOLE = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]];
const CW_OUTER_FAR = [[20, 20], [20, 30], [30, 30], [30, 20], [20, 20]];

describe('byte-reader', () => {
    it('reads exact lengths across chunk boundaries', async () => {
        const bytes = new Uint8Array(100).map((_, i) => i);
        const reader = createByteReader(chunkedStream(bytes, 3));
        const a = await reader.readExact(10);
        const b = await reader.readExact(50);
        const c = await reader.readExact(40);
        expect([...a]).toEqual([...bytes.slice(0, 10)]);
        expect([...b]).toEqual([...bytes.slice(10, 60)]);
        expect([...c]).toEqual([...bytes.slice(60, 100)]);
        expect(await reader.readExact(1)).toBeNull();
        expect(reader.bytesConsumed).toBe(100);
    });

    it('throws on truncated reads', async () => {
        const reader = createByteReader(chunkedStream(new Uint8Array(5), 2));
        await expect(reader.readExact(10)).rejects.toThrow(/truncated/i);
    });
});

describe('shp-stream-parser', () => {
    it('rejects non-shapefile bytes', () => {
        expect(() => parseShpHeader(new Uint8Array(100))).toThrow(/magic/i);
    });

    it('detects ring winding', () => {
        expect(ringIsClockwise(CW_OUTER)).toBe(true);
        expect(ringIsClockwise(CCW_HOLE)).toBe(false);
    });

    it('assembles outer + hole into one polygon', () => {
        const geom = assemblePolygon([CW_OUTER, CCW_HOLE]);
        expect(geom.type).toBe('Polygon');
        expect(geom.coordinates).toHaveLength(2);
        expect(geom.coordinates[0]).toEqual(CW_OUTER);
        expect(geom.coordinates[1]).toEqual(CCW_HOLE);
    });

    it('assembles two outers into a MultiPolygon with the hole in the right one', () => {
        const geom = assemblePolygon([CW_OUTER, CW_OUTER_FAR, CCW_HOLE]);
        expect(geom.type).toBe('MultiPolygon');
        expect(geom.coordinates).toHaveLength(2);
        const withHole = geom.coordinates.find((rings) => rings.length === 2);
        expect(withHole[1]).toEqual(CCW_HOLE);
    });

    it('streams point, polyline, polygon, and null records', async () => {
        const shp = writeShp([
            { type: 'Point', points: [[-111.9, 40.7]] },
            null,
            { type: 'PolyLine', parts: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] },
            { type: 'Polygon', parts: [CW_OUTER, CCW_HOLE] },
            { type: 'MultiPoint', points: [[1, 2], [3, 4]] }
        ]);
        const records = await collect(iterateShpRecords(createByteReader(chunkedStream(shp, 13))));
        expect(records).toHaveLength(5);
        expect(records[0].geometry).toEqual({ type: 'Point', coordinates: [-111.9, 40.7] });
        expect(records[1].geometry).toBeNull();
        expect(records[2].geometry.type).toBe('MultiLineString');
        expect(records[3].geometry.type).toBe('Polygon');
        expect(records[3].geometry.coordinates).toHaveLength(2);
        expect(records[4].geometry).toEqual({ type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] });
    });
});

describe('dbf-stream-parser', () => {
    const FIELDS = [
        { name: 'NAME', type: 'C', length: 20 },
        { name: 'VALUE', type: 'N', length: 10, decimal: 2 },
        { name: 'ACTIVE', type: 'L', length: 1 },
        { name: 'BUILT', type: 'D', length: 8 }
    ];
    const ROWS = [
        { NAME: 'Alpha', VALUE: 12.5, ACTIVE: true, BUILT: '2020-03-15' },
        { NAME: 'Beta', VALUE: -3, ACTIVE: false, BUILT: null },
        { NAME: '', VALUE: null, ACTIVE: null, BUILT: '1999-12-31' }
    ];

    it('parses header and typed records', async () => {
        const dbf = writeDbf(ROWS, FIELDS);
        const reader = createByteReader(chunkedStream(dbf, 11));
        const rows = await collect(iterateDbfRecords(reader));
        expect(rows).toHaveLength(3);
        expect(rows[0]).toEqual({ NAME: 'Alpha', VALUE: 12.5, ACTIVE: true, BUILT: '2020-03-15' });
        expect(rows[1]).toEqual({ NAME: 'Beta', VALUE: -3, ACTIVE: false, BUILT: null });
        expect(rows[2]).toEqual({ NAME: null, VALUE: null, ACTIVE: null, BUILT: '1999-12-31' });
    });

    it('reads the header shape', async () => {
        const dbf = writeDbf(ROWS, FIELDS);
        const header = await readDbfHeader(createByteReader(chunkedStream(dbf, 64)));
        expect(header.recordCount).toBe(3);
        expect(header.fields.map((f) => f.name)).toEqual(['NAME', 'VALUE', 'ACTIVE', 'BUILT']);
        expect(header.recordLen).toBe(1 + 20 + 10 + 1 + 8);
    });

    it('decoderFromCpg maps common labels and falls back to latin1', () => {
        // TextDecoder canonicalizes latin1/iso-8859-1 labels to windows-1252.
        const latin1Canonical = new TextDecoder('latin1').encoding;
        expect(decoderFromCpg('UTF-8').encoding).toBe('utf-8');
        expect(decoderFromCpg('ISO-8859-1').encoding).toBe(latin1Canonical);
        expect(decoderFromCpg('NOT-A-REAL-ENCODING').encoding).toBe(latin1Canonical);
        expect(decoderFromCpg(null).encoding).toBe(latin1Canonical);
    });
});
