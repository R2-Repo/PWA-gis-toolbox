/**
 * Build a one-tile PMTiles fixture (no network). Run:
 * node tests/fixtures/e2e/build-dual-screen-pmtiles.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PMTiles, zxyToTileId } from 'pmtiles';
import { buildTileFromFeatures } from '../../../js/map/tiles/tile-builder.js';

const outPath = join(dirname(fileURLToPath(import.meta.url)), 'dual-screen-point.pmtiles');

function writeVarint(out, value) {
    let n = value >>> 0;
    while (n > 127) {
        out.push((n & 0x7f) | 0x80);
        n >>>= 7;
    }
    out.push(n & 0x7f);
}

function serializeDirectory(entries) {
    const out = [];
    writeVarint(out, entries.length);
    let last = 0;
    for (const entry of entries) {
        writeVarint(out, entry.tileId - last);
        last = entry.tileId;
    }
    for (const entry of entries) writeVarint(out, entry.runLength);
    for (const entry of entries) writeVarint(out, entry.length);
    for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const prev = entries[i - 1];
        if (i > 0 && entry.offset === prev.offset + prev.length) writeVarint(out, 0);
        else writeVarint(out, entry.offset + 1);
    }
    return Uint8Array.from(out);
}

function setU64(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
    view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true);
}

const z = 0;
const x = 0;
const y = 0;
const tile = buildTileFromFeatures([
    {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-111.89, 40.76] },
        properties: { NAME: 'Feature 1', SCORE: 1 }
    }
], z, x, y);
if (!tile) throw new Error('empty tile');
const tileBytes = tile instanceof Uint8Array ? tile : new Uint8Array(tile);

const metadata = new TextEncoder().encode(JSON.stringify({
    vector_layers: [{
        id: 'features',
        fields: { NAME: 'String', SCORE: 'Number' }
    }]
}));

const headerLen = 127;
const directory = serializeDirectory([{
    tileId: zxyToTileId(z, x, y),
    offset: 0,
    length: tileBytes.byteLength,
    runLength: 1
}]);
const tileOffset = headerLen + directory.byteLength + metadata.byteLength;
const file = new Uint8Array(tileOffset + tileBytes.byteLength);
file.set([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 0x03]);
const view = new DataView(file.buffer);
setU64(view, 8, headerLen);
setU64(view, 16, directory.byteLength);
setU64(view, 24, headerLen + directory.byteLength);
setU64(view, 32, metadata.byteLength);
setU64(view, 40, 0);
setU64(view, 48, 0);
setU64(view, 56, tileOffset);
setU64(view, 64, tileBytes.byteLength);
setU64(view, 72, 1);
setU64(view, 80, 1);
setU64(view, 88, 1);
file[96] = 1;
file[97] = 1;
file[98] = 1;
file[99] = 1;
file[100] = 0;
file[101] = 0;
view.setInt32(102, Math.round(-180 * 1e7), true);
view.setInt32(106, Math.round(-85 * 1e7), true);
view.setInt32(110, Math.round(180 * 1e7), true);
view.setInt32(114, Math.round(85 * 1e7), true);
file[118] = 0;
view.setInt32(119, Math.round(-111.89 * 1e7), true);
view.setInt32(123, Math.round(40.76 * 1e7), true);
file.set(directory, headerLen);
file.set(metadata, headerLen + directory.byteLength);
file.set(tileBytes, tileOffset);

class BufferSource {
    constructor(buf) { this.buf = buf; }
    getKey() { return 'fixture'; }
    async getBytes(offset, length) {
        const slice = this.buf.slice(offset, Math.min(this.buf.byteLength, offset + length));
        return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) };
    }
}

const archive = new PMTiles(new BufferSource(file));
const header = await archive.getHeader();
const zxy = await archive.getZxy(z, x, y);
if (!zxy?.data?.byteLength) throw new Error('fixture tile missing');
if (header.tileType !== 1) throw new Error(`unexpected tile type ${header.tileType}`);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, file);
console.log(`wrote ${outPath} (${file.byteLength} bytes)`);
