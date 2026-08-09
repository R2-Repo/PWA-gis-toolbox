import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
    readZipEntries,
    openZipEntryStream,
    readZipEntryHead,
    chooseMainKmlZipEntry,
    supportsZipStreaming
} from '../js/import/stream/zip-central-directory.js';

async function makeZipFile(entries, { compression = 'DEFLATE', name = 'test.kmz' } = {}) {
    const zip = new JSZip();
    for (const [path, content] of Object.entries(entries)) {
        zip.file(path, content);
    }
    const bytes = await zip.generateAsync({ type: 'uint8array', compression });
    return new File([bytes], name, { type: 'application/zip' });
}

async function streamToText(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
}

const KML_TEXT = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${
    '<Placemark><name>p</name><Point><coordinates>-111.9,40.7</coordinates></Point></Placemark>'.repeat(200)
}</Document></kml>`;

describe('zip-central-directory', () => {
    it('environment supports DecompressionStream', () => {
        expect(supportsZipStreaming()).toBe(true);
    });

    it('lists entries with sizes and offsets', async () => {
        const file = await makeZipFile({ 'doc.kml': KML_TEXT, 'images/icon.png': 'PNGDATA' });
        const entries = await readZipEntries(file);
        const names = entries.map((e) => e.name).sort();
        expect(names).toContain('doc.kml');
        expect(names).toContain('images/icon.png');
        const doc = entries.find((e) => e.name === 'doc.kml');
        expect(doc.uncompressedSize).toBe(KML_TEXT.length);
        expect(doc.compressedSize).toBeGreaterThan(0);
        expect(doc.compressedSize).toBeLessThan(KML_TEXT.length);
    });

    it('streams a deflated entry back to the original text', async () => {
        const file = await makeZipFile({ 'doc.kml': KML_TEXT });
        const entries = await readZipEntries(file);
        const stream = await openZipEntryStream(file, entries[0]);
        expect(await streamToText(stream)).toBe(KML_TEXT);
    });

    it('streams a stored (uncompressed) entry', async () => {
        const file = await makeZipFile({ 'doc.kml': KML_TEXT }, { compression: 'STORE' });
        const entries = await readZipEntries(file);
        expect(entries[0].method).toBe(0);
        const stream = await openZipEntryStream(file, entries[0]);
        expect(await streamToText(stream)).toBe(KML_TEXT);
    });

    it('readZipEntryHead returns only the head', async () => {
        const file = await makeZipFile({ 'doc.kml': KML_TEXT });
        const entries = await readZipEntries(file);
        const head = await readZipEntryHead(file, entries[0], 100);
        expect(head.length).toBeLessThanOrEqual(100);
        expect(KML_TEXT.startsWith(head)).toBe(true);
    });

    it('chooseMainKmlZipEntry prefers doc.kml, then shallow/largest', async () => {
        const prefer = chooseMainKmlZipEntry([
            { name: 'other.kml', isDir: false, uncompressedSize: 10 },
            { name: 'doc.kml', isDir: false, uncompressedSize: 5 }
        ]);
        expect(prefer.entry.name).toBe('doc.kml');
        expect(prefer.reason).toBe('root-doc.kml');

        const heuristic = chooseMainKmlZipEntry([
            { name: 'deep/nested/x.kml', isDir: false, uncompressedSize: 100 },
            { name: 'main.kml', isDir: false, uncompressedSize: 50 }
        ]);
        expect(heuristic.entry.name).toBe('main.kml');

        expect(chooseMainKmlZipEntry([{ name: 'data.shp', isDir: false }])).toBeNull();
    });

    it('rejects non-zip input', async () => {
        const file = new File(['this is not a zip archive at all'], 'x.zip');
        await expect(readZipEntries(file)).rejects.toThrow(/central directory/i);
    });
});
