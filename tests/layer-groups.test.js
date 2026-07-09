import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
    globalThis.window = { innerWidth: 1024, addEventListener: () => {} };
});

import { getState } from '../js/core/state.js';
import { createSpatialDataset } from '../js/core/data-model.js';
import {
    setLayerGroups,
    clearAllLayerGroups,
    createImportGroupForDatasets,
    resolveImportGroupName,
    buildLayerPanelRows,
    expandLayerIdsForRemoval,
    onLayerRemoved,
    reconcileGroupsAfterReorder,
    createManualGroupFromLayerIds,
    dissolveLayerGroup,
    getLayerGroups
} from '../js/core/layer-groups.js';

function makeLayer(name, extra = {}) {
    return createSpatialDataset(name, {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }]
    }, { file: 'test.kmz', format: 'kmz', ...extra.source && { file: extra.source.file } });
}

beforeEach(() => {
    getState().layers = [];
    clearAllLayerGroups();
});

describe('layer-groups', () => {
    it('resolveImportGroupName prefers source file', () => {
        const datasets = [
            makeLayer('roads.kmz - Points'),
            makeLayer('roads.kmz - Lines')
        ];
        expect(resolveImportGroupName(datasets)).toBe('test.kmz');
        datasets[0].source.file = 'roads.kmz';
        expect(resolveImportGroupName(datasets)).toBe('roads.kmz');
    });

    it('createImportGroupForDatasets groups multi-layer imports', () => {
        const a = makeLayer('file.kmz - Points');
        const b = makeLayer('file.kmz - Lines');
        const { group, datasets } = createImportGroupForDatasets([a, b]);
        expect(group).toBeTruthy();
        expect(group.childLayerIds).toEqual([a.id, b.id]);
        expect(datasets.every((ds) => ds.groupId === group.id)).toBe(true);
        expect(getLayerGroups()).toHaveLength(1);
    });

    it('does not create a group for a single layer', () => {
        const a = makeLayer('solo');
        const { group } = createImportGroupForDatasets([a]);
        expect(group).toBeNull();
        expect(getLayerGroups()).toHaveLength(0);
    });

    it('buildLayerPanelRows nests grouped children under a group row', () => {
        const a = makeLayer('a');
        const b = makeLayer('b');
        createImportGroupForDatasets([a, b]);
        getState().layers = [a, b];
        const rows = buildLayerPanelRows(getState().layers);
        expect(rows).toHaveLength(1);
        expect(rows[0].type).toBe('group');
        expect(rows[0].children).toHaveLength(2);
    });

    it('expandLayerIdsForRemoval expands group ids to child layer ids', () => {
        const a = makeLayer('a');
        const b = makeLayer('b');
        const { group } = createImportGroupForDatasets([a, b]);
        getState().layers = [a, b];
        const expanded = expandLayerIdsForRemoval([group.id], getState().layers);
        expect(expanded.sort()).toEqual([a.id, b.id].sort());
    });

    it('onLayerRemoved dissolves groups with fewer than two children', () => {
        const a = makeLayer('a');
        const b = makeLayer('b');
        createImportGroupForDatasets([a, b]);
        getState().layers = [a, b];
        onLayerRemoved(a.id, getState().layers.filter((l) => l.id !== a.id));
        getState().layers = getState().layers.filter((l) => l.id !== a.id);
        expect(getLayerGroups()).toHaveLength(0);
        expect(getState().layers[0].groupId).toBeUndefined();
    });

    it('createManualGroupFromLayerIds groups selected layers', () => {
        const a = makeLayer('a');
        const b = makeLayer('b');
        const c = makeLayer('c');
        getState().layers = [a, b, c];
        const group = createManualGroupFromLayerIds([a.id, c.id], getState().layers);
        expect(group).toBeTruthy();
        expect(a.groupId).toBe(group.id);
        expect(c.groupId).toBe(group.id);
        expect(b.groupId).toBeUndefined();
    });

    it('reconcileGroupsAfterReorder dissolves non-contiguous groups', () => {
        const a = makeLayer('a');
        const b = makeLayer('b');
        const c = makeLayer('c');
        createImportGroupForDatasets([a, b]);
        getState().layers = [a, c, b];
        reconcileGroupsAfterReorder(getState().layers);
        expect(getLayerGroups()).toHaveLength(0);
    });

    it('dissolveLayerGroup removes metadata but keeps layers', () => {
        const a = makeLayer('a');
        const b = makeLayer('b');
        const { group } = createImportGroupForDatasets([a, b]);
        getState().layers = [a, b];
        dissolveLayerGroup(group.id, getState().layers);
        expect(getLayerGroups()).toHaveLength(0);
        expect(getState().layers).toHaveLength(2);
    });
});
