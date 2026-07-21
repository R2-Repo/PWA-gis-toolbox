import { describe, expect, it } from 'vitest';
import { describeAtlasFocus } from '../js/atlas/focus-label.js';

describe('atlas focus label', () => {
    it('describes network when nothing selected', () => {
        const focus = describeAtlasFocus({
            loaded: true,
            hubs: [],
            channels: [],
            drops: [],
            devices: [],
            sites: [],
            selection: null,
            areaResults: null
        });
        expect(focus.canClear).toBe(false);
        expect(focus.title).toBe('Network');
    });

    it('prefers entity selection over area', () => {
        const focus = describeAtlasFocus({
            loaded: true,
            hubs: [{ id: 'h1', hubCode: 'H1', name: 'North' }],
            channels: [],
            drops: [],
            devices: [],
            sites: [],
            selection: { kind: 'hub', id: 'h1' },
            areaResults: { drops: [{}], channels: [], hubs: [] }
        });
        expect(focus.kind).toBe('hub');
        expect(focus.title).toBe('North');
        expect(focus.canClear).toBe(true);
    });

    it('describes area and drop details', () => {
        const area = describeAtlasFocus({
            loaded: true,
            hubs: [],
            channels: [],
            drops: [],
            selection: { kind: 'area', id: 'area' },
            areaResults: { drops: [{}, {}], channels: [{}], hubs: [{}] }
        });
        expect(area.kind).toBe('area');
        expect(area.detail).toContain('2 drops');

        const drop = describeAtlasFocus({
            loaded: true,
            hubs: [],
            channels: [],
            drops: [{
                id: 'd1',
                inventoryName: 'Cam 1',
                channelNumber: '12',
                dropNumber: 3,
                ip: '10.0.0.1'
            }],
            selection: { kind: 'drop', id: 'd1' },
            areaResults: null
        });
        expect(drop.title).toBe('Cam 1');
        expect(drop.detail).toContain('Ch 12');
        expect(drop.detail).toContain('10.0.0.1');
    });
});
