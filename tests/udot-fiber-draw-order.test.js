import { describe, expect, it, vi } from 'vitest';
import {
    UDOT_FIBER_DRAW_ORDER,
    collectUdotFiberOrderedIds,
    groupUdotFiberMapLayerIds,
    orderUdotFiberLayers,
    udotFiberDrawRank,
    udotFiberKeyFromUrl
} from '../js/symbology/udot-fiber/draw-order.js';

describe('UDOT Fiber draw order', () => {
    it('ranks cabinets above splices and boxes', () => {
        expect(UDOT_FIBER_DRAW_ORDER.at(-1)).toBe('cabinets');
        expect(udotFiberDrawRank('cabinets')).toBeGreaterThan(udotFiberDrawRank('splices'));
        expect(udotFiberDrawRank('splices')).toBeGreaterThan(udotFiberDrawRank('boxes'));
        expect(udotFiberDrawRank('boxes')).toBeGreaterThan(udotFiberDrawRank('building'));
        expect(udotFiberDrawRank('fiber')).toBeGreaterThan(udotFiberDrawRank('conduit'));
        expect(udotFiberDrawRank('boxes')).toBeGreaterThan(udotFiberDrawRank('fiber'));
    });

    it('detects Fiber layer keys from MapServer URLs', () => {
        expect(udotFiberKeyFromUrl(
            'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/0'
        )).toBe('cabinets');
        expect(udotFiberKeyFromUrl('https://example.com/MapServer/0')).toBeNull();
    });

    it('puts line paint at the back, conduit labels in front of lines, splice above box', () => {
        const byKey = groupUdotFiberMapLayerIds([
            { key: 'boxes', mapLayerIds: ['box-glyph'] },
            { key: 'splices', mapLayerIds: ['splice-glyph'] },
            { key: 'cabinets', mapLayerIds: ['cab-glyph'] },
            { key: 'fiber', mapLayerIds: ['fiber-line'] },
            { key: 'conduit', mapLayerIds: ['conduit-line', 'svc-conduit-line-labels'] }
        ]);
        const ordered = collectUdotFiberOrderedIds(byKey);

        expect(ordered.indexOf('conduit-line')).toBeLessThan(ordered.indexOf('fiber-line'));
        expect(ordered.indexOf('fiber-line')).toBeLessThan(ordered.indexOf('svc-conduit-line-labels'));
        expect(ordered.indexOf('svc-conduit-line-labels')).toBeLessThan(ordered.indexOf('box-glyph'));
        expect(ordered.indexOf('box-glyph')).toBeLessThan(ordered.indexOf('splice-glyph'));
        expect(ordered.at(-1)).toBe('cab-glyph');
    });

    it('moves layers to top in stack order so cabinets stay last', () => {
        const added = [];
        const map = {
            getLayer: (id) => ({ id }),
            moveLayer: vi.fn((id, beforeId) => {
                added.push({ id, beforeId: beforeId || null });
            })
        };
        const byKey = groupUdotFiberMapLayerIds([
            { key: 'boxes', mapLayerIds: ['box-glyph'] },
            { key: 'splices', mapLayerIds: ['splice-glyph'] },
            { key: 'cabinets', mapLayerIds: ['cab-glyph'] },
            { key: 'fiber', mapLayerIds: ['fiber-line'] },
            { key: 'conduit', mapLayerIds: ['conduit-line', 'svc-conduit-line-labels'] }
        ]);

        orderUdotFiberLayers(map, byKey);

        expect(added.map((step) => step.id)).toEqual([
            'conduit-line',
            'fiber-line',
            'svc-conduit-line-labels',
            'box-glyph',
            'splice-glyph',
            'cab-glyph'
        ]);
        expect(added.every((step) => step.beforeId === null)).toBe(true);
        expect(added.at(-1)).toEqual({ id: 'cab-glyph', beforeId: null });
    });
});
