/**
 * OPFS source preservation — keeps the original uploaded file on disk so
 * optimized/streamed layers can be reprocessed or re-exported from source.
 * Falls back gracefully (returns { ok: false }) when OPFS is unavailable.
 */
import logger from '../core/logger.js';

const SOURCE_DIR = 'import-sources';
const KEY_SEPARATOR = '__';

let _supported = null;

/** OPFS with writable streams (Chrome/Edge/Firefox; not all Safari versions). */
export function isSourceStoreSupported() {
    if (_supported != null) return _supported;
    try {
        _supported = typeof navigator !== 'undefined'
            && !!navigator.storage?.getDirectory
            && typeof FileSystemFileHandle !== 'undefined'
            && typeof FileSystemFileHandle.prototype.createWritable === 'function';
    } catch {
        _supported = false;
    }
    return _supported;
}

async function _getSourceDir(create = false) {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(SOURCE_DIR, { create });
}

function _sanitizeName(name) {
    return String(name || 'source').replace(/[/\\:*?"<>|]/g, '_').slice(0, 150);
}

function _entryName(key, fileName) {
    return `${key}${KEY_SEPARATOR}${_sanitizeName(fileName)}`;
}

/**
 * @param {number} extraBytes
 * @returns {Promise<boolean>} whether quota likely allows writing extraBytes
 */
export async function hasStorageHeadroom(extraBytes) {
    try {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        if (!quota) return true;
        return usage + extraBytes * 1.1 < quota;
    } catch {
        return true;
    }
}

/**
 * Copy the original file into OPFS.
 * @param {string} key stable source key stored on the dataset (source.opfsKey)
 * @param {File} file
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function saveSourceFile(key, file, options = {}) {
    if (!isSourceStoreSupported()) {
        return { ok: false, reason: 'unsupported' };
    }
    const signal = options.signal;
    if (signal?.aborted) {
        return { ok: false, reason: 'aborted' };
    }

    let writable = null;
    try {
        if (!(await hasStorageHeadroom(file.size ?? 0))) {
            return { ok: false, reason: 'quota' };
        }
        const dir = await _getSourceDir(true);
        const handle = await dir.getFileHandle(_entryName(key, file.name), { create: true });
        writable = await handle.createWritable();

        const onAbort = () => {
            try {
                void writable?.abort?.();
            } catch { /* ignore */ }
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        try {
            if (signal?.aborted) {
                onAbort();
                await removeSourceFile(key);
                return { ok: false, reason: 'aborted' };
            }
            // Prefer abortable pipe when the runtime supports signal on pipeTo.
            const stream = file.stream();
            try {
                await stream.pipeTo(writable, signal ? { signal } : undefined);
                writable = null;
            } catch (pipeErr) {
                if (signal?.aborted || pipeErr?.name === 'AbortError') {
                    try {
                        await writable?.abort?.();
                    } catch { /* ignore */ }
                    writable = null;
                    await removeSourceFile(key);
                    return { ok: false, reason: 'aborted' };
                }
                throw pipeErr;
            }
        } finally {
            signal?.removeEventListener('abort', onAbort);
        }

        if (signal?.aborted) {
            await removeSourceFile(key);
            return { ok: false, reason: 'aborted' };
        }
        return { ok: true };
    } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') {
            try {
                await writable?.abort?.();
            } catch { /* ignore */ }
            await removeSourceFile(key);
            return { ok: false, reason: 'aborted' };
        }
        logger.warn('SourceStore', 'Failed to preserve source file', { key, error: e?.message });
        await removeSourceFile(key);
        return { ok: false, reason: e?.message || 'write_failed' };
    }
}

/**
 * @param {string} key
 * @returns {Promise<File|null>} the preserved original file, or null
 */
export async function getSourceFile(key) {
    if (!isSourceStoreSupported()) return null;
    try {
        const dir = await _getSourceDir(false);
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'file' && name.startsWith(`${key}${KEY_SEPARATOR}`)) {
                const file = await handle.getFile();
                const originalName = name.slice(key.length + KEY_SEPARATOR.length);
                return new File([file], originalName, { type: file.type });
            }
        }
    } catch {
        /* missing dir or entry */
    }
    return null;
}

/**
 * @param {string} key
 */
export async function removeSourceFile(key) {
    if (!isSourceStoreSupported() || !key) return;
    try {
        const dir = await _getSourceDir(false);
        const toRemove = [];
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'file' && name.startsWith(`${key}${KEY_SEPARATOR}`)) {
                toRemove.push(name);
            }
        }
        for (const name of toRemove) {
            await dir.removeEntry(name);
        }
    } catch {
        /* already gone */
    }
}

/**
 * Remove the preserved source when no remaining layer references it.
 * Multiple layers can share one source file (mixed-geometry imports).
 * @param {string} key
 * @param {Array<{ source?: { opfsKey?: string } }>} remainingLayers
 */
export async function removeSourceFileIfUnreferenced(key, remainingLayers) {
    if (!key) return;
    const stillUsed = (remainingLayers || []).some((l) => l?.source?.opfsKey === key);
    if (!stillUsed) {
        await removeSourceFile(key);
    }
}

/**
 * @returns {Promise<Array<{ key: string, name: string, size: number, lastModified: number }>>}
 */
export async function listSourceFiles() {
    if (!isSourceStoreSupported()) return [];
    const out = [];
    try {
        const dir = await _getSourceDir(false);
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind !== 'file') continue;
            const sep = name.indexOf(KEY_SEPARATOR);
            if (sep <= 0) continue;
            const file = await handle.getFile();
            out.push({
                key: name.slice(0, sep),
                name: name.slice(sep + KEY_SEPARATOR.length),
                size: file.size,
                lastModified: file.lastModified
            });
        }
    } catch {
        /* no dir yet */
    }
    return out;
}

export default {
    isSourceStoreSupported,
    hasStorageHeadroom,
    saveSourceFile,
    getSourceFile,
    removeSourceFile,
    removeSourceFileIfUnreferenced,
    listSourceFiles
};
