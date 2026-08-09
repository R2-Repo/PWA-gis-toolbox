/**
 * OPFS staging for streamed exports — write incrementally, then download.
 * Falls back to in-memory Blob parts when OPFS is unavailable.
 */
import logger from '../core/logger.js';
import { isSourceStoreSupported, hasStorageHeadroom } from './source-file-store.js';

const STAGING_DIR = 'export-staging';

/**
 * @returns {boolean}
 */
export function isExportStagingSupported() {
    return isSourceStoreSupported();
}

async function _getStagingDir(create = false) {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(STAGING_DIR, { create });
}

function _sanitizeName(name) {
    return String(name || 'export').replace(/[/\\:*?"<>|]/g, '_').slice(0, 150);
}

/**
 * Create a writable staging session.
 * @param {string} fileName
 * @returns {Promise<{
 *   key: string,
 *   supported: boolean,
 *   appendText: (chunk: string) => Promise<void>,
 *   finalize: () => Promise<{ blob: Blob, fileName: string }>,
 *   abort: () => Promise<void>
 * }>}
 */
export async function createExportStagingSession(fileName) {
    const safeName = _sanitizeName(fileName);
    const key = `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const entryName = `${key}__${safeName}`;

    if (!isExportStagingSupported()) {
        const parts = [];
        return {
            key,
            supported: false,
            async appendText(chunk) {
                if (chunk) parts.push(chunk);
            },
            async finalize() {
                return { blob: new Blob(parts, { type: 'application/octet-stream' }), fileName: safeName };
            },
            async abort() {
                parts.length = 0;
            }
        };
    }

    let writable = null;
    let aborted = false;
    try {
        // Soft quota check — exporters may not know final size up front.
        if (!(await hasStorageHeadroom(8 * 1024 * 1024))) {
            throw new Error('quota');
        }
        const dir = await _getStagingDir(true);
        const handle = await dir.getFileHandle(entryName, { create: true });
        writable = await handle.createWritable();
        return {
            key,
            supported: true,
            async appendText(chunk) {
                if (aborted || !chunk) return;
                await writable.write(chunk);
            },
            async finalize() {
                if (aborted) throw new Error('Staging session aborted');
                await writable.close();
                writable = null;
                const dir2 = await _getStagingDir(false);
                const fileHandle = await dir2.getFileHandle(entryName);
                const file = await fileHandle.getFile();
                const blob = file.slice(0, file.size, file.type || 'application/octet-stream');
                try {
                    await dir2.removeEntry(entryName);
                } catch {
                    /* best-effort cleanup */
                }
                return { blob, fileName: safeName };
            },
            async abort() {
                aborted = true;
                try {
                    await writable?.abort?.();
                } catch {
                    try { await writable?.close?.(); } catch { /* ignore */ }
                }
                writable = null;
                try {
                    const dir2 = await _getStagingDir(false);
                    await dir2.removeEntry(entryName);
                } catch {
                    /* ignore */
                }
            }
        };
    } catch (e) {
        logger.warn('ExportStaging', 'OPFS staging unavailable, using memory parts', { error: e?.message });
        const parts = [];
        return {
            key,
            supported: false,
            async appendText(chunk) {
                if (chunk) parts.push(chunk);
            },
            async finalize() {
                return { blob: new Blob(parts, { type: 'application/octet-stream' }), fileName: safeName };
            },
            async abort() {
                parts.length = 0;
            }
        };
    }
}

export default {
    isExportStagingSupported,
    createExportStagingSession
};
