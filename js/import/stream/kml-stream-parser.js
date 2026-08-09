/**
 * Incremental KML scanner — extracts complete <Placemark> blocks (and shared
 * <Style>/<StyleMap>/<Schema> blocks) from streamed XML text without building
 * a DOM for the whole document.
 *
 * Handles CDATA sections (which may contain "</Placemark>"), XML comments,
 * processing instructions, DOCTYPE, quoted attribute values, namespace
 * prefixes, and arbitrary chunk boundaries. Pure module — worker/test safe.
 */

/** Refuse to buffer a single block larger than this (pathological placemark). */
export const MAX_KML_BLOCK_CHARS = 10 * 1024 * 1024;

const CAPTURE_KINDS = new Set(['Placemark', 'Style', 'StyleMap', 'Schema']);

const M = {
    TEXT: 0,
    COMMENT: 1,
    CDATA: 2,
    PI: 3,
    BANG: 4,
    TAG: 5
};

function _localName(name) {
    const idx = name.indexOf(':');
    return idx >= 0 ? name.slice(idx + 1) : name;
}

function _isNameEnd(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '>' || ch === '/';
}

export class KmlPlacemarkStreamParser {
    /**
     * @param {{
     *   onPlacemark: (blockText: string) => void,
     *   onSharedBlock?: (kind: string, id: string|null, blockText: string) => void,
     *   maxBlockChars?: number
     * }} options
     */
    constructor(options = {}) {
        this._onPlacemark = options.onPlacemark;
        this._onSharedBlock = options.onSharedBlock;
        this._maxBlockChars = options.maxBlockChars ?? MAX_KML_BLOCK_CHARS;

        this._buf = '';
        this._pos = 0;
        this._mode = M.TEXT;

        // TAG mode state
        this._tagStart = 0;      // index of '<' in current buffer
        this._tagQuote = null;   // '"' | "'" | null

        // Capture state
        this._captureKind = null;
        this._captureDepth = 0;
        this._captureStart = 0;  // index in current buffer
        this._capture = '';      // text carried across compactions

        /** Raw text of the root <kml ...> opening tag (namespace declarations). */
        this.rootTag = null;
        this.placemarkCount = 0;
        this.finished = false;
    }

    /** @param {string} chunk */
    push(chunk) {
        if (this.finished) return;
        this._buf += chunk;
        this._scan();
        this._compact();
    }

    finish() {
        this._scan();
        this.finished = true;
        const truncated = this._captureKind != null;
        this._buf = '';
        this._pos = 0;
        if (truncated) {
            throw new Error('KML ended in the middle of an element — file appears truncated.');
        }
        return { placemarkCount: this.placemarkCount };
    }

    _compact() {
        // Everything before keep-point is either consumed or part of the capture.
        let keep = this._pos;
        if (this._mode === M.TAG) keep = Math.min(keep, this._tagStart);
        if (this._captureKind != null) {
            this._capture += this._buf.slice(this._captureStart, keep);
            this._captureStart = 0;
            if (this._capture.length > this._maxBlockChars) {
                throw new Error(`A single <${this._captureKind}> exceeds the maximum supported size.`);
            }
        }
        this._buf = this._buf.slice(keep);
        this._pos -= keep;
        this._tagStart -= keep;
        if (this._tagStart < 0) this._tagStart = 0;
    }

