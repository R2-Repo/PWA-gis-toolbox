import { describe, expect, it } from 'vitest';
import { mapUnifiedBuildingsRows, isHubBuildingType } from '../js/atlas/import/unified-buildings.js';
import { expandDropChunk, classifyScanResult } from '../js/atlas/ip-allocation.js';
import { computeCutExtent } from '../js/atlas/cut-extent.js';

describe('unified buildings import', () => {
    it('maps hub and building rows by type', () => {
        const { hubs, buildings } = mapUnifiedBuildingsRows([
            { 'Building Type': 'Hub', Hub_Number: '1-01', 'Hub AKA': 'Main', Lat: '40.1', Lon: '-111.1' },
            { 'Building Type': 'TOC', 'Building Name': 'Site A', 'From Hub': '1-01', 'Switch_1_IP': '10.0.0.50' }
        ]);
        expect(hubs.length).toBe(1);
        expect(hubs[0].hubCode).toBe('1-01');
        expect(buildings.length).toBe(1);
        expect(buildings[0].buildingName).toBe('Site A');
    });

    it('detects hub building type', () => {
        expect(isHubBuildingType({ 'Building Type': 'Hub' })).toBe(true);
        expect(isHubBuildingType({ 'Building Type': 'TOC' })).toBe(false);
    });
});

describe('ip allocation', () => {
    it('expands drop chunk from switch IP', () => {
        const chunk = expandDropChunk('10.0.0.1', 4);
        expect(chunk).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4']);
    });

    it('classifies scan results', () => {
        const expected = new Set(['10.0.0.1']);
        expect(classifyScanResult('10.0.0.1', expected, true)).toBe('expected_up');
        expect(classifyScanResult('10.0.0.2', expected, true)).toBe('rogue');
    });
});

describe('cut extent', () => {
    it('returns low confidence with insufficient downs', () => {
        const snap = {
            drops: [{ id: 'd1', channelNumber: 'C1', lat: 40, lon: -111, ip: '10.0.0.1' }]
        };
        const result = computeCutExtent(snap, { '10.0.0.1': { reachable: false } }, {});
        expect(result.confidence).toBe('low');
    });
});
