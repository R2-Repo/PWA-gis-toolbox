/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMapService } from '../js/map/map-service.js';
import { installDualScreenMapServiceDecorator } from '../js/dual-screen/map-bridge.js';
import { createSecondaryProtocol } from '../js/dual-screen/secondary-protocol.js';
import { guardRemoteMapJumps } from '../js/dual-screen/secondary-client.js';
import { MessageType } from '../js/dual-screen/protocol.js';
import {
    camerasNearlyEqual,
    isViewportEchoSuppressed,
    nextViewportBroadcast,
    resetViewportEchoSuppression,
    suppressViewportEcho
} from '../js/dual-screen/viewport-echo.js';

afterEach(() => {
    resetViewportEchoSuppression();
});

describe('dual-screen viewport echo', () => {
    it('treats a round-tripped camera as the same view', () => {
        const camera = { center: [-111.891, 40.7608], zoom: 12, bearing: 0, pitch: 0 };
        expect(camerasNearlyEqual(camera, { ...camera, bearing: 0.01 })).toBe(true);
        expect(camerasNearlyEqual(camera, { ...camera, zoom: 12.2 })).toBe(false);
        expect(camerasNearlyEqual(null, camera)).toBe(false);
    });

    it('drops a broadcast while a remote jump is in flight and drops a duplicate camera', () => {
        const payload = { center: [-111.5, 40.5], zoom: 11, bearing: 0, pitch: 0, source: 'secondary' };
        expect(nextViewportBroadcast({
            echoSuppressed: true,
            localSuppressed: false,
            lastSent: null,
            payload
        })).toEqual({ send: false, lastSent: null });

        const first = nextViewportBroadcast({
            echoSuppressed: false,
            localSuppressed: false,
            lastSent: null,
            payload
        });
        expect(first.send).toBe(true);
        expect(nextViewportBroadcast({
            echoSuppressed: false,
            localSuppressed: false,
            lastSent: first.lastSent,
            payload: { ...payload }
        }).send).toBe(false);
    });

    it('releases echo suppression on moveend so a later pan can broadcast', () => {
        let moveend = null;
        const map = {
            once: (_name, fn) => { moveend = fn; },
            off: () => { moveend = null; }
        };
        suppressViewportEcho(map);
        expect(isViewportEchoSuppressed()).toBe(true);
        moveend();
        expect(isViewportEchoSuppressed()).toBe(false);
    });

    it('does not rebroadcast a viewport while a remote jump is suppressed', () => {
        const posted = [];
        const protocol = createSecondaryProtocol({
            sessionId: 'echo',
            post: (message) => posted.push(message),
            onApply() {}
        });
        protocol.markHandshakeReady();
        const map = { once() {}, off() {} };
        suppressViewportEcho(map);
        protocol.enqueueOutbound(MessageType.VIEWPORT, {
            center: [-111.5, 40.5],
            zoom: 11,
            bearing: 0,
            pitch: 0
        });
        expect(posted.some((message) => message.type === MessageType.VIEWPORT)).toBe(false);
        resetViewportEchoSuppression();
        protocol.enqueueOutbound(MessageType.VIEWPORT, {
            center: [-111.6, 40.6],
            zoom: 12,
            bearing: 0,
            pitch: 0
        });
        expect(posted.filter((message) => message.type === MessageType.VIEWPORT)).toHaveLength(1);
    });

    it('skips a jumpTo that would only echo the current camera', () => {
        const state = { center: [-111.2, 40.2], zoom: 9, bearing: 0, pitch: 0 };
        let jumps = 0;
        const map = {
            getCenter: () => ({ lng: state.center[0], lat: state.center[1] }),
            getZoom: () => state.zoom,
            getBearing: () => state.bearing,
            getPitch: () => state.pitch,
            once() {},
            off() {},
            jumpTo(camera) {
                jumps += 1;
                state.center = [...camera.center];
                state.zoom = camera.zoom;
            }
        };
        guardRemoteMapJumps(map);
        map.jumpTo({ center: [-112, 41], zoom: 8, bearing: 0, pitch: 0 });
        expect(jumps).toBe(1);
        expect(isViewportEchoSuppressed()).toBe(true);
        map.jumpTo({ center: [-112, 41], zoom: 8, bearing: 0, pitch: 0 });
        expect(jumps).toBe(1);
    });

    it('does not jump again when the map is already on that camera', () => {
        const state = { center: [-111, 40], zoom: 10, bearing: 0, pitch: 0 };
        let jumps = 0;
        const map = {
            getCenter: () => ({ lng: state.center[0], lat: state.center[1] }),
            getZoom: () => state.zoom,
            getBearing: () => state.bearing,
            getPitch: () => state.pitch,
            jumpTo(camera) {
                jumps += 1;
                state.center = [...camera.center];
                state.zoom = camera.zoom;
                state.bearing = camera.bearing;
                state.pitch = camera.pitch;
            }
        };
        const api = createMapService({ mapAdapter: { getMap: () => map } });
        expect(api.applyMapView({ center: [-112, 41], zoom: 8, bearing: 1, pitch: 2 })).toBe(true);
        expect(jumps).toBe(1);
        expect(api.applyMapView({ center: [-112, 41], zoom: 8, bearing: 1, pitch: 2 })).toBe(true);
        expect(jumps).toBe(1);
    });

    it('does not throw a local map read out of the bridge while dual screen is on', () => {
        const api = {
            getMap: () => ({ id: 'gone' }),
            getLayerIds: () => { throw new Error('map is gone'); }
        };
        const uninstall = installDualScreenMapServiceDecorator(api, { isActive: true });
        expect(api.getMap()).toBeNull();
        expect(api.getLayerIds()).toBeUndefined();
        expect(() => api.getLayerIds()).not.toThrow();
        uninstall();
        expect(() => api.getLayerIds()).toThrow(/map is gone/);
    });
});
