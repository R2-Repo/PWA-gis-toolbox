import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
    buildProjectKitSnapshot,
    packProjectKit,
    parseProjectKit,
    PROJECT_KIT_FORMAT_VERSION
} from '../js/core/project-kit.js';

describe('project kit workspace streaming (Build 6)', () => {
    it('defers oversized workspace layers and packs via writeWorkspaceLayer callback', async () => {
        const layer = {
            id: 'ws-big',
            name: 'Big Layer',
            type: 'spatial-chunked',
            storage: 'workspace',
            workspaceLayerId: 'ws-big',
            schema: { featureCount: 300_000, geometryType: 'Point', fields: [] },
            source: { file: 'big.geojson', format: 'geojson', opfsKey: 'src_abc' },
            visible: true,
            created: '2026-01-01T00:00:00.000Z'
        };

        const snapshot = await buildProjectKitSnapshot({
            sections: ['layers'],
            layers: [layer],
            activeLayerId: layer.id,
            deferLargeWorkspace: true,
            maxBundleFeatures: 250_000,
            exportWorkspaceLayerBundle: async () => null
        });

        expect(snapshot.manifest.formatVersion).toBe(PROJECT_KIT_FORMAT_VERSION);
        expect(snapshot.layers.workspaceDeferred['ws-big']).toEqual({
            workspaceLayerId: 'ws-big',
            featureCount: 300_000
        });
        expect(snapshot.manifest.sourceKeys).toEqual(['src_abc']);

        let wrote = false;
        const blob = await packProjectKit(snapshot, JSZip, null, {
            writeWorkspaceLayer: async (zip, folderKey, workspaceLayerId) => {
                wrote = true;
                expect(folderKey).toBe('ws-big');
                expect(workspaceLayerId).toBe('ws-big');
                zip.file(`layers/workspace/${folderKey}/meta.json`, JSON.stringify({
                    id: workspaceLayerId,
                    featureCount: 300_000,
                    chunkIds: []
                }));
                zip.file(`layers/workspace/${folderKey}/attributes/part-00000.json`, '[]');
            },
            getSourceFile: async (key) => {
                expect(key).toBe('src_abc');
                return new File([new Uint8Array([1, 2, 3])], 'big.geojson');
            }
        });

        expect(wrote).toBe(true);
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        expect(zip.file('layers/workspace/ws-big/meta.json')).toBeTruthy();
        expect(zip.file('layers/workspace/ws-big/attributes/part-00000.json')).toBeTruthy();
        expect(zip.file('sources/src_abc/big.geojson')).toBeTruthy();

        const parsed = await parseProjectKit(await blob.arrayBuffer(), JSZip);
        expect(parsed.layers.workspaceDeferred['ws-big']).toBeTruthy();
        expect(parsed.layers.workspace['ws-big'].deferred).toBe(true);
        expect(parsed.layers.sources.src_abc?.[0]?.fileName).toBe('big.geojson');
    });

    it('still packs small workspace layers via in-memory bundle path', async () => {
        const layer = {
            id: 'ws-small',
            name: 'Small',
            type: 'spatial-chunked',
            storage: 'workspace',
            workspaceLayerId: 'ws-small',
            schema: { featureCount: 10, geometryType: 'Point', fields: [] },
            source: { file: 'small.geojson', format: 'geojson' },
            visible: true,
            created: '2026-01-01T00:00:00.000Z'
        };

        const snapshot = await buildProjectKitSnapshot({
            sections: ['layers'],
            layers: [layer],
            deferLargeWorkspace: true,
            exportWorkspaceLayerBundle: async () => ({
                meta: { id: 'ws-small', featureCount: 10, chunkIds: ['ws-small:c:0'] },
                chunks: [{ id: 'ws-small:c:0', layerId: 'ws-small', featureCount: 10, bbox: [0, 0, 1, 1], geojson: '{"type":"FeatureCollection","features":[]}' }],
                attributes: [{ id: 'ws-small:f:0', layerId: 'ws-small', featureIndex: 0, properties: { a: 1 } }],
                cold: []
            })
        });

        expect(snapshot.layers.workspaceDeferred).toEqual({});
        expect(snapshot.layers.workspace['ws-small'].attributes).toHaveLength(1);

        const blob = await packProjectKit(snapshot, JSZip);
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        expect(zip.file('layers/workspace/ws-small/attributes.json')).toBeTruthy();
    });
});
