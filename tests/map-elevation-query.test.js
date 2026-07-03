// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MapManager } from '../js/map/map-manager.js';
import { formatElevationLabel } from '../js/map/map-service.js';

describe('formatElevationLabel', () => {
    it('formats meters and feet with grouping', () => {
        expect(formatElevationLabel(1432.4)).toBe('1,432 m (4,699 ft)');
    });
});

describe('MapManager.queryElevationAt', () => {
    it('returns null when terrain is not active', () => {
        const manager = new MapManager();
        manager.map = {
            getTerrain: () => null,
            queryTerrainElevation: vi.fn()
        };

        expect(manager.queryElevationAt(40.5, -111.8)).toBeNull();
        expect(manager.map.queryTerrainElevation).not.toHaveBeenCalled();
    });

    it('returns elevation in meters when terrain is active', () => {
        const manager = new MapManager();
        manager.map = {
            getTerrain: () => ({ source: 'terrain-source' }),
            queryTerrainElevation: vi.fn(() => 2100.7)
        };

        expect(manager.queryElevationAt(40.5, -111.8)).toBe(2100.7);
        expect(manager.map.queryTerrainElevation).toHaveBeenCalledWith([-111.8, 40.5]);
    });

    it('returns null when MapLibre has no tile data yet', () => {
        const manager = new MapManager();
        manager.map = {
            getTerrain: () => ({ source: 'terrain-source' }),
            queryTerrainElevation: vi.fn(() => null)
        };

        expect(manager.queryElevationAt(0, 0)).toBeNull();
    });
});
