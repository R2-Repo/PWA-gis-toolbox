/**
 * Workflow Store — autosave graph to IndexedDB library draft; node caches in separate IDB.
 */
import { loadGraphIntoEngine } from './workflow-graph-loader.js';
import { graphFromEngine } from './workflow-schema.js';
import {
    clearAutosaveDraft,
    loadAutosaveDraft,
    saveAutosaveDraft
} from './workflow-library-db.js';

const LEGACY_SESSION_KEY = 'gis-toolbox-workflow';
const SESSION_MIGRATION_FLAG = 'gis-toolbox-workflow-idb-migrated';

/** Node execution cache (imported files, etc.) — separate from graph library DB */
export const WORKFLOW_CACHE_IDB_NAME = 'gis-toolbox-workflow-cache';
const IDB_STORE = 'node-data';
const IDB_VERSION = 1;

let _sessionMigrationPromise = null;

function _openCacheDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(WORKFLOW_CACHE_IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function _saveNodeData(engine) {
    try {
        const db = await _openCacheDB();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.clear();
        for (const node of engine.nodes.values()) {
            if (node._cachedResult) {
                const size = JSON.stringify(node._cachedResult).length;
                if (size > 25 * 1024 * 1024) {
                    console.warn('[WorkflowStore] Large node cache skipped', { nodeId: node.id, size });
                    continue;
                }
                store.put(node._cachedResult, node.id);
            }
        }
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        db.close();
    } catch (e) {
        console.warn('[WorkflowStore] IndexedDB save failed', e);
    }
}

async function _loadNodeData(engine) {
    try {
        const db = await _openCacheDB();
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const promises = [];
        for (const node of engine.nodes.values()) {
            if (node.config?.fileName && !node._cachedResult) {
                promises.push(new Promise((res, rej) => {
                    const req = store.get(node.id);
                    req.onsuccess = () => { if (req.result) node._cachedResult = req.result; res(); };
                    req.onerror = () => rej(req.error);
                }));
            }
        }
        await Promise.all(promises);
        db.close();
    } catch (e) {
        console.warn('[WorkflowStore] IndexedDB load failed', e);
    }
}

async function _clearNodeData() {
    try {
        const db = await _openCacheDB();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).clear();
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        db.close();
    } catch (e) {
        console.warn('[WorkflowStore] IndexedDB clear failed', e);
    }
}

async function migrateLegacySessionStorageOnce() {
    if (_sessionMigrationPromise) return _sessionMigrationPromise;
    _sessionMigrationPromise = (async () => {
        try {
            if (sessionStorage.getItem(SESSION_MIGRATION_FLAG)) return;
            const raw = sessionStorage.getItem(LEGACY_SESSION_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                await saveAutosaveDraft(data);
                sessionStorage.removeItem(LEGACY_SESSION_KEY);
            }
            sessionStorage.setItem(SESSION_MIGRATION_FLAG, '1');
        } catch (e) {
            console.warn('[WorkflowStore] sessionStorage migration failed', e);
        }
    })();
    return _sessionMigrationPromise;
}

// ── Public API ──

export class WorkflowStore {
    /**
     * Autosave pipeline structure to IndexedDB (graph only) + cached data to node cache IDB.
     */
    static save(engine) {
        const graph = graphFromEngine(engine);
        saveAutosaveDraft(graph).catch((e) => {
            console.warn('[WorkflowStore] autosave failed', e);
        });
        _saveNodeData(engine);
    }

    /**
     * Load autosaved pipeline from IndexedDB into engine.
     * @returns {Promise<{ loaded: boolean, unknownTypes: string[] }>}
     */
    static async load(engine) {
        await migrateLegacySessionStorageOnce();
        try {
            const graph = await loadAutosaveDraft();
            if (!graph?.nodes?.length) return { loaded: false, unknownTypes: [] };
            return loadGraphIntoEngine(engine, graph);
        } catch (e) {
            console.warn('[WorkflowStore] load failed', e);
            return { loaded: false, unknownTypes: [] };
        }
    }

    static async restoreNodeData(engine) {
        await _loadNodeData(engine);
    }

    static clear() {
        clearAutosaveDraft().catch((e) => {
            console.warn('[WorkflowStore] clear autosave failed', e);
        });
        _clearNodeData();
    }

    /** @internal test helper */
    static _resetSessionMigrationForTests() {
        _sessionMigrationPromise = null;
        try {
            sessionStorage.removeItem(SESSION_MIGRATION_FLAG);
        } catch {
            /* noop in non-browser tests without mock */
        }
    }
}
