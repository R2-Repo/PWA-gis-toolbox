/**
 * Incremental GeoJSON FeatureCollection parser.
 *
 * Consumes text chunks and emits one feature at a time, so the whole file never
 * has to exist in memory. Only the current feature's JSON text is buffered.
 * Pure module — safe in workers, main thread, and node tests.
 */

/** Refuse to buffer a single feature larger than this (pathological geometry). */
export const MAX_FEATURE_CHARS = 24 * 1024 * 1024;

const CH = {
    QUOTE: 34,      // "
    BACKSLASH: 92,  // \
    LBRACE: 123,    // {
    RBRACE: 125,    // }
    LBRACKET: 91,   // [
    RBRACKET: 93,   // ]
    COLON: 58,      // :
    COMMA: 44       // ,
};

const S = {
    SEEK_ROOT: 0,
    ROOT_KEY_OR_END: 1,
    KEY_STRING: 2,
    KEY_COLON: 3,
    VALUE_START: 4,
    AFTER_VALUE: 5,
    SKIP_CONTAINER: 6,
    SKIP_STRING: 7,
    SKIP_SCALAR: 8,
    FEATURES_SEEK: 9,
    FEATURE_CAPTURE: 10,
    FEATURES_SCALAR: 11,
    ROOT_DONE: 12
};

function _isWs(code) {
    return code === 32 || code === 9 || code === 10 || code === 13;
}

export class GeoJSONFeatureStreamParser {
    /**
     * @param {{ onFeature: (feature: object) => void, maxFeatureChars?: number }} options
     */
    constructor(options = {}) {
        this._onFeature = options.onFeature;
        this._maxFeatureChars = options.maxFeatureChars ?? MAX_FEATURE_CHARS;

        this._buf = '';
        this._pos = 0;
        this._state = S.SEEK_ROOT;

        this._key = '';
        this._inString = false;
        this._escape = false;
        this._containerDepth = 0;
        this._captureTypeValue = false;
        this._stringValue = '';

        // Feature capture: text carried over from previous chunks + start offset in current buffer.
        this._capture = '';
        this._captureStart = 0;
        this._featureDepth = 0;

        this.featureCount = 0;
        this.rootType = null;
        this.sawFeaturesArray = false;
        this.finished = false;
    }

    /**
     * @param {string} chunk
     */
    push(chunk) {
        if (this.finished) return;
        this._buf += chunk;
        this._scan();
        this._compact();
    }

    /** Call after the last chunk. Throws if the stream was not a FeatureCollection. */
    finish() {
        this._scan();
        this.finished = true;
        this._buf = '';
        this._pos = 0;
        if (!this.sawFeaturesArray) {
            throw new Error('No "features" array found — file is not a GeoJSON FeatureCollection.');
        }
        if (this.rootType && this.rootType !== 'FeatureCollection') {
            throw new Error(`Root "type" is "${this.rootType}" — expected "FeatureCollection".`);
        }
        return { featureCount: this.featureCount };
    }

    _compact() {
        if (this._state === S.FEATURE_CAPTURE) {
            this._capture += this._buf.slice(this._captureStart, this._pos);
            this._captureStart = 0;
            if (this._capture.length > this._maxFeatureChars) {
                throw new Error('A single feature exceeds the maximum supported size.');
            }
        }
        this._buf = this._buf.slice(this._pos);
        this._pos = 0;
    }

