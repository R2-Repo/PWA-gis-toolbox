/**
 * Phase 5 — durable checkpoints for resumable streaming imports.
 *
 * Crash / tab-close recovery only. Explicit user Cancel still rolls back
 * and deletes the checkpoint.
 *
 * Uses a dedicated IndexedDB (does not bump the workspace schema).
 *
 * @see docs/IMPORT_LARGE_FILES.md
 */
const DB_NAME = 'gis-toolbox-import-jobs';
const DB_VERSION = 1;
const STORE = 'import_jobs';

/** @type {IDBDatabase|null} */
let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            resolve(db);
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const idb = e.target.result;
            if (!idb.objectStoreNames.contains(STORE)) {
                const store = idb.createObjectStore(STORE, { keyPath: 'id' });
                store.createIndex('by-status', 'status', { unique: false });
                store.createIndex('by-updated', 'updatedAt', { unique: false });
            }
        };
        req.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        req.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Stable fingerprint for resume eligibility (options must match).
 * @param {{
 *   fileName?: string,
 *   fileSize?: number,
 *   lastModified?: number,
 *   format?: string,
 *   fenceBbox?: unknown,
 *   selectedFields?: unknown,
 *   featureFilter?: unknown,
 *   importMode?: string|null,
 *   sourceCrs?: { code?: string }|null,
 *   maxFeatures?: number|null
 * }} input
 */
export function optionsFingerprint(input = {}) {
    const payload = {
        fileName: input.fileName || '',
        fileSize: Number(input.fileSize) || 0,
        lastModified: Number(input.lastModified) || 0,
        format: input.format || '',
        fenceBbox: input.fenceBbox || null,
        selectedFields: Array.isArray(input.selectedFields) ? [...input.selectedFields].sort() : null,
        featureFilter: input.featureFilter || null,
        importMode: input.importMode || null,
        sourceCrs: input.sourceCrs?.code || null,
        maxFeatures: input.maxFeatures ?? null
    };
    try {
        return JSON.stringify(payload);
    } catch {
        return `${payload.fileName}:${payload.fileSize}:${payload.format}`;
    }
}

/**
 * @param {Partial<{
 *   id: string,
 *   status: 'running'|'interrupted'|'complete',
 *   fileName: string,
 *   fileSize: number,
 *   lastModified: number,
 *   format: string,
 *   optionsHash: string,
 *   options: object,
 *   opfsKey: string|null,
 *   bytesProcessed: number,
 *   totalBytes: number,
 *   skipFeatures: number,
 *   classes: Array<{ clsKey: string, layerId: string, featureCount: number, geomTypes?: string[] }>,
 *   updatedAt: string,
 *   createdAt: string
 * }>} meta
 */
export async function upsertImportCheckpoint(meta = {}) {
    const idb = await openDB();
    const now = new Date().toISOString();
    const existing = meta.id ? await getImportCheckpoint(meta.id) : null;
    const record = {
        id: meta.id || `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        status: meta.status || existing?.status || 'running',
        fileName: meta.fileName ?? existing?.fileName ?? '',
        fileSize: meta.fileSize ?? existing?.fileSize ?? 0,
        lastModified: meta.lastModified ?? existing?.lastModified ?? 0,
        format: meta.format ?? existing?.format ?? '',
        optionsHash: meta.optionsHash ?? existing?.optionsHash ?? '',
        options: meta.options ?? existing?.options ?? {},
        opfsKey: meta.opfsKey !== undefined ? meta.opfsKey : (existing?.opfsKey ?? null),
        bytesProcessed: meta.bytesProcessed ?? existing?.bytesProcessed ?? 0,
        totalBytes: meta.totalBytes ?? existing?.totalBytes ?? 0,
        skipFeatures: meta.skipFeatures ?? existing?.skipFeatures ?? 0,
        classes: Array.isArray(meta.classes) ? meta.classes : (existing?.classes || []),
        createdAt: existing?.createdAt || meta.createdAt || now,
        updatedAt: now
    };

    await new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    return record;
}

/** @param {string} id */
export async function getImportCheckpoint(id) {
    if (!id) return null;
    const idb = await openDB();
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/** @param {string} id */
export async function removeImportCheckpoint(id) {
    if (!id) return;
    const idb = await openDB();
    await new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * @param {{ status?: string }} [filter]
 * @returns {Promise<object[]>}
 */
export async function listImportCheckpoints(filter = {}) {
    const idb = await openDB();
    const all = await new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
    let rows = all;
    if (filter.status) {
        rows = rows.filter((row) => row.status === filter.status);
    }
    return rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export async function listInterruptedCheckpoints() {
    const running = await listImportCheckpoints({ status: 'running' });
    const interrupted = await listImportCheckpoints({ status: 'interrupted' });
    return [...running, ...interrupted].sort(
        (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    );
}

/**
 * Mark a running job interrupted (call from pagehide / visibility when possible).
 * @param {string} id
 */
export async function markImportCheckpointInterrupted(id) {
    const existing = await getImportCheckpoint(id);
    if (!existing || existing.status === 'complete') return existing;
    return upsertImportCheckpoint({
        ...existing,
        status: 'interrupted'
    });
}

/** Test helper — close and forget the open handle. */
export async function _resetImportCheckpointDbForTests() {
    if (db) {
        try {
            db.close();
        } catch { /* ignore */ }
        db = null;
    }
    await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
    });
}

export default {
    optionsFingerprint,
    upsertImportCheckpoint,
    getImportCheckpoint,
    removeImportCheckpoint,
    listImportCheckpoints,
    listInterruptedCheckpoints,
    markImportCheckpointInterrupted
};
