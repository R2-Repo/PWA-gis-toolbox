import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    createWorkspaceLayer,
    appendWorkspaceBatch,
    removeWorkspaceLayer,
    detachFieldsForExport,
    getWorkspaceLayer,
    flushSpatialIndexSave,
    markSpatialIndexDirty,
    _getSpatialIndexPersistState,
    _resetWorkspaceCache,
    DB_VERSION,
    ATTR_LAYER_FEATURE_INDEX
} from '../js/workspace/workspace-store.js';

const LAYER_ID = 'layer_attr_range_test';

function pointFeature(i) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i, i] },
        properties: { n: i, keep: `k${i}`, drop: `d${i}` }
    };
}

describe('workspace attribute ranges + spatial index persist', () => {
    beforeEach(async () => {
        _resetWorkspaceCache();
        // Drop any leftover DB from prior tests
        await new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase('gis-toolbox-workspace');
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            req.onblocked = () => resolve();
        });
        _resetWorkspaceCache();
    });

    afterEach(async () => {
        _resetWorkspaceCache();
    });

    it('opens DB with by-layer-feature index at current version', async () => {
        await createWorkspaceLayer({ id: LAYER_ID, name: 'T' });
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('gis-toolbox-workspace', DB_VERSION);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        expect(db.version).toBe(DB_VERSION);
        const store = db.transaction('attributes').objectStore('attributes');
        expect(store.indexNames.contains(ATTR_LAYER_FEATURE_INDEX)).toBe(true);
        db.close();
    });

    it('loads only the intended numeric feature-index range across decade boundaries', async () => {
        await createWorkspaceLayer({ id: LAYER_ID, name: 'T' });
        const indexes = [0, 1, 99, 999, 1000, 9999, 10000];
        for (const i of indexes) {
            await appendWorkspaceBatch(LAYER_ID, [pointFeature(i)], i);
        }
        await flushSpatialIndexSave();

        // Directly exercise the compound-index range via attribute page loader.
        // Contiguous page offset 0 size 1000 must include 0/1/99/999 and exclude 1000+.
        const { getWorkspaceFeatureRecord } = await import('../js/workspace/workspace-store.js');

        // Prove decade-boundary keys exist
        expect(await getWorkspaceFeatureRecord(LAYER_ID, 1000)).toBeTruthy();
        expect(await getWorkspaceFeatureRecord(LAYER_ID, 10000)).toBeTruthy();

        // Simulate the old bug: string range `f:0`..`f:999` would also return f:1000.
        // Compound index query for [0, 999] must return only those four records.
        const idb = await new Promise((resolve, reject) => {
            const req = indexedDB.open('gis-toolbox-workspace', DB_VERSION);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const rows = await new Promise((resolve, reject) => {
            const tx = idb.transaction('attributes', 'readonly');
            const idx = tx.objectStore('attributes').index(ATTR_LAYER_FEATURE_INDEX);
            const r = idx.getAll(IDBKeyRange.bound([LAYER_ID, 0], [LAYER_ID, 999]));
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => reject(r.error);
        });
        idb.close();
        const pageIndexes = rows.map((r) => r.featureIndex).sort((a, b) => a - b);
        expect(pageIndexes).toEqual([0, 1, 99, 999]);
    });

    it('detachFieldsForExport visits each feature once across decade boundaries', async () => {
        await createWorkspaceLayer({ id: LAYER_ID, name: 'T' });
        // Contiguous 0..1000 so decade-boundary keys exist inside one detach window.
        const features = [];
        for (let i = 0; i <= 1000; i++) features.push(pointFeature(i));
        for (let i = 0; i < features.length; i += 250) {
            await appendWorkspaceBatch(LAYER_ID, features.slice(i, i + 250), i);
        }

        const result = await detachFieldsForExport(LAYER_ID, ['drop']);
        expect(result.movedFields).toEqual(['drop']);
        expect(result.featureCount).toBe(1001);

        const { getWorkspaceFeatureAttributes } = await import('../js/workspace/workspace-store.js');
        for (const i of [0, 1, 99, 999, 1000]) {
            const props = await getWorkspaceFeatureAttributes(LAYER_ID, i);
            expect(props.drop).toBeUndefined();
            expect(props.keep).toBe(`k${i}`);
        }
    });

    it('refuses to recreate a deleted layer from a late batch', async () => {
        await createWorkspaceLayer({ id: LAYER_ID, name: 'T' });
        await appendWorkspaceBatch(LAYER_ID, [pointFeature(0)], 0);
        await removeWorkspaceLayer(LAYER_ID);
        await expect(
            appendWorkspaceBatch(LAYER_ID, [pointFeature(1)], 1)
        ).rejects.toThrow(/refusing to recreate/i);
        const layer = await getWorkspaceLayer(LAYER_ID);
        expect(layer).toBeNull();
    });

    it('preserves spatial-index mutations that occur during an in-flight save', async () => {
        await createWorkspaceLayer({ id: LAYER_ID, name: 'T' });
        await appendWorkspaceBatch(LAYER_ID, [pointFeature(0)], 0);

        // Force a slow persist by wrapping — mark dirty, start flush, mutate, flush again.
        markSpatialIndexDirty();
        const flushA = flushSpatialIndexSave();
        await appendWorkspaceBatch(LAYER_ID, [pointFeature(1000)], 1000);
        await flushA;
        await flushSpatialIndexSave();

        const state = _getSpatialIndexPersistState();
        expect(state.persistedVersion).toBe(state.mutationVersion);
        expect(state.persistedVersion).toBeGreaterThan(0);

        // Reload index from IDB via cache reset
        _resetWorkspaceCache();
        const { queryWorkspaceChunks } = await import('../js/workspace/workspace-store.js');
        const hits = await queryWorkspaceChunks([-1, -1, 2000, 2000], LAYER_ID);
        const ids = hits.map((h) => h.chunkId || h.id || h).join(' ');
        // Both chunks should be present after reload
        expect(ids.includes(`${LAYER_ID}:c:0`) || hits.length >= 1).toBe(true);
        expect(hits.length).toBeGreaterThanOrEqual(2);
    }, 15_000);
});
