import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    appendWorkspaceBatch,
    createWorkspaceLayer,
    getWorkspaceFeatureAttributes,
    _resetWorkspaceCache
} from '../js/workspace/workspace-store.js';
import { buildViewportGeoJSON } from '../js/workspace/viewport-loader.js';
import {
    commitWorkspaceAttributeFilter,
    numericFilterValue,
    rowMatchesFilterRule,
    rowMatchesWorkspaceFilter
} from '../js/workspace/workspace-attribute-filter.js';
import { materializeWorkspaceGeoJSON } from '../js/export/stream-export-service.js';
import { serializeLayerForPersistence } from '../js/core/session-store.js';
import { buildDatasetFromWorkspaceRef } from '../js/core/layer-restore.js';
import { selectTileFeatures } from '../js/map/tiles/tile-feature-select.js';

const LAYER_ID = 'ws_route_filter';

function milepost(route, lng) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, 40.6] },
        properties: { name: `mp-${route}`, route }
    };
}

async function resetDb() {
    _resetWorkspaceCache();
    await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase('gis-toolbox-workspace');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
    });
    _resetWorkspaceCache();
}

describe('workspace attribute filter values', () => {
    it('treats route 0015P as a string, not a number', () => {
        const row = { route: '0015P', name: 'tenth' };
        expect(numericFilterValue('0015P')).toBeNull();
        expect(numericFilterValue('0015')).toBeNull();
        expect(numericFilterValue(15)).toBe(15);
        expect(rowMatchesFilterRule(row, { field: 'route', operator: 'equals', value: '0015P' })).toBe(true);
        expect(rowMatchesFilterRule(row, { field: 'route', operator: 'equals', value: '0015p' })).toBe(true);
        expect(rowMatchesFilterRule(row, { field: 'route', operator: 'equals', value: 15 })).toBe(false);
        expect(rowMatchesFilterRule(row, { field: 'route', operator: 'equals', value: '15' })).toBe(false);
        expect(rowMatchesFilterRule(row, { field: 'route', operator: 'greater_than', value: 0 })).toBe(false);
        expect(rowMatchesFilterRule({ route: 15 }, { field: 'route', operator: 'equals', value: '15' })).toBe(true);
        expect(rowMatchesFilterRule({ route: 15 }, { field: 'route', operator: 'greater_than', value: 10 })).toBe(true);
        expect(rowMatchesWorkspaceFilter(row, [
            { field: 'route', operator: 'equals', value: '0015P' },
            { field: 'name', operator: 'contains', value: 'TENTH' }
        ], 'AND')).toBe(true);
    });
});

describe('workspace layer filter uses stored attributes', () => {
    beforeEach(resetDb);

    it('matches full attributes and the viewport keeps those indices across a new packet', async () => {
        await createWorkspaceLayer({ id: LAYER_ID, name: 'Mileposts' });
        const features = [
            milepost('0015P', -111.9),
            milepost('0080P', -111.8),
            milepost('0015P', -111.7),
            milepost(15, -111.6)
        ];
        // Map display copies only `name`. Route stays in the attribute store.
        await appendWorkspaceBatch(LAYER_ID, features, 0, null, { displayFields: ['name'] });

        const layer = {
            id: LAYER_ID,
            name: 'Mileposts',
            type: 'spatial-chunked',
            storage: 'workspace',
            workspaceLayerId: LAYER_ID,
            geojson: { type: 'FeatureCollection', features: [] },
            schema: { geometryType: 'Point', featureCount: 4, fields: [] }
        };
        const { matchIndices } = await commitWorkspaceAttributeFilter(layer, {
            rules: [{ field: 'route', operator: 'equals', value: '0015P' }],
            logic: 'AND'
        });
        expect(matchIndices).toEqual([0, 2]);
        expect(await getWorkspaceFeatureAttributes(LAYER_ID, 0)).toMatchObject({ route: '0015P' });
        expect((await getWorkspaceFeatureAttributes(LAYER_ID, 1)).route).toBe('0080P');

        const unfiltered = await buildViewportGeoJSON(LAYER_ID, [-112, 40, -111, 41]);
        expect(unfiltered.features).toHaveLength(4);
        expect(unfiltered.features.every((f) => f.properties.route == null)).toBe(true);

        const filtered = await buildViewportGeoJSON(LAYER_ID, [-112, 40, -111, 41], {
            indexAllowlist: new Set(layer._workspaceFilterIndices)
        });
        expect(filtered.features.map((f) => f.properties._featureIndex).sort((a, b) => a - b)).toEqual([0, 2]);

        const again = await buildViewportGeoJSON(LAYER_ID, [-112.2, 40.2, -111.2, 40.9], {
            indexAllowlist: new Set(layer._workspaceFilterIndices)
        });
        expect(again.features.map((f) => f.properties._featureIndex).sort((a, b) => a - b)).toEqual([0, 2]);

        const exported = await materializeWorkspaceGeoJSON({
            ...layer,
            geojson: unfiltered
        });
        expect(exported.features.map((f) => f.properties.route).sort()).toEqual(['0015P', '0015P']);
        expect(exported.features.every((f) => f.properties._featureIndex == null)).toBe(true);

        const saved = serializeLayerForPersistence(layer);
        expect(saved.workspaceAttributeFilter.rules[0].value).toBe('0015P');
        expect(saved._workspaceFilterIndices).toBeUndefined();
        const restored = buildDatasetFromWorkspaceRef(saved);
        expect(restored.workspaceAttributeFilter.logic).toBe('AND');
    });

    it('tiles drop features outside the matching index set', () => {
        const tileBbox = [-112, 40, -111, 41];
        const chunks = [{
            features: [10, 11, 12].map((idx) => ({
                type: 'Feature',
                properties: { _featureIndex: idx, name: `p${idx}` },
                geometry: { type: 'Point', coordinates: [-111.5, 40.5] }
            }))
        }];
        const { features } = selectTileFeatures(chunks, tileBbox, 12, {
            indexAllowlist: new Set([11])
        });
        expect(features.map((f) => f.properties._featureIndex)).toEqual([11]);
    });
});
