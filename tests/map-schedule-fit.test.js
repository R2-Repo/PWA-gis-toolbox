// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/core/state.js', () => ({
    getActiveLayer: () => null,
    setActiveLayer: vi.fn(),
    isLayerLocked: () => false,
    getMapLayerOrderIds: () => [],
    getLayers: () => []
}));

vi.mock('../js/core/event-bus.js', () => ({
    default: { on: vi.fn(), emit: vi.fn() }
}));

vi.mock('../js/core/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { MapManager } from '../js/map/map-manager.js';

function createMockMap(overrides = {}) {
    const listeners = {};
    const mockMap = {
        loaded: () => true,
        isMoving: () => false,
        resize: vi.fn(),
        stop: vi.fn(),
        fitBounds: vi.fn(),
        getCenter: () => ({ lat: 39, lng: -111 }),
        getZoom: () => 7,
        getContainer: () => ({ clientWidth: 800, clientHeight: 600 }),
        getCanvas: () => ({ clientWidth: 800, clientHeight: 600 }),
        cameraForBounds: () => ({
            center: { lng: 0.5, lat: 0.5 },
            zoom: 10
        }),
        on: (event, handler) => {
            listeners[event] = listeners[event] || [];
            listeners[event].push(handler);
        },
        off: (event, handler) => {
            if (!listeners[event]) return;
            listeners[event] = listeners[event].filter((entry) => entry !== handler);
        },
        once: (event, handler) => {
            const wrapped = (...args) => {
                mockMap.off(event, wrapped);
                handler(...args);
            };
            mockMap.on(event, wrapped);
        },
        emit: (event, ...args) => {
            for (const handler of [...(listeners[event] || [])]) {
                handler(...args);
            }
        },
        ...overrides
    };
    return mockMap;
}

let mockMap;

describe('MapManager.scheduleMapFit', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });
        mockMap = createMockMap();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('debounces rapid fit requests and applies only the last bounds', async () => {
        const manager = new MapManager();
        manager.map = mockMap;

        const first = manager.scheduleMapFit({
            bounds: [[0, 0], [1, 1]]
        });
        const second = manager.scheduleMapFit({
            bounds: [[10, 10], [11, 11]]
        });

        await vi.advanceTimersByTimeAsync(80);
        await Promise.all([first, second]);

        expect(mockMap.stop).toHaveBeenCalled();
        expect(mockMap.fitBounds).toHaveBeenCalledTimes(1);
        expect(mockMap.fitBounds).toHaveBeenCalledWith(
            [[10, 10], [11, 11]],
            expect.objectContaining({ duration: 0, maxZoom: 16 })
        );
    });

    it('cancels an in-flight fit when a newer request arrives during async bounds work', async () => {
        const manager = new MapManager();
        manager.map = mockMap;

        let releaseBounds;
        const boundsGate = new Promise((resolve) => {
            releaseBounds = resolve;
        });
        manager._computeLayersBounds = vi.fn(async () => {
            await boundsGate;
            return [[0, 0], [1, 1]];
        });

        const first = manager.scheduleFitToLayers(['layer-a']);
        await vi.advanceTimersByTimeAsync(80);

        const second = manager.scheduleMapFit({
            bounds: [[20, 20], [21, 21]]
        });
        await vi.advanceTimersByTimeAsync(80);

        releaseBounds();
        await Promise.all([first, second]);

        expect(mockMap.fitBounds).toHaveBeenCalledTimes(1);
        expect(mockMap.fitBounds).toHaveBeenCalledWith(
            [[20, 20], [21, 21]],
            expect.objectContaining({ duration: 0 })
        );
    });

    it('skips fitBounds when the camera already matches the target bounds', async () => {
        mockMap = createMockMap({
            getCenter: () => ({ lng: 0.5, lat: 0.5 }),
            getZoom: () => 10,
            cameraForBounds: () => ({
                center: { lng: 0.5, lat: 0.5 },
                zoom: 10
            })
        });
        const manager = new MapManager();
        manager.map = mockMap;

        const pending = manager.scheduleMapFit({
            bounds: [[0, 0], [1, 1]]
        });
        await vi.advanceTimersByTimeAsync(80);
        await pending;

        expect(mockMap.fitBounds).not.toHaveBeenCalled();
        expect(mockMap.resize).not.toHaveBeenCalled();
    });

    it('skips resize when canvas already matches container size', async () => {
        const manager = new MapManager();
        manager.map = mockMap;

        const pending = manager.scheduleMapFit({
            bounds: [[0, 0], [1, 1]]
        });
        await vi.advanceTimersByTimeAsync(80);
        await pending;

        expect(mockMap.resize).not.toHaveBeenCalled();
        expect(mockMap.fitBounds).toHaveBeenCalledTimes(1);
    });
});
