/**
 * IndexedDB persistence for saved workflow graphs, version history, and working autosave.
 * Graph definitions only — no node execution caches.
 */
import { migrateWorkflowGraph } from './workflow-schema.js';

export const WORKFLOW_LIBRARY_IDB_NAME = 'gis-toolbox-workflow-library';
export const WORKFLOW_LIBRARY_IDB_VERSION = 1;
export const WORKFLOW_LIBRARY_STORE_GRAPHS = 'saved-graphs';
export const WORKFLOW_LIBRARY_STORE_VERSIONS = 'graph-versions';
export const WORKFLOW_LIBRARY_STORE_DRAFT = 'draft';

export const WORKFLOW_VERSION_CAP = 20;
const AUTOSAVE_KEY = 'working';

let _dbPromise = null;

function openLibraryDB() {
    if (!_dbPromise) {
        _dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(WORKFLOW_LIBRARY_IDB_NAME, WORKFLOW_LIBRARY_IDB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(WORKFLOW_LIBRARY_STORE_GRAPHS)) {
                    db.createObjectStore(WORKFLOW_LIBRARY_STORE_GRAPHS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(WORKFLOW_LIBRARY_STORE_VERSIONS)) {
                    const vs = db.createObjectStore(WORKFLOW_LIBRARY_STORE_VERSIONS, { keyPath: 'id' });
                    vs.createIndex('byGraphId', 'graphId', { unique: false });
                }
                if (!db.objectStoreNames.contains(WORKFLOW_LIBRARY_STORE_DRAFT)) {
                    db.createObjectStore(WORKFLOW_LIBRARY_STORE_DRAFT, { keyPath: 'key' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return _dbPromise;
}

function tx(storeNames, mode) {
    return openLibraryDB().then((db) => db.transaction(storeNames, mode));
}

function reqPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function newId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeGraph(graphInput) {
    return migrateWorkflowGraph(graphInput);
}

/**
 * @typedef {{ id: string, name: string, updatedAt: string, nodeCount: number, headVersionId: string }} SavedGraphSummary
 * @typedef {{ id: string, graphId: string, savedAt: string, label?: string }} GraphVersionSummary
 */

/** @returns {Promise<SavedGraphSummary[]>} */
export async function listSavedGraphs() {
    const transaction = await tx(WORKFLOW_LIBRARY_STORE_GRAPHS, 'readonly');
    const store = transaction.objectStore(WORKFLOW_LIBRARY_STORE_GRAPHS);
    const rows = await reqPromise(store.getAll());
    return rows
        .map((r) => ({
            id: r.id,
            name: r.name,
            updatedAt: r.updatedAt,
            nodeCount: r.nodeCount ?? 0,
            headVersionId: r.headVersionId
        }))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

/** @returns {Promise<GraphVersionSummary[]>} */
export async function listGraphVersions(graphId) {
    const transaction = await tx(WORKFLOW_LIBRARY_STORE_VERSIONS, 'readonly');
    const store = transaction.objectStore(WORKFLOW_LIBRARY_STORE_VERSIONS);
    const index = store.index('byGraphId');
    const rows = await reqPromise(index.getAll(graphId));
    return rows
        .map((r) => ({
            id: r.id,
            graphId: r.graphId,
            savedAt: r.savedAt,
            label: r.label,
            nodeCount: r.graph?.nodes?.length ?? 0
        }))
        .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}

async function trimVersions(graphId) {
    const versions = await listGraphVersions(graphId);
    if (versions.length <= WORKFLOW_VERSION_CAP) return;
    const toRemove = versions.slice(WORKFLOW_VERSION_CAP);
    const transaction = await tx(WORKFLOW_LIBRARY_STORE_VERSIONS, 'readwrite');
    const store = transaction.objectStore(WORKFLOW_LIBRARY_STORE_VERSIONS);
    for (const v of toRemove) {
        store.delete(v.id);
    }
    await new Promise((res, rej) => {
        transaction.oncomplete = res;
        transaction.onerror = () => rej(transaction.error);
    });
}

/**
 * @param {string} name
 * @param {unknown} graphInput
 * @returns {Promise<string>} graph id
 */
export async function saveNewGraph(name, graphInput) {
    const graph = normalizeGraph(graphInput);
    const graphId = newId('wf');
    const versionId = newId('wfv');
    const now = new Date().toISOString();

    const transaction = await tx(
        [WORKFLOW_LIBRARY_STORE_GRAPHS, WORKFLOW_LIBRARY_STORE_VERSIONS],
        'readwrite'
    );
    transaction.objectStore(WORKFLOW_LIBRARY_STORE_VERSIONS).put({
        id: versionId,
        graphId,
        savedAt: now,
        label: 'Initial save',
        graph
    });
    transaction.objectStore(WORKFLOW_LIBRARY_STORE_GRAPHS).put({
        id: graphId,
        name: name.trim() || 'Untitled workflow',
        updatedAt: now,
        nodeCount: graph.nodes.length,
        headVersionId: versionId
    });
    await new Promise((res, rej) => {
        transaction.oncomplete = res;
        transaction.onerror = () => rej(transaction.error);
    });
    return graphId;
}

/**
 * Add a version to an existing saved graph and update its head pointer.
 * @param {string} graphId
 * @param {string} name
 * @param {unknown} graphInput
 * @param {{ label?: string }} [opts]
 */
export async function saveGraphVersion(graphId, name, graphInput, opts = {}) {
    const graph = normalizeGraph(graphInput);
    const versionId = newId('wfv');
    const now = new Date().toISOString();

    const transaction = await tx(
        [WORKFLOW_LIBRARY_STORE_GRAPHS, WORKFLOW_LIBRARY_STORE_VERSIONS],
        'readwrite'
    );
    const graphs = transaction.objectStore(WORKFLOW_LIBRARY_STORE_GRAPHS);
    const existing = await reqPromise(graphs.get(graphId));
    if (!existing) throw new Error('Saved workflow not found');

    transaction.objectStore(WORKFLOW_LIBRARY_STORE_VERSIONS).put({
        id: versionId,
        graphId,
        savedAt: now,
        label: opts.label || 'Saved',
        graph
    });
    graphs.put({
        ...existing,
        name: name.trim() || existing.name,
        updatedAt: now,
        nodeCount: graph.nodes.length,
        headVersionId: versionId
    });
    await new Promise((res, rej) => {
        transaction.oncomplete = res;
        transaction.onerror = () => rej(transaction.error);
    });
    await trimVersions(graphId);
}

/** @returns {Promise<import('./workflow-schema.js').WorkflowGraphJSON | null>} */
export async function openSavedGraph(graphId) {
    const transaction = await tx(WORKFLOW_LIBRARY_STORE_GRAPHS, 'readonly');
    const meta = await reqPromise(transaction.objectStore(WORKFLOW_LIBRARY_STORE_GRAPHS).get(graphId));
    if (!meta?.headVersionId) return null;
    return loadVersionGraph(meta.headVersionId);
}

/** @returns {Promise<import('./workflow-schema.js').WorkflowGraphJSON | null>} */
export async function loadVersionGraph(versionId) {
    const transaction = await tx(WORKFLOW_LIBRARY_STORE_VERSIONS, 'readonly');
    const row = await reqPromise(transaction.objectStore(WORKFLOW_LIBRARY_STORE_VERSIONS).get(versionId));
    if (!row?.graph) return null;
    return normalizeGraph(row.graph);
}

export async function renameSavedGraph(graphId, newName) {
    const transaction = await tx(WORKFLOW_LIBRARY_STORE_GRAPHS, 'readwrite');
    const store = transaction.objectStore(WORKFLOW_LIBRARY_STORE_GRAPHS);
    const existing = await reqPromise(store.get(graphId));
    if (!existing) throw new Error('Saved workflow not found');
    store.put({
        ...existing,
        name: newName.trim() || existing.name,
        updatedAt: new Date().toISOString()
    });
    await new Promise((res, rej) => {
        transaction.oncomplete = res;
        transaction.onerror = () => rej(transaction.error);
    });
}

export async function deleteSavedGraph(graphId) {
    const versions = await listGraphVersions(graphId);
    const transaction = await tx(
        [WORKFLOW_LIBRARY_STORE_GRAPHS, WORKFLOW_LIBRARY_STORE_VERSIONS],
        'readwrite'
    );
    transaction.objectStore(WORKFLOW_LIBRARY_STORE_GRAPHS).delete(graphId);
    const vStore = transaction.objectStore(WORKFLOW_LIBRARY_STORE_VERSIONS);
    for (const v of versions) {
        vStore.delete(v.id);
    }
    await new Promise((res, rej) => {
        transaction.oncomplete = res;
        transaction.onerror = () => rej(transaction.error);
    });
}

/** @returns {Promise<string>} new graph id */
export async function duplicateSavedGraph(graphId, newName) {
    const graph = await openSavedGraph(graphId);
    if (!graph) throw new Error('Saved workflow not found');
    const meta = (await listSavedGraphs()).find((g) => g.id === graphId);
    const name = newName?.trim() || `${meta?.name || 'Workflow'} (copy)`;
    return saveNewGraph(name, graph);
}

export async function saveAutosaveDraft(graphInput) {
    const graph = normalizeGraph(graphInput);
    const transaction = await tx(WORKFLOW_LIBRARY_STORE_DRAFT, 'readwrite');
    transaction.objectStore(WORKFLOW_LIBRARY_STORE_DRAFT).put({
        key: AUTOSAVE_KEY,
        updatedAt: new Date().toISOString(),
        graph
    });
    await new Promise((res, rej) => {
        transaction.oncomplete = res;
        transaction.onerror = () => rej(transaction.error);
    });
}

/** @returns {Promise<import('./workflow-schema.js').WorkflowGraphJSON | null>} */
export async function loadAutosaveDraft() {
    const transaction = await tx(WORKFLOW_LIBRARY_STORE_DRAFT, 'readonly');
    const row = await reqPromise(transaction.objectStore(WORKFLOW_LIBRARY_STORE_DRAFT).get(AUTOSAVE_KEY));
    if (!row?.graph) return null;
    return normalizeGraph(row.graph);
}

export async function clearAutosaveDraft() {
    const transaction = await tx(WORKFLOW_LIBRARY_STORE_DRAFT, 'readwrite');
    transaction.objectStore(WORKFLOW_LIBRARY_STORE_DRAFT).delete(AUTOSAVE_KEY);
    await new Promise((res, rej) => {
        transaction.oncomplete = res;
        transaction.onerror = () => rej(transaction.error);
    });
}

/** Testing helper — wipe library stores (avoids deleteDatabase hangs from open connections). */
export async function _dangerouslyClearLibraryForTests() {
    const db = await openLibraryDB();
    const names = [
        WORKFLOW_LIBRARY_STORE_GRAPHS,
        WORKFLOW_LIBRARY_STORE_VERSIONS,
        WORKFLOW_LIBRARY_STORE_DRAFT
    ];
    await new Promise((resolve, reject) => {
        const tx = db.transaction(names, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        for (const name of names) {
            tx.objectStore(name).clear();
        }
    });
    db.close();
    _dbPromise = null;
}
