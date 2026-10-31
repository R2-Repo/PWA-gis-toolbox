import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
    MAP_GIS_TOOLS,
    V1_MAP_TOOL_IDS,
    V1_PIPELINE_NODE_TYPES,
    isMapToolEnabled,
    isPipelineNodeEnabled,
    GIS_TOOL_V1_MODE
} from '../js/tools/tool-catalog.js';
import {
    getTool,
    listTools,
    getRegistryIndexSnapshot,
    onToolResult,
    emitToolResult,
    isVisible
} from '../js/tools/tool-registry.js';

const LEGACY_V1_MAP_TOOL_IDS = new Set([
    'buffer',
    'simplify',
    'clip-extent',
    'bbox-clip',
    'dissolve',
    'line-offset',
    'reproject',
    'union',
    'kinks',
    'sample',
    'explode',
    'polygon-to-line',
    'fill-holes',
    'split-by-line',
    'split-by-polygon',
    'vertex-reshape'
]);

const LEGACY_V1_PIPELINE_NODE_TYPES = new Set([
    'layer-input',
    'file-import',
    'split-column',
    'combine-fields',
    'template-builder',
    'find-replace',
    'type-convert',
    'filter-rows',
    'deduplicate',
    'join-lookup',
    'add-unique-id',
    'buffer',
    'simplify',
    'clip',
    'dissolve',
    'line-offset',
    'reproject',
    'spatial-join',
    'union',
    'sample',
    'explode',
    'polygon-to-line',
    'fill-holes',
    'split-by-line',
    'split-by-polygon',
    'add-to-map',
    'preview',
    'export'
]);

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const key of Object.keys(value)) {
            deepFreeze(value[key]);
        }
    }
    return value;
}

function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}

describe('tool registry v1', () => {
    it('has unique ids and no alias collisions', () => {
        const { ids, aliases } = getRegistryIndexSnapshot();
        expect(new Set(ids).size).toBe(ids.length);
        for (const [alias, canonical] of aliases) {
            expect(getTool(alias)?.id).toBe(canonical);
        }
    });

    it('every entry has version, status, and kind', () => {
        for (const entry of listTools()) {
            expect(Number.isInteger(entry.version)).toBe(true);
            expect(['ga', 'beta', 'hidden']).toContain(entry.status);
            expect(entry.kind.length).toBeGreaterThan(0);
        }
    });

    it('every run entry has inputs and outputs', () => {
        for (const entry of listTools()) {
            if (!entry.run) continue;
            expect(entry.inputs?.length, entry.id).toBeGreaterThan(0);
            expect(entry.outputs?.length, entry.id).toBeGreaterThan(0);
        }
    });

    it('visibility parity with legacy V1 map tool ids', () => {
        expect(setsEqual(V1_MAP_TOOL_IDS, LEGACY_V1_MAP_TOOL_IDS)).toBe(true);
        for (const t of MAP_GIS_TOOLS) {
            expect(isMapToolEnabled(t.id)).toBe(LEGACY_V1_MAP_TOOL_IDS.has(t.id));
        }
    });

    it('visibility parity with legacy V1 pipeline node types', () => {
        expect(setsEqual(V1_PIPELINE_NODE_TYPES, LEGACY_V1_PIPELINE_NODE_TYPES)).toBe(true);
        for (const type of LEGACY_V1_PIPELINE_NODE_TYPES) {
            expect(isPipelineNodeEnabled(type)).toBe(true);
        }
        expect(isPipelineNodeEnabled('combine')).toBe(false);
        expect(isPipelineNodeEnabled('coord-convert')).toBe(false);
    });

    it('resolves tools by alias', () => {
        expect(getTool('clip-extent')?.id).toBe('clip');
        expect(getTool('bbox-clip')?.id).toBe('clip');
        expect(isMapToolEnabled('clip-extent')).toBe(true);
        expect(isMapToolEnabled('bbox-clip')).toBe(true);
    });

    it('hidden entries still resolve by id', () => {
        expect(getTool('coord-convert')).toBeDefined();
        expect(getTool('coord-convert')?.status).toBe('hidden');
        expect(isMapToolEnabled('coord-convert')).toBe(false);
    });

    it('run wrappers do not mutate frozen inputs', async () => {
        const entry = getTool('buffer');
        expect(entry?.run).toBeTypeOf('function');
        const inputs = deepFreeze({
            in: {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: { id: 1 },
                        geometry: {
                            type: 'Point',
                            coordinates: [-111.9, 40.7]
                        }
                    }
                ]
            }
        });
        const params = deepFreeze({ distance: 10, units: 'meters' });
        const before = structuredClone(inputs);
        await entry.run(inputs, params, {});
        expect(inputs).toEqual(before);
    });

    it('workerSafe run module imports no DOM or UI code', () => {
        const bridgePath = join(dirname(fileURLToPath(import.meta.url)), '../js/tools/registry/compute-run-bridge.js');
        const source = readFileSync(bridgePath, 'utf8');
        expect(source).not.toMatch(/\bdocument\b/);
        expect(source).not.toMatch(/\bwindow\b/);
        expect(source).not.toMatch(/task-runner/);
        expect(source).not.toMatch(/tool-handlers/);
        for (const entry of listTools()) {
            if (entry.workerSafe) {
                expect(entry.run).toBeTypeOf('function');
            }
        }
    });

    it('emitToolResult delivers onToolResult payloads', () => {
        let received;
        const off = onToolResult((payload) => {
            received = payload;
        });
        emitToolResult({ id: 'export', layerIds: ['a'], stats: { outCount: 1 } });
        off();
        expect(received).toEqual({ id: 'export', layerIds: ['a'], stats: { outCount: 1 } });
    });

    it('coord-convert stays hidden on map panel when v1 mode is on', () => {
        expect(GIS_TOOL_V1_MODE).toBe(true);
        expect(isVisible(getTool('coord-convert'), 'mapPanel', { v1Mode: true })).toBe(false);
    });
});
