import { describe, expect, it } from 'vitest';
import { resolveLayerDisplayMode, layerHasDisplayModeBadge } from '../js/map/layer-display-mode.js';
import { TILED_RENDER_THRESHOLD } from '../js/map/tiles/tile-constants.js';
import { RENDER_LIMITS } from '../js/map/render-limits.js';

function workspaceLayer(featureCount) {
    return {
        id: 'ws-1',
        name: 'Roads',
        type: 'spatial-chunked',
        storage: 'workspace',
        schema: { featureCount },
        source: { format: 'geojson' }
    };
}

describe('resolveLayerDisplayMode', () => {
    it('returns null for non-workspace layers', () => {
        expect(resolveLayerDisplayMode({ type: 'spatial', geojson: { features: [] } })).toBeNull();
        expect(resolveLayerDisplayMode(null)).toBeNull();
        expect(layerHasDisplayModeBadge({ type: 'service' })).toBe(false);
    });

    it('uses viewport mode below the tile threshold', () => {
        const display = resolveLayerDisplayMode(workspaceLayer(12_345), { tiled: false });
        expect(display.mode).toBe('viewport');
        expect(display.badge).toBe('VIEWPORT');
        expect(display.toastMessage).toMatch(/VIEWPORT badge/i);
        expect(display.details.some((line) => line.includes(String(RENDER_LIMITS.maxFeaturesPerSource.toLocaleString())))).toBe(true);
        expect(display.details.some((line) => /box-select/i.test(line))).toBe(true);
    });

    it('calls out truncation when the current viewport packet is capped', () => {
        const layer = workspaceLayer(20_000);
        layer._viewportTruncated = true;
        const display = resolveLayerDisplayMode(layer, { tiled: false, truncated: true });
        expect(display.mode).toBe('viewport');
        expect(display.truncated).toBe(true);
        expect(display.toastMessage).toMatch(/capped/i);
        expect(display.summary).toMatch(/draw cap|thinned/i);
    });

    it('uses tiled mode when map entry is tiled', () => {
        const display = resolveLayerDisplayMode(workspaceLayer(100), { tiled: true });
        expect(display.mode).toBe('tiled');
        expect(display.badge).toBe('TILED');
        expect(display.shortLabel).toMatch(/tiles/i);
        expect(display.toastMessage).toMatch(/TILED badge/i);
    });

    it('infers tiled when map entry is missing and count is at threshold', () => {
        const display = resolveLayerDisplayMode(workspaceLayer(TILED_RENDER_THRESHOLD), null);
        expect(display.mode).toBe('tiled');
        expect(layerHasDisplayModeBadge(workspaceLayer(TILED_RENDER_THRESHOLD))).toBe(true);
    });

    it('keeps viewport when map entry is missing below threshold', () => {
        const display = resolveLayerDisplayMode(workspaceLayer(TILED_RENDER_THRESHOLD - 1), null);
        expect(display.mode).toBe('viewport');
    });
});
