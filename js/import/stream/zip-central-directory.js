/**
 * Minimal ZIP central-directory reader + entry streaming.
 *
 * Lets the app inspect an archive (KMZ / zipped data) and stream-decompress a
 * single entry WITHOUT loading or extracting the whole archive — the key to
 * high-capacity KMZ imports. Pure module (Blob + DecompressionStream); safe in
 * workers, main thread, and node tests.
 */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** EOCD record is 22 bytes + up to 65535 bytes of archive comment. */
const EOCD_SEARCH_BYTES = 22 + 65535;

export function supportsZipStreaming() {
    return typeof DecompressionStream !== 'undefined';
}

/**
 * @param {Blob} file
 * @returns {Promise<Array<{
 *   name: string, isDir: boolean, method: number,
 *   compressedSize: number, uncompressedSize: number, localHeaderOffset: number
 * }>>}
 */
export async function readZipEntries(file) {
    const size = file.size ?? 0;
    if (size < 22) throw new Error('Not a ZIP archive (too small).');

    const tailLen = Math.min(size, EOCD_SEARCH_BYTES);
    const tail = new DataView(await file.slice(size - tailLen, size).arrayBuffer());

    let eocdPos = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
        if (tail.getUint32(i, true) === EOCD_SIG) {
            eocdPos = i;
            break;
        }
    }
    if (eocdPos < 0) throw new Error('ZIP central directory not found.');

    const entryCount = tail.getUint16(eocdPos + 10, true);
    const cdSize = tail.getUint32(eocdPos + 12, true);
    const cdOffset = tail.getUint32(eocdPos + 16, true);
    if (cdOffset === 0xffffffff || entryCount === 0xffff) {
        throw new Error('ZIP64 archives are not supported.');
    }
    if (cdOffset + cdSize > size) throw new Error('Corrupt ZIP central directory.');

    const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const decoder = new TextDecoder();
    const entries = [];
    let pos = 0;

    for (let i = 0; i < entryCount && pos + 46 <= cd.byteLength; i++) {
        if (cd.getUint32(pos, true) !== CEN_SIG) break;
        const method = cd.getUint16(pos + 10, true);
        const compressedSize = cd.getUint32(pos + 20, true);
        const uncompressedSize = cd.getUint32(pos + 24, true);
        const nameLen = cd.getUint16(pos + 28, true);
        const extraLen = cd.getUint16(pos + 30, true);
        const commentLen = cd.getUint16(pos + 32, true);
        const localHeaderOffset = cd.getUint32(pos + 42, true);
        const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + pos + 46, nameLen));

        entries.push({
            name,
            isDir: name.endsWith('/'),
            method,
            compressedSize,
            uncompressedSize,
            localHeaderOffset
        });
        pos += 46 + nameLen + extraLen + commentLen;
    }

    return entries;
}

/**
 * Open a readable stream of an entry's decompressed bytes.
 * @param {Blob} file
 * @param {{ method: number, compressedSize: number, localHeaderOffset: number, name: string }} entry
 * @returns {Promise<ReadableStream<Uint8Array>>}
 */
export async function openZipEntryStream(file, entry) {
    const headerStart = entry.localHeaderOffset;
    const header = new DataView(await file.slice(headerStart, headerStart + 30).arrayBuffer());
    if (header.getUint32(0, true) !== LOC_SIG) {
        throw new Error(`Corrupt ZIP local header for "${entry.name}".`);
    }
    const nameLen = header.getUint16(26, true);
    const extraLen = header.getUint16(28, true);
    const dataStart = headerStart + 30 + nameLen + extraLen;
    const raw = file.slice(dataStart, dataStart + entry.compressedSize).stream();

    if (entry.method === 0) return raw;
    if (entry.method === 8) {
        if (!supportsZipStreaming()) {
            throw new Error('This browser does not support streaming decompression.');
        }
        return raw.pipeThrough(new DecompressionStream('deflate-raw'));
    }
    throw new Error(`Unsupported ZIP compression method ${entry.method} for "${entry.name}".`);
}

/**
 * Read up to maxBytes of an entry's decompressed content as text (for sniffing).
 * @param {Blob} file
 * @param {object} entry
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
export async function readZipEntryHead(file, entry, maxBytes = 384 * 1024) {
    const stream = await openZipEntryStream(file, entry);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
        while (text.length < maxBytes) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
        }
    } finally {
        try {
            await reader.cancel();
        } catch { /* stream may already be closed */ }
    }
    return text.slice(0, maxBytes);
}

/**
 * Real data entry — skips directories, macOS resource forks, and dotfiles.
 * @param {{ name: string, isDir: boolean }} entry
 */
export function isRealZipEntry(entry) {
    if (!entry || entry.isDir) return false;
    const name = String(entry.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (name.startsWith('__MACOSX/')) return false;
    const base = name.split('/').pop();
    return !!base && !base.startsWith('.');
}

/**
 * Pick the primary KML entry (mirrors parsers/parse-kmz-buffer chooseMainKmlEntry).
 * @param {Array<object>} entries from readZipEntries
 * @returns {{ entry: object, reason: string }|null}
 */
export function chooseMainKmlZipEntry(entries) {
    const norm = (name) => String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const kmlEntries = (entries || []).filter(
        (e) => !e.isDir && norm(e.name).toLowerCase().endsWith('.kml')
    );
    if (!kmlEntries.length) return null;
    if (kmlEntries.length === 1) return { entry: kmlEntries[0], reason: 'only-kml' };

    const rootDoc = kmlEntries.find((e) => norm(e.name).toLowerCase() === 'doc.kml');
    if (rootDoc) return { entry: rootDoc, reason: 'root-doc.kml' };
    const nestedDoc = kmlEntries.find((e) => norm(e.name).toLowerCase().endsWith('/doc.kml'));
    if (nestedDoc) return { entry: nestedDoc, reason: 'nested-doc.kml' };

    const sorted = [...kmlEntries].sort((a, b) => {
        const da = norm(a.name).split('/').filter(Boolean).length;
        const db = norm(b.name).split('/').filter(Boolean).length;
        if (da !== db) return da - db;
        if (b.uncompressedSize !== a.uncompressedSize) return b.uncompressedSize - a.uncompressedSize;
        return norm(a.name).length - norm(b.name).length;
    });
    return { entry: sorted[0], reason: 'heuristic-shallow-largest' };
}

export default {
    supportsZipStreaming,
    readZipEntries,
    openZipEntryStream,
    readZipEntryHead,
    isRealZipEntry,
    chooseMainKmlZipEntry
};
