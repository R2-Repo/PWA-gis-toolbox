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
            terrain: { getElevationForLngLatZoom: vi.fn() }
        };

        expect(manager.queryElevationAt(40.5, -111.8)).toBeNull();
        expect(manager.map.terrain.getElevationForLngLatZoom).not.toHaveBeenCalled();
    });

    it('returns AMSL elevation in meters when terrain is active', () => {
        const manager = new MapManager();
        manager.map = {
            getTerrain: () => ({ source: 'terrain-source', exaggeration: 1.5 }),
            transform: { tileZoom: 12 },
            terrain: {
                exaggeration: 1.5,
                getElevationForLngLatZoom: vi.fn(() => 3151.05)
            }
        };

        expect(manager.queryElevationAt(40.5, -111.8)).toBeCloseTo(2100.7, 5);
        expect(manager.map.terrain.getElevationForLngLatZoom).toHaveBeenCalled();
    });

    it('returns null when terrain tiles have no elevation sample', () => {
        const manager = new MapManager();
        manager.map = {
            getTerrain: () => ({ source: 'terrain-source', exaggeration: 1.5 }),
            transform: { tileZoom: 12 },
            terrain: {
                exaggeration: 1.5,
                getElevationForLngLatZoom: vi.fn(() => null)
            }
        };

        expect(manager.queryElevationAt(0, 0)).toBeNull();
    });
});
