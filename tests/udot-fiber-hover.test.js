import { describe, expect, it } from 'vitest';
import {
    UDOT_FIBER_HOVER_FIELDS,
    buildUdotFiberHoverHtml,
    isUdotFiberLiveDataset,
    pickUdotFiberHoverRows
} from '../js/symbology/udot-fiber/hover-fields.js';
import {
    isUdotFiberHoverQueryLayerId,
    pickClosestUdotFiberHoverHit
} from '../js/symbology/udot-fiber/hover-tooltip.js';
import { buildUdotFiberHitRadiusExpression } from '../js/symbology/udot-fiber/zoom-scale.js';

describe('UDOT Fiber hover identify', () => {
    it('lists the requested fields per layer', () => {
        expect(UDOT_FIBER_HOVER_FIELDS.cabinets).toEqual(['NAME_ADDRESS', 'CHANNEL', 'DROP__']);
        expect(UDOT_FIBER_HOVER_FIELDS.splices).toEqual(['NAME', 'MODEL']);
        expect(UDOT_FIBER_HOVER_FIELDS.boxes).toEqual(['DT_RSCENCLOSURE_NAME']);
        expect(UDOT_FIBER_HOVER_FIELDS.fiber).toEqual(['Fiber_Label']);
        expect(UDOT_FIBER_HOVER_FIELDS.conduit).toEqual(['CustNameRight', 'CONDUIT_SYM']);
        expect(UDOT_FIBER_HOVER_FIELDS.building).toEqual(['NAME']);
    });

    it('picks populated hover rows and DROP__ aliases', () => {
        expect(pickUdotFiberHoverRows('splices', { NAME: 'SP-12', MODEL: 'Endpoint' })).toEqual([
            { field: 'NAME', value: 'SP-12' },
            { field: 'MODEL', value: 'Endpoint' }
        ]);
        expect(pickUdotFiberHoverRows('cabinets', {
            NAME_ADDRESS: '100 N',
            CHANNEL: '4',
            DROP_: 'A'
        })).toEqual([
            { field: 'NAME_ADDRESS', value: '100 N' },
            { field: 'CHANNEL', value: '4' },
            { field: 'DROP__', value: 'A' }
        ]);
        expect(pickUdotFiberHoverRows('boxes', { DT_RSCENCLOSURE_NAME: '' })).toEqual([]);
    });

    it('builds escaped hover html', () => {
        const html = buildUdotFiberHoverHtml('UDOT Fiber', 'fiber', { Fiber_Label: 'UDOT <144>' });
        expect(html).toContain('UDOT Fiber');
        expect(html).toContain('Fiber_Label');
        expect(html).toContain('UDOT &lt;144&gt;');
        expect(html).not.toContain('UDOT <144>');
    });

    it('detects Fiber live datasets only', () => {
        expect(isUdotFiberLiveDataset({
            type: 'service',
            service: {
                url: 'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6'
            }
        })).toBe(true);
        expect(isUdotFiberLiveDataset({
            type: 'spatial',
            source: {
                url: 'https://central.udot.utah.gov/server/rest/services/Fiber/UDOT_Fiber_Network/MapServer/6'
            }
        })).toBe(false);
        expect(isUdotFiberLiveDataset({
            type: 'service',
            service: { url: 'https://example.com/FeatureServer/0' }
        })).toBe(false);
    });

    it('skips hit, shadow, and label layers for hover queries', () => {
        expect(isUdotFiberHoverQueryLayerId('svc-lyr-boxes-glyph')).toBe(true);
        expect(isUdotFiberHoverQueryLayerId('svc-lyr-fiber-line')).toBe(true);
        expect(isUdotFiberHoverQueryLayerId('svc-lyr-boxes-hit')).toBe(false);
        expect(isUdotFiberHoverQueryLayerId('svc-lyr-fiber-shadow')).toBe(false);
        expect(isUdotFiberHoverQueryLayerId('svc-lyr-boxes-labels')).toBe(false);
    });

    it('picks the closer fiber line over a distant box', () => {
        const project = ([lng, lat]) => ({ x: lng, y: lat });
        const layers = new Map([
            ['boxes-glyph', { fiberKey: 'boxes', layerName: 'UDOT Boxes' }],
            ['fiber-line', { fiberKey: 'fiber', layerName: 'UDOT Fiber' }]
        ]);
        const picked = pickClosestUdotFiberHoverHit(
            { project },
            [
                {
                    layer: { id: 'boxes-glyph' },
                    geometry: { type: 'Point', coordinates: [40, 10] }
                },
                {
                    layer: { id: 'fiber-line' },
                    geometry: { type: 'LineString', coordinates: [[0, 0], [20, 0]] }
                }
            ],
            { x: 8, y: 1 },
            layers
        );
        expect(picked?.meta.fiberKey).toBe('fiber');
    });

    it('keeps box hit circles on the icon instead of a 16px halo', () => {
        const expr = buildUdotFiberHitRadiusExpression('boxes');
        expect(expr[4]).toBeLessThan(8);
        expect(expr[4]).toBeGreaterThanOrEqual(3);
    });
});
