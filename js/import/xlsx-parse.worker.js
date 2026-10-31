/**
 * Parse XLSX in a worker with sanitized row objects (null prototype keys).
 */
import { parseXlsxArrayBuffer } from './xlsx-parse-lib.js';

self.onmessage = (event) => {
    const { buffer, requestId } = event.data || {};
    try {
        if (!buffer) {
            self.postMessage({ requestId, error: 'Missing buffer' });
            return;
        }
        const parsed = parseXlsxArrayBuffer(buffer);
        self.postMessage({ requestId, ...parsed });
    } catch (err) {
        self.postMessage({
            requestId,
            error: err?.message || 'Failed to parse Excel file'
        });
    }
};
