/**
 * Streaming .dbf (dBASE III) attribute parser — fixed-length records read one
 * at a time from a byte reader. Pure module.
 */

/**
 * @param {string|null} cpgText contents of the sidecar .cpg, if any
 * @returns {TextDecoder}
 */
export function decoderFromCpg(cpgText) {
    const label = String(cpgText || '').trim().toLowerCase();
    const candidates = [];
    if (label) {
        if (/^(utf-?8)$/.test(label)) candidates.push('utf-8');
        else if (/^(88591|iso-?8859-?1|latin1)$/.test(label)) candidates.push('latin1');
        else candidates.push(label);
    }
    candidates.push('latin1'); // shpjs default
    for (const enc of candidates) {
        try {
            return new TextDecoder(enc);
        } catch { /* unsupported label — try next */ }
    }
    return new TextDecoder('utf-8');
}

/**
 * Read + parse the DBF header (fixed 32 bytes then field descriptors).
 * @param {ReturnType<import('./byte-reader.js').createByteReader>} byteReader
 * @returns {Promise<{ recordCount: number, recordLen: number, fields: Array<{ name: string, type: string, length: number, decimal: number }> }>}
 */
export async function readDbfHeader(byteReader, decoder = new TextDecoder('latin1')) {
    const head = await byteReader.readExact(32);
    if (!head) throw new Error('Empty .dbf file.');
    const dv = new DataView(head.buffer, head.byteOffset, 32);
    const recordCount = dv.getUint32(4, true);
    const headerLen = dv.getUint16(8, true);
    const recordLen = dv.getUint16(10, true);
    if (headerLen < 33) throw new Error('Corrupt .dbf header.');

    const rest = await byteReader.readExact(headerLen - 32);
    if (!rest) throw new Error('Truncated .dbf header.');

    const fields = [];
    let pos = 0;
    while (pos + 32 <= rest.byteLength && rest[pos] !== 0x0d) {
        let nameEnd = pos;
        while (nameEnd < pos + 11 && rest[nameEnd] !== 0) nameEnd++;
        const name = decoder.decode(rest.subarray(pos, nameEnd)).trim();
        fields.push({
            name,
            type: String.fromCharCode(rest[pos + 11]),
            length: rest[pos + 16],
            decimal: rest[pos + 17]
        });
        pos += 32;
    }

    return { recordCount, recordLen, fields };
}

function _parseValue(text, field) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    switch (field.type) {
        case 'N':
        case 'F': {
            const n = parseFloat(trimmed);
            return Number.isFinite(n) ? n : null;
        }
        case 'L':
            if (/^[yt]$/i.test(trimmed)) return true;
            if (/^[nf]$/i.test(trimmed)) return false;
            return null;
        case 'D':
            if (/^\d{8}$/.test(trimmed)) {
                return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
            }
            return trimmed;
        default:
            return trimmed;
    }
}

/**
 * Async generator of property objects from a .dbf byte reader.
 * Deleted-flag records are still yielded (they pair positionally with .shp
 * records, matching common shapefile tooling).
 * @param {ReturnType<import('./byte-reader.js').createByteReader>} byteReader
 * @param {TextDecoder} [decoder]
 */
export async function* iterateDbfRecords(byteReader, decoder = new TextDecoder('latin1')) {
    const header = await readDbfHeader(byteReader, decoder);
    const { recordLen, fields, recordCount } = header;

    for (let r = 0; r < recordCount; r++) {
        const rec = await byteReader.readExact(recordLen);
        if (rec == null) break;
        if (rec[0] === 0x1a) break; // EOF marker where a record was expected
        const props = {};
        let pos = 1; // skip deletion flag
        for (const field of fields) {
            const raw = decoder.decode(rec.subarray(pos, pos + field.length));
            props[field.name] = _parseValue(raw, field);
            pos += field.length;
        }
        yield props;
    }
}

export default { decoderFromCpg, readDbfHeader, iterateDbfRecords };
