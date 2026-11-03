/**
 * OPFS staging for streamed exports — write incrementally, then download.
 * Falls back to in-memory Blob parts when OPFS is unavailable.
 */
import logger from '../core/logger.js';
import { isSourceStoreSupported, hasStorageHeadroom } from './source-file-store.js';

const STAGING_DIR = 'export-staging';

/** Drop staged files left behind by a crash or a closed tab. */
export const EXPORT_STAGING_STALE_MS = 60 * 60 * 1000;

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
                const type = file.type || 'application/octet-stream';
                // file.slice() stays bound to the OPFS file. Deleting the entry
                // before the browser reads it makes GeoJSON/CSV downloads empty.
                // Copy into a memory Blob first so the file can be removed.
                let blob;
                let copied = false;
                try {
                    const bytes = await file.arrayBuffer();
                    blob = new Blob([bytes], { type });
                    copied = true;
                } catch (copyErr) {
                    logger.warn('ExportStaging', 'Could not copy staged export into memory; keeping the file until sweep', {
                        error: copyErr?.message
                    });
                    blob = file.slice(0, file.size, type);
                }
                if (copied) {
                    try {
                        await dir2.removeEntry(entryName);
                    } catch {
                        /* best-effort cleanup */
                    }
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

/**
 * Remove staged export files older than maxAgeMs.
 * Called at startup so a crashed export cannot fill OPFS.
 * @param {number} [maxAgeMs]
 * @returns {Promise<number>} removed count
 */
export async function sweepExportStagingFiles(maxAgeMs = EXPORT_STAGING_STALE_MS) {
    if (!isExportStagingSupported()) return 0;
    let removed = 0;
    try {
        const dir = await _getStagingDir(false);
        if (typeof dir.entries !== 'function') return 0;
        const now = Date.now();
        for await (const [name, handle] of dir.entries()) {
            if (handle?.kind && handle.kind !== 'file') continue;
            try {
                const file = await handle.getFile();
                if (now - (file.lastModified || 0) <= maxAgeMs) continue;
                await dir.removeEntry(name);
                removed++;
            } catch {
                /* ignore one entry */
            }
        }
    } catch {
        /* staging directory does not exist yet */
    }
    return removed;
}

queueMicrotask(() => {
    void sweepExportStagingFiles();
});

export default {
    isExportStagingSupported,
    createExportStagingSession,
    sweepExportStagingFiles,
    EXPORT_STAGING_STALE_MS
};
