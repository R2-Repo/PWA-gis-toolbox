import { describe, expect, it } from 'vitest';
import {
    assessStreamEligibility,
    partitionStreamingFiles,
    sniffJsonIsFeatureCollection,
    STREAM_MAX_BYTES
} from '../js/import/stream/stream-policy.js';
import { TEXT_STRONG_BYTES, TEXT_SOFT_BYTES } from '../js/import/import-preflight.js';

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

    it('does not stream unsupported formats (kml stays rejected by the guard)', async () => {
        const res = await assessStreamEligibility(fakeFile('big.kml', 50 * 1024 * 1024));
        expect(res.stream).toBe(false);
        expect(res.reject).toBe(false);
    });

    it('rejects streamable files above the streaming ceiling with a clear message', async () => {
        const res = await assessStreamEligibility(fakeFile('huge.geojson', STREAM_MAX_BYTES + 1));
        expect(res.stream).toBe(false);
        expect(res.reject).toBe(true);
        expect(res.message).toMatch(/high-capacity import limit/);
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

    it('partitions mixed batches into stream/standard/rejected buckets', async () => {
        const files = [
            fakeFile('small.geojson', 1024),
            fakeFile('big.geojson', TEXT_STRONG_BYTES + 1),
            fakeFile('big.kml', 20 * 1024 * 1024),
            fakeFile('huge.csv', STREAM_MAX_BYTES + 1)
        ];
        const { streamFiles, standardFiles, rejectedFiles } = await partitionStreamingFiles(files);
        expect(streamFiles.map((f) => f.name)).toEqual(['big.geojson']);
        expect(standardFiles.map((f) => f.name)).toEqual(['small.geojson', 'big.kml']);
        expect(rejectedFiles.map((r) => r.file.name)).toEqual(['huge.csv']);
    });
});
