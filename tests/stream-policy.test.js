import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
    assessStreamEligibility,
    partitionStreamingFiles,
    sniffJsonIsFeatureCollection,
    STREAM_MAX_BYTES
} from '../js/import/stream/stream-policy.js';
import { TEXT_STRONG_BYTES, TEXT_SOFT_BYTES, BINARY_STRONG_BYTES } from '../js/import/import-preflight.js';

function randomBytes(n) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = (Math.random() * 256) | 0;
    return out;
}

async function makeArchive(name, entries) {
    const zip = new JSZip();
    for (const [path, content] of Object.entries(entries)) {
        zip.file(path, content);
    }
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new File([bytes], name, { type: 'application/zip' });
}

function fakeFile(name, size) {
    // Real bytes are only needed for .json sniffing — plain object elsewhere.
    return { name, size };
}

function realJsonFile(name, content, padTo = 0) {
    const pad = padTo > content.length ? ' '.repeat(padTo - content.length) : '';
    return new File([content + pad], name, { type: 'application/json' });
}

describe('stream-policy', () => {
    it('keeps small files on the standard path', async () => {
        const res = await assessStreamEligibility(fakeFile('small.geojson', 1024));
        expect(res.stream).toBe(false);
        expect(res.reject).toBe(false);
    });

    it('keeps optimizer-range files (soft..strong) on the standard path', async () => {
        const res = await assessStreamEligibility(fakeFile('mid.geojson', TEXT_SOFT_BYTES + 1));
        expect(res.stream).toBe(false);
    });

    it('streams large geojson that the standard pipeline rejects', async () => {
        const res = await assessStreamEligibility(fakeFile('big.geojson', TEXT_STRONG_BYTES + 1));
        expect(res.stream).toBe(true);
    });

    it('streams large csv', async () => {
        const res = await assessStreamEligibility(fakeFile('big.csv', 100 * 1024 * 1024));
        expect(res.stream).toBe(true);
    });

    it('streams large kml', async () => {
        const res = await assessStreamEligibility(fakeFile('big.kml', 50 * 1024 * 1024));
        expect(res.stream).toBe(true);
    });

    it('does not stream unsupported formats (xlsx stays rejected by the guard)', async () => {
        const res = await assessStreamEligibility(fakeFile('big.xlsx', 50 * 1024 * 1024));
        expect(res.stream).toBe(false);
        expect(res.reject).toBe(false);
    });

    it('streams large .xml only when it sniffs as KML', async () => {
        const pad = ' '.repeat(TEXT_STRONG_BYTES + 10);
        const kmlXml = new File([`<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2">${pad}`], 'big.xml');
        const plainXml = new File([`<?xml version="1.0"?><root><data/></root>${pad}`], 'big.xml');
        expect((await assessStreamEligibility(kmlXml)).stream).toBe(true);
        expect((await assessStreamEligibility(plainXml)).stream).toBe(false);
    });

    it('rejects streamable files above the streaming ceiling with a clear message', async () => {
        const res = await assessStreamEligibility(fakeFile('huge.geojson', STREAM_MAX_BYTES + 1));
        expect(res.stream).toBe(false);
        expect(res.reject).toBe(true);
        expect(res.message).toMatch(/high-capacity import limit/);
    });

    it('streams statewide-scale GeoJSON under the 2 GB ceiling', async () => {
        // Previously capped at 512 MB — filters reduce stored features, source is streamed.
        const res = await assessStreamEligibility(fakeFile('utah-roads.geojson', 900 * 1024 * 1024));
        expect(res.stream).toBe(true);
        expect(res.reject).toBe(false);
    });

    it('streams large .json only when it sniffs as a FeatureCollection', async () => {
        const fcJson = realJsonFile(
            'big.json',
            '{"type":"FeatureCollection","features":[',
            TEXT_STRONG_BYTES + 10
        );
        const tableJson = realJsonFile('table.json', '[{"a":1},{"a":2}', TEXT_STRONG_BYTES + 10);

        expect((await assessStreamEligibility(fcJson)).stream).toBe(true);
        expect((await assessStreamEligibility(tableJson)).stream).toBe(false);
    });

    it('sniffJsonIsFeatureCollection reads only the head', async () => {
        const file = realJsonFile('x.json', '{"type": "FeatureCollection", "features": []}');
        expect(await sniffJsonIsFeatureCollection(file)).toBe(true);
    });

    it('streams large kmz after central-directory inspection (no extraction)', async () => {
        // Random payload keeps the compressed archive above the binary reject cap.
        const kmz = await makeArchive('big.kmz', {
            'doc.kml': randomBytes(BINARY_STRONG_BYTES + 1024 * 1024)
        });
        expect(kmz.size).toBeGreaterThan(BINARY_STRONG_BYTES);
        const res = await assessStreamEligibility(kmz);
        expect(res.stream).toBe(true);
    });

    it('streams large single-shapefile archives', async () => {
        const zip = await makeArchive('parcels.zip', {
            'parcels.shp': randomBytes(BINARY_STRONG_BYTES + 1024 * 1024),
            'parcels.dbf': randomBytes(512 * 1024),
            'parcels.prj': 'PROJCS["x"]'
        });
        const res = await assessStreamEligibility(zip);
        expect(res.stream).toBe(true);
    });

    it('streams a compact shapefile archive that expands past the text cap', async () => {
        // Zeros compress massively — small zip, huge uncompressed .shp.
        const zip = await makeArchive('sparse.zip', {
            'sparse.shp': new Uint8Array(TEXT_STRONG_BYTES + 1024 * 1024),
            'sparse.dbf': new Uint8Array(1024)
        });
        expect(zip.size).toBeLessThan(BINARY_STRONG_BYTES);
        const res = await assessStreamEligibility(zip);
        expect(res.stream).toBe(true);
    });

    it('keeps multi-shapefile archives on the standard path', async () => {
        const zip = await makeArchive('multi.zip', {
            'a.shp': randomBytes(BINARY_STRONG_BYTES + 1024 * 1024),
            'a.dbf': 'attrs',
            'b.shp': randomBytes(64 * 1024),
            'b.dbf': 'attrs'
        });
        const res = await assessStreamEligibility(zip);
        expect(res.stream).toBe(false);
        expect(res.reject).toBe(false);
    });

    it('keeps a genuinely small shapefile archive on the standard path', async () => {
        const zip = await makeArchive('tiny.zip', {
            'tiny.shp': randomBytes(64 * 1024),
            'tiny.dbf': randomBytes(16 * 1024)
        });
        const res = await assessStreamEligibility(zip);
        expect(res.stream).toBe(false);
        expect(res.reject).toBe(false);
    });

    it('streams a large zip that is a KMZ in disguise', async () => {
        const zip = await makeArchive('export.zip', {
            'layers/main.kml': randomBytes(BINARY_STRONG_BYTES + 1024 * 1024)
        });
        const res = await assessStreamEligibility(zip);
        expect(res.stream).toBe(true);
    });

    it('streams a small compressed kmz whose KML expands past the text cap', async () => {
        // Repetitive KML compresses 20-40x — the archive passes the binary cap
        // but the entry would blow the in-memory parser.
        const bigRepetitiveKml = '<kml><Document>'
            + '<Placemark><name>p</name><Point><coordinates>-111.9,40.7</coordinates></Point></Placemark>'.repeat(80000)
            + '</Document></kml>';
        const kmz = await makeArchive('compact.kmz', { 'doc.kml': bigRepetitiveKml });
        expect(kmz.size).toBeLessThan(BINARY_STRONG_BYTES);
        const res = await assessStreamEligibility(kmz);
        expect(res.stream).toBe(true);
    });

    it('keeps a genuinely small kmz on the standard path', async () => {
        const smallKml = '<kml><Document>'
            + '<Placemark><name>p</name><Point><coordinates>-111.9,40.7</coordinates></Point></Placemark>'.repeat(2000)
            + '</Document></kml>';
        const kmz = await makeArchive('small.kmz', { 'doc.kml': smallKml });
        const res = await assessStreamEligibility(kmz);
        expect(res.stream).toBe(false);
        expect(res.reject).toBe(false);
    });

    it('partitions mixed batches into stream/standard/rejected buckets', async () => {
        const files = [
            fakeFile('small.geojson', 1024),
            fakeFile('big.geojson', TEXT_STRONG_BYTES + 1),
            fakeFile('big.xlsx', 20 * 1024 * 1024),
            fakeFile('huge.csv', STREAM_MAX_BYTES + 1)
        ];
        const { streamFiles, standardFiles, rejectedFiles } = await partitionStreamingFiles(files);
        expect(streamFiles.map((f) => f.name)).toEqual(['big.geojson']);
        expect(standardFiles.map((f) => f.name)).toEqual(['small.geojson', 'big.xlsx']);
        expect(rejectedFiles.map((r) => r.file.name)).toEqual(['huge.csv']);
    });
});
