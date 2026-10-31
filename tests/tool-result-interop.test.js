/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../js/widgets/registry.js';
import {
    buildProducedResult,
    emitProducedResult,
    getCompatibleTargets,
    armSendToInput,
    takePendingSendToLayer,
    sendResultToTarget,
    clearPendingSendTo
} from '../js/tools/tool-result-interop.js';
import { onToolResult, getTool } from '../js/tools/tool-registry.js';
import * as toolRegistry from '../js/tools/tool-registry.js';

describe('tool result interop', () => {
    beforeEach(() => {
        clearPendingSendTo();
    });

    it('buildProducedResult fills default output from layerIds', () => {
        const result = buildProducedResult('buffer', { layerIds: ['layer-1'] });
        expect(result).toEqual({
            sourceId: 'buffer',
            layerIds: ['layer-1'],
            outputs: [{ name: 'out', type: 'layer' }],
            stats: {}
        });
    });

    it('emitProducedResult delivers typed payload on onToolResult', () => {
        let received;
        const off = onToolResult((payload) => {
            received = payload;
        });
        emitProducedResult(buildProducedResult('spatial-join', {
            layerIds: ['out-1'],
            outputs: [{ name: 'out', type: 'layer', geometry: ['Point'] }],
            stats: { outCount: 3, failed: 0 }
        }));
        off();
        expect(received).toMatchObject({
            id: 'spatial-join',
            sourceId: 'spatial-join',
            layerIds: ['out-1'],
            outputs: [{ name: 'out', type: 'layer', geometry: ['Point'] }],
            stats: { outCount: 3, failed: 0 }
        });
    });

    it('getCompatibleTargets matches layer type and excludes hidden entries', () => {
        const result = buildProducedResult('spatial-join', {
            layerIds: ['x'],
            outputs: [{ name: 'out', type: 'layer', geometry: ['Point'] }]
        });
        const targets = getCompatibleTargets(result);
        const ids = targets.map(({ entry }) => entry.id);
        expect(ids).not.toContain('spatial-join');
        expect(ids).not.toContain('plan-set-callouts');
        expect(ids).toContain('buffer');
        expect(ids).toContain('bulk-update');
    });

    it('getCompatibleTargets excludes self by default', () => {
        const result = buildProducedResult('buffer', {
            layerIds: ['x'],
            outputs: [{ name: 'out', type: 'layer' }]
        });
        const targets = getCompatibleTargets(result);
        expect(targets.some(({ entry }) => entry.id === 'buffer')).toBe(false);
    });

    it('getCompatibleTargets can include self when excludeSelf is false', () => {
        const result = buildProducedResult('buffer', {
            layerIds: ['x'],
            outputs: [{ name: 'out', type: 'layer' }]
        });
        const targets = getCompatibleTargets(result, { excludeSelf: false });
        expect(targets.some(({ entry }) => entry.id === 'buffer')).toBe(true);
    });

    it('armSendToInput is consumed only for matching tool id', () => {
        armSendToInput('buffer', 'layer-a', 'in');
        expect(takePendingSendToLayer('simplify')).toBeNull();
        expect(takePendingSendToLayer('buffer')).toBe('layer-a');
        expect(takePendingSendToLayer('buffer')).toBeNull();
    });

    it('sendResultToTarget opens widgets with initialInput', () => {
        const open = vi.fn();
        vi.spyOn(toolRegistry, 'getTool').mockReturnValue({
            id: 'bulk-update',
            kind: ['widget'],
            status: 'ga',
            label: 'Bulk Update',
            inputs: [{ name: 'in', type: 'layer', required: true }],
            open
        });

        const ctx = { showToast: vi.fn() };
        const result = buildProducedResult('spatial-join', {
            layerIds: ['layer-z'],
            outputs: [{ name: 'out', type: 'layer' }]
        });

        sendResultToTarget(ctx, 'bulk-update', result);
        expect(open).toHaveBeenCalledWith(ctx, {
            initialInput: {
                layerId: 'layer-z',
                inputName: 'in',
                result
            }
        });
        vi.restoreAllMocks();
    });
});

describe('registry emit payload shape for wired producers', () => {
    it('spatial-join registry declares layer in/out ports', () => {
        const entry = getTool('spatial-join');
        expect(entry?.outputs?.[0]?.type).toBe('layer');
        expect(entry?.inputs?.some((port) => port.type === 'layer')).toBe(true);
    });

    it('buffer map tool declares layer output port', () => {
        const entry = getTool('buffer');
        expect(entry?.outputs?.[0]?.type).toBe('layer');
        expect(entry?.inputs?.[0]?.type).toBe('layer');
    });
});
