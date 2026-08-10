import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    optionsFingerprint,
    upsertImportCheckpoint,
    getImportCheckpoint,
    removeImportCheckpoint,
    listInterruptedCheckpoints,
    markImportCheckpointInterrupted,
    _resetImportCheckpointDbForTests
} from '../js/import/stream/import-checkpoint-store.js';

describe('import-checkpoint-store', () => {
    beforeEach(async () => {
        await _resetImportCheckpointDbForTests();
    });

    afterEach(async () => {
        await _resetImportCheckpointDbForTests();
    });

    it('fingerprints options stably', () => {
        const a = optionsFingerprint({
            fileName: 'a.geojson',
            fileSize: 10,
            format: 'geojson',
            selectedFields: ['b', 'a'],
            maxFeatures: 1000
        });
        const b = optionsFingerprint({
            fileName: 'a.geojson',
            fileSize: 10,
            format: 'geojson',
            selectedFields: ['a', 'b'],
            maxFeatures: 1000
        });
        expect(a).toBe(b);
    });

    it('upserts, lists, and removes checkpoints', async () => {
        const created = await upsertImportCheckpoint({
            status: 'running',
            fileName: 'big.geojson',
            fileSize: 50_000_000,
            format: 'geojson',
            optionsHash: 'hash',
            opfsKey: 'src_1',
            bytesProcessed: 12_000_000,
            totalBytes: 50_000_000,
            skipFeatures: 25_000,
            classes: [{ clsKey: 'line', layerId: 'ds_1', featureCount: 25_000 }]
        });
        expect(created.id).toBeTruthy();

        const loaded = await getImportCheckpoint(created.id);
        expect(loaded.fileName).toBe('big.geojson');
        expect(loaded.skipFeatures).toBe(25_000);

        const interrupted = await listInterruptedCheckpoints();
        expect(interrupted.some((row) => row.id === created.id)).toBe(true);

        await markImportCheckpointInterrupted(created.id);
        const marked = await getImportCheckpoint(created.id);
        expect(marked.status).toBe('interrupted');

        await removeImportCheckpoint(created.id);
        expect(await getImportCheckpoint(created.id)).toBeNull();
    });
});
