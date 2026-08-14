import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    createWorkspaceLayer,
    appendWorkspaceBatch,
    detachFieldsForExport,
    _resetWorkspaceCache
} from '../js/workspace/workspace-store.js';
import {
    resolveSelectionFeatures,
    createSelectionActionHandlers
} from '../js/tools/selection-actions.js';

const TOTAL = 1100; // spans multiple workspace chunks

function pointFeature(i) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i * 0.001, i * 0.001] },
        properties: { name: `F${i}`, note: `n${i}` }
    };
}

/** Tiled-display workspace handle: geojson packet is EMPTY. */
function tiledHandle(layerId) {
    return {
        id: layerId,
        name: 'Tiled Layer',
        type: 'spatial-chunked',
        storage: 'workspace',
        workspaceLayerId: layerId,
        geojson: { type: 'FeatureCollection', features: [] },
        schema: {
            geometryType: 'Point',
            featureCount: TOTAL,
            fields: [
                { name: 'name', outputName: 'name', selected: true, order: 0 },
                { name: 'note', outputName: 'note', selected: true, order: 1 }
            ]
        },
        source: { format: 'geojson' }
    };
}

async function seedLayer(layerId) {
    await createWorkspaceLayer({ id: layerId, name: 'Tiled Layer' });
    for (let start = 0; start < TOTAL; start += 500) {
        const batch = [];
        for (let i = start; i < Math.min(start + 500, TOTAL); i++) batch.push(pointFeature(i));
        await appendWorkspaceBatch(layerId, batch, start);
    }
}

let lastDownloadedBlob = null;

beforeAll(async () => {
    globalThis.document = {
        createElement: () => ({ click: () => {}, style: {} }),
        body: { appendChild: () => {}, removeChild: () => {} }
    };
    globalThis.URL.createObjectURL = (blob) => {
        lastDownloadedBlob = blob;
        return 'blob:test';
    };
    globalThis.URL.revokeObjectURL = () => {};

    _resetWorkspaceCache();
    await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase('gis-toolbox-workspace');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
    });
    _resetWorkspaceCache();
});

describe('resolveSelectionFeatures', () => {
    it('loads selected features from the store when the geojson packet is empty (tiled)', async () => {
        const layerId = 'sel_tiled_resolve';
        await seedLayer(layerId);

        const features = await resolveSelectionFeatures(tiledHandle(layerId), [3, 700, 1099]);

        expect(features).toHaveLength(3);
        const names = features.map((f) => f.properties.name).sort();
        expect(names).toEqual(['F1099', 'F3', 'F700']);
        expect(features[0].properties._featureIndex).toBeUndefined();
    });

    it('joins detached (cold) attributes', async () => {
        const layerId = 'sel_tiled_cold';
        await seedLayer(layerId);
        await detachFieldsForExport(layerId, ['note']);

        const features = await resolveSelectionFeatures(tiledHandle(layerId), [42]);
        expect(features).toHaveLength(1);
        expect(features[0].properties.note).toBe('n42');
    });

    it('keeps memory-layer behavior unchanged', async () => {
        const memLayer = {
            type: 'spatial',
            geojson: {
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', geometry: null, properties: { _featureIndex: 0, name: 'a' } },
                    { type: 'Feature', geometry: null, properties: { _featureIndex: 1, name: 'b' } }
                ]
            }
        };
        const features = await resolveSelectionFeatures(memLayer, [1]);
        expect(features).toHaveLength(1);
        expect(features[0].properties).toEqual({ name: 'b' });
    });
});

describe('exportSelected on a tiled workspace layer', () => {
    it('exports exactly the selected features as GeoJSON', async () => {
        const layerId = 'sel_tiled_export';
        await seedLayer(layerId);
        const layer = tiledHandle(layerId);

        const toasts = [];
        const handlers = createSelectionActionHandlers({
            getActiveLayer: () => layer,
            mapService: { getSelectedIndices: () => [10, 550, 1042] },
            showToast: (msg, kind) => toasts.push({ msg, kind }),
            showErrorToast: (err) => { throw err; }
        });

        lastDownloadedBlob = null;
        await handlers.exportSelected('geojson');

        expect(toasts.some((t) => t.kind === 'success')).toBe(true);
        expect(toasts.some((t) => t.msg === 'No features selected')).toBe(false);
        const parsed = JSON.parse(await lastDownloadedBlob.text());
        expect(parsed.features).toHaveLength(3);
        const names = parsed.features.map((f) => f.properties.name).sort();
        expect(names).toEqual(['F10', 'F1042', 'F550']);
    });
});