    _scan() {
        const buf = this._buf;
        const len = buf.length;
        let pos = this._pos;

        while (pos < len) {
            const code = buf.charCodeAt(pos);

            switch (this._state) {
                case S.SEEK_ROOT: {
                    if (_isWs(code)) { pos++; break; }
                    if (code !== CH.LBRACE) {
                        throw new Error('File does not start with a JSON object.');
                    }
                    pos++;
                    this._state = S.ROOT_KEY_OR_END;
                    break;
                }

                case S.ROOT_KEY_OR_END: {
                    if (_isWs(code) || code === CH.COMMA) { pos++; break; }
                    if (code === CH.RBRACE) { pos++; this._state = S.ROOT_DONE; break; }
                    if (code === CH.QUOTE) {
                        pos++;
                        this._key = '';
                        this._escape = false;
                        this._state = S.KEY_STRING;
                        break;
                    }
                    throw new Error('Invalid JSON: expected a key in the root object.');
                }

                case S.KEY_STRING: {
                    const end = this._consumeStringInto(buf, pos, len, (text) => { this._key += text; });
                    pos = end.pos;
                    if (end.closed) this._state = S.KEY_COLON;
                    break;
                }

                case S.KEY_COLON: {
                    if (_isWs(code)) { pos++; break; }
                    if (code !== CH.COLON) {
                        throw new Error('Invalid JSON: expected ":" after key.');
                    }
                    pos++;
                    this._state = S.VALUE_START;
                    break;
                }

                case S.VALUE_START: {
                    if (_isWs(code)) { pos++; break; }
                    if (this._key === 'features' && code === CH.LBRACKET) {
                        pos++;
                        this.sawFeaturesArray = true;
                        this._state = S.FEATURES_SEEK;
                        break;
                    }
                    if (code === CH.LBRACE || code === CH.LBRACKET) {
                        pos++;
                        this._containerDepth = 1;
                        this._inString = false;
                        this._escape = false;
                        this._state = S.SKIP_CONTAINER;
                        break;
                    }
                    if (code === CH.QUOTE) {
                        pos++;
                        this._captureTypeValue = this._key === 'type' && this.rootType == null;
                        this._stringValue = '';
                        this._escape = false;
                        this._state = S.SKIP_STRING;
                        break;
                    }
                    this._state = S.SKIP_SCALAR;
                    break;
                }

                case S.SKIP_CONTAINER: {
                    if (this._inString) {
                        pos = this._skipStringBody(buf, pos, len);
                        break;
                    }
                    if (code === CH.QUOTE) { this._inString = true; this._escape = false; pos++; break; }
                    if (code === CH.LBRACE || code === CH.LBRACKET) { this._containerDepth++; pos++; break; }
                    if (code === CH.RBRACE || code === CH.RBRACKET) {
                        this._containerDepth--;
                        pos++;
                        if (this._containerDepth === 0) this._state = S.AFTER_VALUE;
                        break;
                    }
                    pos++;
                    break;
                }

                case S.SKIP_STRING: {
                    const end = this._consumeStringInto(buf, pos, len, (text) => {
                        if (this._captureTypeValue) this._stringValue += text;
                    });
                    pos = end.pos;
                    if (end.closed) {
                        if (this._captureTypeValue) {
                            this.rootType = this._stringValue;
                            this._captureTypeValue = false;
                        }
                        this._state = S.AFTER_VALUE;
                    }
                    break;
                }

                case S.SKIP_SCALAR: {
                    if (_isWs(code) || code === CH.COMMA || code === CH.RBRACE || code === CH.RBRACKET) {
                        this._state = S.AFTER_VALUE;
                        break;
                    }
                    pos++;
                    break;
                }

                case S.AFTER_VALUE: {
                    if (_isWs(code)) { pos++; break; }
                    if (code === CH.COMMA) { pos++; this._state = S.ROOT_KEY_OR_END; break; }
                    if (code === CH.RBRACE) { pos++; this._state = S.ROOT_DONE; break; }
                    throw new Error('Invalid JSON: expected "," or "}" in root object.');
                }

                case S.FEATURES_SEEK: {
                    if (_isWs(code) || code === CH.COMMA) { pos++; break; }
                    if (code === CH.RBRACKET) { pos++; this._state = S.AFTER_VALUE; break; }
                    if (code === CH.LBRACE) {
                        this._capture = '';
                        this._captureStart = pos;
                        this._featureDepth = 0;
                        this._inString = false;
                        this._escape = false;
                        this._state = S.FEATURE_CAPTURE;
                        break;
                    }
                    // Tolerate stray scalars (e.g. null) inside the features array.
                    this._state = S.FEATURES_SCALAR;
                    break;
                }

                case S.FEATURES_SCALAR: {
                    if (_isWs(code) || code === CH.COMMA || code === CH.RBRACKET) {
                        this._state = S.FEATURES_SEEK;
                        break;
                    }
                    pos++;
                    break;
                }

                case S.FEATURE_CAPTURE: {
                    if (this._inString) {
                        pos = this._skipStringBody(buf, pos, len);
                        break;
                    }
                    if (code === CH.QUOTE) { this._inString = true; this._escape = false; pos++; break; }
                    if (code === CH.LBRACE) { this._featureDepth++; pos++; break; }
                    if (code === CH.RBRACE) {
                        this._featureDepth--;
                        pos++;
                        if (this._featureDepth === 0) {
                            const text = this._capture + buf.slice(this._captureStart, pos);
                            this._capture = '';
                            this._captureStart = 0;
                            this._emitFeature(text);
                            this._state = S.FEATURES_SEEK;
                        }
                        break;
                    }
                    pos++;
                    if (this._capture.length + (pos - this._captureStart) > this._maxFeatureChars) {
                        throw new Error('A single feature exceeds the maximum supported size.');
                    }
                    break;
                }

                case S.ROOT_DONE: {
                    // Ignore trailing whitespace/content after the root object.
                    pos = len;
                    break;
                }

                default:
                    throw new Error('Unknown parser state.');
            }
        }

        this._pos = pos;
    }

    _emitFeature(text) {
        let feature;
        try {
            feature = JSON.parse(text);
        } catch (e) {
            throw new Error(`Invalid JSON in feature ${this.featureCount + 1}: ${e.message}`);
        }
        this.featureCount++;
        this._onFeature?.(feature, text.length);
    }

    /**
     * Consume a string body (opening quote already consumed).
     * @returns {{ pos: number, closed: boolean }}
     */
    _consumeStringInto(buf, pos, len, sink) {
        let start = pos;
        while (pos < len) {
            const code = buf.charCodeAt(pos);
            if (this._escape) {
                this._escape = false;
                pos++;
                continue;
            }
            if (code === CH.BACKSLASH) {
                this._escape = true;
                pos++;
                continue;
            }
            if (code === CH.QUOTE) {
                sink(buf.slice(start, pos));
                return { pos: pos + 1, closed: true };
            }
            pos++;
        }
        sink(buf.slice(start, pos));
        return { pos, closed: false };
    }

    /** Advance through a string body when only tracking (no capture). */
    _skipStringBody(buf, pos, len) {
        while (pos < len) {
            const code = buf.charCodeAt(pos);
            if (this._escape) {
                this._escape = false;
                pos++;
                continue;
            }
            if (code === CH.BACKSLASH) {
                this._escape = true;
                pos++;
                continue;
            }
            if (code === CH.QUOTE) {
                this._inString = false;
                return pos + 1;
            }
            pos++;
        }
        return pos;
    }
}

export default { GeoJSONFeatureStreamParser, MAX_FEATURE_CHARS };
