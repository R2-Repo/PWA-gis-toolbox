import { describe, expect, it, vi } from 'vitest';
import {
    UDOT_FIBER_DRAW_ORDER,
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
    });

    it('detects Fiber layer keys from MapServer URLs', () => {
        expect(udotFiberKeyFromUrl(
            'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/0'
        )).toBe('cabinets');
        expect(udotFiberKeyFromUrl('https://example.com/MapServer/0')).toBeNull();
    });

    it('moves cabinets last so they stay on top', () => {
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
            { key: 'fiber', mapLayerIds: ['fiber-line'] }
        ]);

        orderUdotFiberLayers(map, byKey);

        expect(added.some((step) => step.id === 'fiber-line')).toBe(true);
        expect(added.some((step) => step.id === 'box-glyph')).toBe(true);
        expect(added.at(-1)).toEqual({ id: 'cab-glyph', beforeId: null });
        const cabGuarantee = added.filter((step) => step.id === 'cab-glyph' && step.beforeId === null);
        expect(cabGuarantee.length).toBeGreaterThanOrEqual(1);
    });
});
