import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    createWorkspaceLayer,
    appendWorkspaceBatch,
    detachFieldsForExport,
    _resetWorkspaceCache
} from '../js/workspace/workspace-store.js';
import {
    materializeWorkspaceGeoJSON,
    materializeWorkspaceDatasetForExport
} from '../js/export/stream-export-service.js';
import { exportDataset, exportMultiLayerKMLFile } from '../js/export/exporter.js';
import { exportGPX } from '../js/export/gpx-exporter.js';

const TOTAL = 1201; // spans multiple 500-feature export batches

function pointFeature(i) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i * 0.001, i * 0.001] },
        properties: { name: `F${i}`, category: i % 2 ? 'odd' : 'even', note: `n${i}` }
    };
}

function schemaFields(overrides = {}) {
    return ['name', 'category', 'note'].map((name, order) => ({
        name,
        outputName: name,
        type: 'string',
        selected: true,
        order,
        ...(overrides[name] || {})
    }));
}

/** Workspace layer handle as held by the app: geojson = stale viewport packet. */
function workspaceHandle(layerId, { fields } = {}) {
    return {
        id: layerId,
        name: 'WS Layer',
        type: 'spatial-chunked',
        storage: 'workspace',
        workspaceLayerId: layerId,
        geojson: { type: 'FeatureCollection', features: [pointFeature(0)] },
        schema: { geometryType: 'Point', featureCount: TOTAL, fields: fields || schemaFields() },
        source: { format: 'geojson' }
    };
}

async function seedLayer(layerId) {
    await createWorkspaceLayer({ id: layerId, name: 'WS Layer' });
    for (let start = 0; start < TOTAL; start += 500) {
        const batch = [];
        for (let i = start; i < Math.min(start + 500, TOTAL); i++) batch.push(pointFeature(i));
        await appendWorkspaceBatch(layerId, batch, start);
    }
}

// Capture blobs handed to downloadBlob without a real DOM.
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

describe('workspace layer materialization for export', () => {
    it('materializes the full layer, not the viewport packet', async () => {
        const layerId = 'ws_mat_full';
        await seedLayer(layerId);
        const handle = workspaceHandle(layerId);

        const out = await materializeWorkspaceDatasetForExport(handle);

        expect(out).not.toBe(handle);
        expect(out._workspaceMaterialized).toBe(true);
        expect(out.geojson.features).toHaveLength(TOTAL);
        expect(out.geojson.features[1200].properties.name).toBe('F1200');
        // Internal props stripped, stable identity kept
        expect(out.geojson.features[0].properties.__lgid).toBeTruthy();
        expect(out.geojson.features[0].properties._featureIndex).toBeUndefined();
        // Live layer object untouched (its geojson is the map viewport cache)
        expect(handle.geojson.features).toHaveLength(1);
        expect(handle._workspaceMaterialized).toBeUndefined();
    });

    it('respects field selection when some fields are deselected', async () => {
        const layerId = 'ws_mat_select';
        await seedLayer(layerId);
        const handle = workspaceHandle(layerId, {
            fields: schemaFields({ note: { selected: false } })
        });

        const fc = await materializeWorkspaceGeoJSON(handle);
        expect(fc.features).toHaveLength(TOTAL);
        expect(fc.features[5].properties.name).toBe('F5');
        expect(fc.features[5].properties.note).toBeUndefined();
    });

    it('joins cold (detached) attributes like the streamed path', async () => {
        const layerId = 'ws_mat_cold';
        await seedLayer(layerId);
        await detachFieldsForExport(layerId, ['note']);
        const handle = workspaceHandle(layerId);

        const fc = await materializeWorkspaceGeoJSON(handle);
        expect(fc.features).toHaveLength(TOTAL);
        expect(fc.features[42].properties.note).toBe('n42');
    });

    it('is a pass-through for in-memory datasets', async () => {
        const mem = {
            type: 'spatial',
            geojson: { type: 'FeatureCollection', features: [pointFeature(1)] }
        };
        expect(await materializeWorkspaceDatasetForExport(mem)).toBe(mem);
    });
});

describe('non-streamed format exports on workspace layers', () => {
    it('KML export contains every feature', async () => {
        const layerId = 'ws_export_kml';
        await seedLayer(layerId);

        lastDownloadedBlob = null;
        await exportDataset(workspaceHandle(layerId), 'kml');
        const text = await lastDownloadedBlob.text();

        expect((text.match(/<Placemark>/g) || []).length).toBe(TOTAL);
        expect(text).toContain('F1200');
    });

    it('JSON export contains every feature', async () => {
        const layerId = 'ws_export_json';
        await seedLayer(layerId);

        lastDownloadedBlob = null;
        await exportDataset(workspaceHandle(layerId), 'json');
        const parsed = JSON.parse(await lastDownloadedBlob.text());

        expect(parsed.features).toHaveLength(TOTAL);
    });

    it('Excel export contains every row', async () => {
        const layerId = 'ws_export_xlsx';
        await seedLayer(layerId);

        lastDownloadedBlob = null;
        await exportDataset(workspaceHandle(layerId), 'xlsx');
        const { read, utils } = await import('xlsx');
        const wb = read(await lastDownloadedBlob.arrayBuffer(), { type: 'array' });
        const rows = utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

        expect(rows).toHaveLength(TOTAL);
        expect(rows[0].longitude).toBeCloseTo(0);
    });

    it('Shapefile export contains every record', async () => {
        const layerId = 'ws_export_shp';
        await seedLayer(layerId);

        lastDownloadedBlob = null;
        await exportDataset(workspaceHandle(layerId), 'shapefile');
        const { default: JSZip } = await import('jszip');
        const zip = await JSZip.loadAsync(await lastDownloadedBlob.arrayBuffer());
        const shx = await zip.file(/\.shx$/)[0].async('arraybuffer');
        // .shx = 100-byte header + 8 bytes per record
        expect((shx.byteLength - 100) / 8).toBe(TOTAL);
    });

    it('GPX export materializes the full workspace layer (direct call)', async () => {
        const layerId = 'ws_export_gpx';
        await seedLayer(layerId);

        const result = await exportGPX(workspaceHandle(layerId));
        expect((result.text.match(/<wpt /g) || []).length).toBe(TOTAL);
    });

    it('multi-layer KML export materializes workspace layers', async () => {
        const layerId = 'ws_export_multi';
        await seedLayer(layerId);
        const memLayer = {
            dataset: {
                type: 'spatial',
                name: 'Mem Layer',
                geojson: { type: 'FeatureCollection', features: [pointFeature(999999)] },
                schema: { geometryType: 'Point' }
            },
            style: null
        };
        const wsLayer = { dataset: workspaceHandle(layerId), style: null };

        lastDownloadedBlob = null;
        await exportMultiLayerKMLFile([memLayer, wsLayer], { filename: 'combo' });
        const text = await lastDownloadedBlob.text();

        expect((text.match(/<Placemark>/g) || []).length).toBe(TOTAL + 1);
        expect(text).toContain('F1200');
    });
});
