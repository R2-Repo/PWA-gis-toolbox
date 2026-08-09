/**
 * Pull-based exact-length reader over a ReadableStream<Uint8Array>.
 * Lets fixed-length binary formats (SHP/DBF records) stream without ever
 * holding the whole file. Pure module — worker/test safe.
 */

export function createByteReader(stream) {
    const reader = stream.getReader();
    /** @type {Uint8Array[]} */
    let chunks = [];
    let buffered = 0;
    let done = false;
    let consumed = 0;

    async function _fill(target) {
        while (buffered < target && !done) {
            const { done: d, value } = await reader.read();
            if (d) {
                done = true;
                break;
            }
            if (value?.byteLength) {
                chunks.push(value);
                buffered += value.byteLength;
            }
        }
    }

    function _take(n) {
        const out = new Uint8Array(n);
        let filled = 0;
        while (filled < n) {
            const head = chunks[0];
            const need = n - filled;
            if (head.byteLength <= need) {
                out.set(head, filled);
                filled += head.byteLength;
                chunks.shift();
            } else {
                out.set(head.subarray(0, need), filled);
                chunks[0] = head.subarray(need);
                filled += need;
            }
        }
        buffered -= n;
        consumed += n;
        return out;
    }

    return {
        /** Total bytes handed out so far (for progress). */
        get bytesConsumed() {
            return consumed;
        },

        /**
         * Read exactly n bytes; returns null at clean EOF (0 bytes available).
         * Throws when the stream ends mid-record.
         * @param {number} n
         * @returns {Promise<Uint8Array|null>}
         */
        async readExact(n) {
            if (n === 0) return new Uint8Array(0);
            await _fill(n);
            if (buffered === 0 && done) return null;
            if (buffered < n) {
                throw new Error('Unexpected end of stream (truncated record).');
            }
            return _take(n);
        },

        /**
         * Read up to n bytes (whatever is available); null at EOF.
         * @param {number} n
         */
        async readUpTo(n) {
            await _fill(1);
            if (buffered === 0 && done) return null;
            return _take(Math.min(n, buffered));
        },

        async cancel() {
            try {
                await reader.cancel();
            } catch { /* already closed */ }
            chunks = [];
            buffered = 0;
            done = true;
        }
    };
}

export default { createByteReader };
