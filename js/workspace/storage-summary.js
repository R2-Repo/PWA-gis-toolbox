/**
 * Storage / OPFS source inventory helpers for the Storage Manager UI.
 */
import {
    isSourceStoreSupported,
    listSourceFiles,
    removeSourceFile,
    removeSourceFileIfUnreferenced
} from './source-file-store.js';

/**
 * @returns {Promise<{ supported: boolean, usage: number, quota: number, usageRatio: number }>}
 */
export async function getStorageQuotaSummary() {
    const supported = isSourceStoreSupported();
    try {
        const { usage = 0, quota = 0 } = await navigator.storage?.estimate?.() || {};
        return {
            supported,
            usage,
            quota,
            usageRatio: quota > 0 ? usage / quota : 0
        };
    } catch {
        return { supported, usage: 0, quota: 0, usageRatio: 0 };
    }
}

/**
 * @param {Array<{ id?: string, name?: string, source?: { opfsKey?: string } }>} layers
 * @returns {Promise<Array<{
 *   key: string,
 *   name: string,
 *   size: number,
 *   lastModified: number,
 *   layerIds: string[],
 *   layerNames: string[],
 *   referenced: boolean
 * }>>}
 */
export async function listPreservedSourcesWithRefs(layers = []) {
    const files = await listSourceFiles();
    return files.map((file) => {
        const refs = (layers || []).filter((layer) => layer?.source?.opfsKey === file.key);
        return {
            ...file,
            layerIds: refs.map((l) => l.id).filter(Boolean),
            layerNames: refs.map((l) => l.name || l.id).filter(Boolean),
            referenced: refs.length > 0
        };
    }).sort((a, b) => (b.size || 0) - (a.size || 0));
}

/**
 * @param {string} key
 * @param {object[]} layers
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function removePreservedSource(key, layers = [], options = {}) {
    if (!key) return { ok: false, reason: 'missing_key' };
    const referenced = (layers || []).some((layer) => layer?.source?.opfsKey === key);
    if (referenced && !options.force) {
        return { ok: false, reason: 'referenced' };
    }
    if (options.force) {
        await removeSourceFile(key);
    } else {
        await removeSourceFileIfUnreferenced(key, layers);
    }
    return { ok: true };
}

/**
 * Remove every OPFS source that no remaining layer references.
 * @param {object[]} layers
 * @returns {Promise<number>} removed count
 */
export async function removeUnreferencedSources(layers = []) {
    const files = await listSourceFiles();
    let removed = 0;
    for (const file of files) {
        const stillUsed = (layers || []).some((layer) => layer?.source?.opfsKey === file.key);
        if (!stillUsed) {
            await removeSourceFile(file.key);
            removed++;
        }
    }
    return removed;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default {
    getStorageQuotaSummary,
    listPreservedSourcesWithRefs,
    removePreservedSource,
    removeUnreferencedSources,
    formatBytes
};
