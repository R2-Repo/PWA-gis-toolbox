import { describe, it, expect, beforeEach } from 'vitest';
import {
    VALUE_SCAN_MAX_FEATURES,
    VALUE_SCAN_MAX_BYTES,
    fileIdentityKey,
    valueScanCacheKey,
    estimateCacheKey,
    getImportScanCache,
    setImportScanCache,
    clearImportScanCache,
    importScanCacheSize,
    trackImportScanWorker,
    terminateAllImportScanWorkers,
    activeImportScanWorkerCount
} from '../js/import/import-scan-cache.js';

function fakeFile(name, size = 1000, lastModified = 1) {
    return { name, size, lastModified };
}

describe('import-scan-cache', () => {
    beforeEach(() => {
        clearImportScanCache();
        terminateAllImportScanWorkers();
    });

    it('documents sampled value-scan caps', () => {
        expect(VALUE_SCAN_MAX_FEATURES).toBe(50_000);
        expect(VALUE_SCAN_MAX_BYTES).toBe(256 * 1024 * 1024);
    });

    it('builds stable file / scan keys', () => {
        const file = fakeFile('roads.geojson', 9_000_000, 42);
        expect(fileIdentityKey(file)).toBe('roads.geojson|9000000|42');
        const a = valueScanCacheKey(file, { fieldNames: ['b', 'a'], valueCap: 2000 });
        const b = valueScanCacheKey(file, { fieldNames: ['a', 'b'], valueCap: 2000 });
        expect(a).toBe(b);
        const estA = estimateCacheKey(file, {
            featureFilter: { rules: [{ field: 'COUNTY', operator: 'equals', value: 'Utah' }] },
            fenceBbox: [-111, 40, -110, 41]
        });
        const estB = estimateCacheKey(file, {
            featureFilter: { rules: [{ field: 'COUNTY', operator: 'equals', value: 'Utah' }] },
            fenceBbox: [-111, 40, -110, 41]
        });
        expect(estA).toBe(estB);
        expect(estA).not.toBe(estimateCacheKey(file, { featureFilter: null, fenceBbox: null }));
    });

    it('caches and LRU-evicts scan results', () => {
        setImportScanCache('k1', { ok: 1 }, 2);
        setImportScanCache('k2', { ok: 2 }, 2);
        expect(getImportScanCache('k1')).toEqual({ ok: 1 });
        setImportScanCache('k3', { ok: 3 }, 2);
        expect(importScanCacheSize()).toBe(2);
        // k2 was least-recently used after touching k1
        expect(getImportScanCache('k2')).toBeUndefined();
        expect(getImportScanCache('k1')).toEqual({ ok: 1 });
        expect(getImportScanCache('k3')).toEqual({ ok: 3 });
    });

    it('tracks and terminates orphan scan workers', () => {
        const terminated = [];
        const fakeWorker = {
            terminate() {
                terminated.push(true);
            }
        };
        const untrack = trackImportScanWorker(fakeWorker);
        expect(activeImportScanWorkerCount()).toBe(1);
        terminateAllImportScanWorkers();
        expect(activeImportScanWorkerCount()).toBe(0);
        expect(terminated).toHaveLength(1);
        // untrack after terminate is a no-op on the set
        untrack();
        expect(activeImportScanWorkerCount()).toBe(0);
    });
});