    _scan() {
        while (true) {
            const buf = this._buf;
            const len = buf.length;
            let pos = this._pos;
            if (pos >= len) break;

            if (this._mode === M.TEXT) {
                const lt = buf.indexOf('<', pos);
                if (lt < 0) {
                    this._pos = len;
                    break;
                }
                // Classify — needs up to 9 chars ('<![CDATA[').
                if (lt + 9 > len && !this.finished) {
                    // Wait for more data unless this is truly a decidable prefix.
                    const rest = buf.slice(lt, len);
                    if ('<![CDATA['.startsWith(rest) || '<!--'.startsWith(rest)) {
                        this._pos = lt;
                        break;
                    }
                }
                if (buf.startsWith('<!--', lt)) {
                    this._mode = M.COMMENT;
                    this._pos = lt + 4;
                    continue;
                }
                if (buf.startsWith('<![CDATA[', lt)) {
                    this._mode = M.CDATA;
                    this._pos = lt + 9;
                    continue;
                }
                if (buf.startsWith('<?', lt)) {
                    this._mode = M.PI;
                    this._pos = lt + 2;
                    continue;
                }
                if (buf.startsWith('<!', lt)) {
                    this._mode = M.BANG;
                    this._pos = lt + 2;
                    continue;
                }
                this._mode = M.TAG;
                this._tagStart = lt;
                this._tagQuote = null;
                this._pos = lt + 1;
                continue;
            }

            if (this._mode === M.COMMENT) {
                const end = buf.indexOf('-->', pos);
                if (end < 0) {
                    this._pos = Math.max(pos, len - 2);
                    break;
                }
                this._pos = end + 3;
                this._mode = M.TEXT;
                continue;
            }

            if (this._mode === M.CDATA) {
                const end = buf.indexOf(']]>', pos);
                if (end < 0) {
                    this._pos = Math.max(pos, len - 2);
                    break;
                }
                this._pos = end + 3;
                this._mode = M.TEXT;
                continue;
            }

            if (this._mode === M.PI) {
                const end = buf.indexOf('?>', pos);
                if (end < 0) {
                    this._pos = Math.max(pos, len - 1);
                    break;
                }
                this._pos = end + 2;
                this._mode = M.TEXT;
                continue;
            }

            if (this._mode === M.BANG) {
                const end = buf.indexOf('>', pos);
                if (end < 0) {
                    this._pos = len;
                    break;
                }
                this._pos = end + 1;
                this._mode = M.TEXT;
                continue;
            }

            // M.TAG — scan for the closing '>' honoring attribute quotes.
            let i = pos;
            let closed = -1;
            while (i < len) {
                const ch = buf[i];
                if (this._tagQuote) {
                    if (ch === this._tagQuote) this._tagQuote = null;
                } else if (ch === '"' || ch === "'") {
                    this._tagQuote = ch;
                } else if (ch === '>') {
                    closed = i;
                    break;
                }
                i++;
            }
            if (closed < 0) {
                this._pos = len;
                break;
            }
            this._pos = closed + 1;
            this._mode = M.TEXT;
            this._handleTag(buf, this._tagStart, closed);
        }

        // Enforce block-size cap without waiting for compaction.
        if (this._captureKind != null) {
            const pending = this._capture.length + (this._pos - this._captureStart);
            if (pending > this._maxBlockChars) {
                throw new Error(`A single <${this._captureKind}> exceeds the maximum supported size.`);
            }
        }
    }

    /**
     * @param {string} buf
     * @param {number} start index of '<'
     * @param {number} end index of '>'
     */
    _handleTag(buf, start, end) {
        const isClosing = buf[start + 1] === '/';
        const nameStart = start + (isClosing ? 2 : 1);
        let nameEnd = nameStart;
        while (nameEnd < end && !_isNameEnd(buf[nameEnd])) nameEnd++;
        const local = _localName(buf.slice(nameStart, nameEnd).trim());
        const selfClosing = !isClosing && buf[end - 1] === '/';

        if (!isClosing && this.rootTag == null && local === 'kml') {
            this.rootTag = buf.slice(start, end + 1);
        }

        if (this._captureKind == null) {
            if (!isClosing && CAPTURE_KINDS.has(local)) {
                if (selfClosing) {
                    this._emitBlock(local, buf.slice(start, end + 1));
                    return;
                }
                this._captureKind = local;
                this._captureDepth = 1;
                this._captureStart = start;
                this._capture = '';
            }
            return;
        }

        // Inside a capture — track nesting of the same element name only.
        if (local === this._captureKind) {
            if (isClosing) {
                this._captureDepth--;
                if (this._captureDepth === 0) {
                    const text = this._capture + buf.slice(this._captureStart, end + 1);
                    this._capture = '';
                    const kind = this._captureKind;
                    this._captureKind = null;
                    if (text.length > this._maxBlockChars) {
                        throw new Error(`A single <${kind}> exceeds the maximum supported size.`);
                    }
                    this._emitBlock(kind, text);
                }
            } else if (!selfClosing) {
                this._captureDepth++;
            }
        }
    }

    _emitBlock(kind, text) {
        if (kind === 'Placemark') {
            this.placemarkCount++;
            this._onPlacemark?.(text);
            return;
        }
        const idMatch = /^<[^>]*?\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(text);
        this._onSharedBlock?.(kind, idMatch ? (idMatch[1] ?? idMatch[2]) : null, text);
    }
}

export default { KmlPlacemarkStreamParser, MAX_KML_BLOCK_CHARS };
