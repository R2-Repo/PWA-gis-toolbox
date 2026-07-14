// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureMapCaptureReady } from '../js/map/map-export.js';

function createMockMap(overrides = {}) {
    const listeners = {};
    let moving = overrides.moving ?? false;
    let tilesLoaded = overrides.tilesLoaded ?? true;
    let idleCount = 0;

    const map = {
        loaded: () => true,
        isStyleLoaded: () => true,
        isMoving: () => moving,
        areTilesLoaded: () => tilesLoaded,
        triggerRepaint: vi.fn(),
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
                map.off(event, wrapped);
                handler(...args);
            };
            map.on(event, wrapped);
        },
        emit: (event, ...args) => {
            for (const handler of [...(listeners[event] || [])]) {
                handler(...args);
            }
        },
        finishMove() {
            moving = false;
            map.emit('moveend');
        },
        finishIdle() {
            idleCount += 1;
            map.emit('idle');
        },
        setTilesLoaded(value) {
            tilesLoaded = value;
        },
        get idleCount() {
            return idleCount;
        }
    };

    return map;
}

async function flushAsync() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('ensureMapCaptureReady', () => {
    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('waits for moveend before tiles and idle when the camera is moving', async () => {
        const map = createMockMap({ moving: true, tilesLoaded: false });
        const order = [];

        const readyPromise = ensureMapCaptureReady(map, {
            maxWaitMs: 5000,
            stableFrames: 1
        }).then(() => order.push('ready'));

        await flushAsync();
        map.finishMove();
        order.push('moveend');
        await flushAsync();
        expect(order).toEqual(['moveend']);

        map.setTilesLoaded(true);
        map.finishIdle();
        await flushAsync();
        map.finishIdle();
        await readyPromise;

        expect(order[order.length - 1]).toBe('ready');
        expect(map.idleCount).toBeGreaterThanOrEqual(2);
    });

    it('does not resolve on moveend alone when tiles are still loading', async () => {
        const map = createMockMap({ moving: true, tilesLoaded: false });
        let settled = false;

        const readyPromise = ensureMapCaptureReady(map, {
            maxWaitMs: 5000,
            stableFrames: 1
        }).then(() => {
            settled = true;
        });

        await flushAsync();
        map.finishMove();
        await flushAsync();
        expect(settled).toBe(false);

        map.setTilesLoaded(true);
        map.finishIdle();
        await flushAsync();
        map.finishIdle();
        await readyPromise;

        expect(settled).toBe(true);
    });

    it('requires consecutive stable tile passes when stableFrames is 2', async () => {
        const map = createMockMap({ moving: false, tilesLoaded: true });

        const readyPromise = ensureMapCaptureReady(map, {
            maxWaitMs: 5000,
            stableFrames: 2
        });

        await flushAsync();
        map.finishIdle();
        await flushAsync();
        map.finishIdle();
        await flushAsync();
        map.finishIdle();
        await flushAsync();
        map.finishIdle();
        await readyPromise;

        expect(map.idleCount).toBeGreaterThanOrEqual(3);
    });
});
