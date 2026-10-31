import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { LayerInputNode } from '../js/workflow/nodes/input-nodes.js';
import { createServiceLayer, createChunkedSpatialDataset } from '../js/core/data-model.js';

const sampleGeojson = JSON.parse(
    readFileSync(new URL('./fixtures/sample-point.geojson', import.meta.url), 'utf8')
);

const workspaceFeatures = [
    {
        type: 'Feature',
        properties: { id: 1 },
        geometry: { type: 'Point', coordinates: [-111.89, 40.76] }
    }
];

vi.mock('../js/workspace/workspace-store.js', () => ({
    loadAllWorkspaceFeatures: vi.fn(async () => workspaceFeatures)
}));

import { loadAllWorkspaceFeatures } from '../js/workspace/workspace-store.js';

function makeContext(layers) {
    return { getLayers: () => layers };
}

describe('LayerInputNode.execute', () => {
    beforeEach(() => {
        vi.mocked(loadAllWorkspaceFeatures).mockClear();
    });

    it('returns in-memory spatial layers unchanged in shape', async () => {
        const layer = {
            id: 'sp-1',
            name: 'Sites',
            type: 'spatial',
            geojson: sampleGeojson,
            schema: { featureCount: 1, fields: [] }
        };
        const node = new LayerInputNode();
        node.config.layerId = 'sp-1';

        const out = await node.execute({}, makeContext([layer]));
        expect(out.type).toBe('spatial');
        expect(out.name).toBe('Sites');
        expect(out.geojson.features).toHaveLength(1);
        expect(out.geojson).not.toBe(layer.geojson);
    });

    it('loads spatial-chunked workspace layers via workspace-store', async () => {
        const layer = createChunkedSpatialDataset('Big import', {
            id: 'ws-layer-1',
            schema: { featureCount: 1, fields: [{ name: 'id', type: 'integer' }] }
        });
        const node = new LayerInputNode();
        node.config.layerId = layer.id;

        const out = await node.execute({}, makeContext([layer]));
        expect(loadAllWorkspaceFeatures).toHaveBeenCalledWith('ws-layer-1');
        expect(out.type).toBe('spatial');
        expect(out.geojson.features).toEqual(workspaceFeatures);
        expect(out.schema.featureCount).toBe(1);
    });

    it('returns table layers with rows', async () => {
        const layer = {
            id: 'tbl-1',
            name: 'Attributes',
            type: 'table',
            rows: [{ a: 1 }, { a: 2 }],
            schema: { fields: [{ name: 'a', type: 'integer' }] }
        };
        const node = new LayerInputNode();
        node.config.layerId = 'tbl-1';

        const out = await node.execute({}, makeContext([layer]));
        expect(out.type).toBe('table');
        expect(out.rows).toHaveLength(2);
    });

    it('uses current map view features for live vector service layers', async () => {
        const layer = createServiceLayer({
            name: 'Live FS',
            url: 'https://example.invalid/FeatureServer/0',
            kind: 'arcgis-featureserver'
        });
        layer.geojson = {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }]
        };
        layer.schema = { featureCount: 1, fields: [] };

        const node = new LayerInputNode();
        node.config.layerId = layer.id;

        const out = await node.execute({}, makeContext([layer]));
        expect(out.type).toBe('spatial');
        expect(out.name).toBe('Live FS (current map view only)');
        expect(out.geojson.features).toHaveLength(1);
    });

    it('rejects live vector layers with no in-memory features', async () => {
        const layer = createServiceLayer({
            name: 'Empty live',
            url: 'https://example.invalid/FeatureServer/0',
            kind: 'wfs'
        });
        const node = new LayerInputNode();
        node.config.layerId = layer.id;

        await expect(node.execute({}, makeContext([layer]))).rejects.toThrow(/current map view/i);
    });

    it('rejects PMTiles layers with a clear message', async () => {
        const layer = {
            id: 'pm-1',
            name: 'Tiles',
            type: 'pmtiles',
            geojson: { type: 'FeatureCollection', features: [] },
            schema: {}
        };
        const node = new LayerInputNode();
        node.config.layerId = 'pm-1';

        await expect(node.execute({}, makeContext([layer]))).rejects.toThrow(/PMTiles/i);
    });

    it('rejects COG raster layers with a clear message', async () => {
        const layer = {
            id: 'cog-1',
            name: 'Ortho',
            type: 'spatial',
            source: { format: 'cog' },
            geojson: { type: 'FeatureCollection', features: [] },
            schema: {}
        };
        const node = new LayerInputNode();
        node.config.layerId = 'cog-1';

        await expect(node.execute({}, makeContext([layer]))).rejects.toThrow(/COG raster/i);
    });

    it('rejects non-vector live service layers', async () => {
        const layer = createServiceLayer({
            name: 'Tile service',
            url: 'https://example.invalid/tiles',
            kind: 'xyz-tiles'
        });
        const node = new LayerInputNode();
        node.config.layerId = layer.id;

        await expect(node.execute({}, makeContext([layer]))).rejects.toThrow(/live map service/i);
    });

    it('throws when the configured layer is missing', async () => {
        const node = new LayerInputNode();
        node.config.layerId = 'missing';

        await expect(node.execute({}, makeContext([]))).rejects.toThrow(/Source layer not found/i);
    });
});
