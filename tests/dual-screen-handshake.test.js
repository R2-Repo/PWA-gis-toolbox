/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
    const state = { live: true };
    function fakeMap() {
        return {
            loaded: () => true,
            once(_event, fn) { fn?.(); },
            getCenter: () => ({ lng: -111.8, lat: 40.7 }),
            getZoom: () => 12,
            getBearing: () => 0,
            getPitch: () => 0,
            getBounds: () => ({
                getWest: () => -112,
                getSouth: () => 40,
                getEast: () => -111,
                getNorth: () => 41
            })
        };
    }
    const service = {
        getMap: vi.fn(() => (state.live ? fakeMap() : null)),
        destroy: vi.fn(() => { state.live = false; }),
        init: vi.fn(() => { state.live = true; }),
        addLayer: vi.fn(),
        addWorkspaceLayer: vi.fn(),
        reconcile3DState: vi.fn(),
        fitToAll: vi.fn(),
        setBasemapTone: vi.fn(),
        getBasemapTone: vi.fn(() => ({ tint: 'default', opacity: 1 })),
        getCurrentBasemap: vi.fn(() => 'voyager'),
        is3DEnabled: vi.fn(() => false),
        getLayerStyles: vi.fn(() => new Map()),
        setCurrentBasemap: vi.fn(),
        set3DEnabled: vi.fn(),
        resize: vi.fn(),
        setActiveLayerId: vi.fn(),
        clearSelection: vi.fn(),
        getTotalSelectionCount: vi.fn(() => 0),
        getSelectedIndices: vi.fn(() => []),
        getActiveLayerId: vi.fn(() => null)
    };
    return { state, service };
});

vi.mock('../js/map/map-service.js', () => ({
    default: harness.service,
    mapService: harness.service,
    formatElevationLabel: (meters) => String(meters)
}));

import { DualScreenChannel } from '../js/dual-screen/channel.js';
import dualScreenCoordinator from '../js/dual-screen/coordinator.js';
import {
    HELLO_TIMEOUT_MS,
    MessageType,
    createMessage,
    readDualSessionId
} from '../js/dual-screen/protocol.js';
import { createSecondaryProtocol } from '../js/dual-screen/secondary-protocol.js';
import {
    HELLO_TIMEOUT_NOTICE,
    PROTOCOL_MISMATCH_NOTICE
} from '../js/dual-screen/storage-hint.js';
import bus from '../js/core/event-bus.js';
import { subscribeToasts } from '../js/ui/toast.js';

const OTHER_PROTOCOL_VERSION = 99;

class MockBroadcastChannel {
    static hub = new Map();
    static traffic = [];

    constructor(name) {
        this.name = name;
        this.onmessage = null;
        this.closed = false;
        let peers = MockBroadcastChannel.hub.get(name);
        if (!peers) {
            peers = new Set();
            MockBroadcastChannel.hub.set(name, peers);
        }
        peers.add(this);
    }

    postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        MockBroadcastChannel.traffic.push(copy);
        const peers = [...(MockBroadcastChannel.hub.get(this.name) || [])];
        for (const peer of peers) {
            if (peer === this || peer.closed || typeof peer.onmessage !== 'function') continue;
            peer.onmessage({ data: JSON.parse(JSON.stringify(copy)) });
        }
    }

    close() {
        this.closed = true;
        MockBroadcastChannel.hub.get(this.name)?.delete(this);
    }
}

describe('dual-screen handshake', () => {
    /** @type {string[]} */
    let notices;
    let unsubscribe = () => {};
    let openedUrl = '';
    /** @type {{ closed: boolean, focus: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn> }} */
    let fakeWin;

    beforeEach(() => {
        vi.useFakeTimers();
        harness.state.live = true;
        harness.service.destroy.mockClear();
        harness.service.init.mockClear();
        MockBroadcastChannel.hub = new Map();
        MockBroadcastChannel.traffic = [];
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

        document.body.innerHTML = '<div id="map-container"></div>';
        Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });

        fakeWin = {
            closed: false,
            focus: vi.fn(),
            close: vi.fn(() => { fakeWin.closed = true; })
        };
        openedUrl = '';
        vi.spyOn(window, 'open').mockImplementation((url) => {
            openedUrl = String(url);
            return fakeWin;
        });

        notices = [];
        unsubscribe = subscribeToasts((event) => {
            if (event?.type === 'add' && event.toast?.message) notices.push(event.toast.message);
        });
    });

    afterEach(() => {
        try { dualScreenCoordinator.deactivate(); } catch { /* reset */ }
        dualScreenCoordinator.consumeActivationNotice();
        unsubscribe();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    async function startPrimary() {
        const pending = dualScreenCoordinator.activate();
        await vi.advanceTimersByTimeAsync(0);
        const parsed = new URL(openedUrl, 'http://127.0.0.1');
        expect(parsed.pathname).toBe('/map-window.html');
        expect(parsed.search).toBe('');
        const sessionId = readDualSessionId(openedUrl);
        expect(sessionId).toBeTruthy();
        return { pending, sessionId };
    }

    function attachSecondary(sessionId, onApply = () => {}) {
        /** @type {DualScreenChannel | null} */
        let channel = null;
        const protocol = createSecondaryProtocol({
            sessionId,
            post: (message) => channel?.post(message),
            onApply
        });
        channel = new DualScreenChannel('secondary', (msg) => protocol.receive(msg), { sessionId });
        return { protocol, channel };
    }

    it('keeps the main map until the popup sends one hello', async () => {
        const { pending, sessionId } = await startPrimary();
        const container = document.getElementById('map-container');

        expect(dualScreenCoordinator.isActive).toBe(false);
        expect(harness.service.destroy).not.toHaveBeenCalled();
        expect(container.classList.contains('dual-screen-map-hidden')).toBe(false);
        expect(readDualSessionId(openedUrl)).toBe(sessionId);

        const applied = [];
        const { protocol } = attachSecondary(sessionId, (msg) => applied.push(msg));
        protocol.markHandshakeReady();
        protocol.markHandshakeReady();

        await expect(pending).resolves.toBe(true);
        expect(dualScreenCoordinator.isActive).toBe(true);
        expect(harness.service.destroy).toHaveBeenCalledTimes(1);
        expect(container.classList.contains('dual-screen-map-hidden')).toBe(true);
        const hellos = MockBroadcastChannel.traffic.filter((msg) => msg.type === MessageType.HELLO);
        expect(hellos).toHaveLength(1);
        expect(hellos[0].sessionId).toBe(sessionId);
        expect(applied.map((msg) => msg.type)).toContain(MessageType.SNAPSHOT);
    });

    it('rolls back to single-screen when hello does not arrive', async () => {
        const { pending } = await startPrimary();
        expect(harness.service.destroy).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(HELLO_TIMEOUT_MS);

        await expect(pending).resolves.toBe(false);
        expect(HELLO_TIMEOUT_MS).toBe(8000);
        expect(dualScreenCoordinator.isActive).toBe(false);
        expect(harness.service.destroy).not.toHaveBeenCalled();
        expect(harness.state.live).toBe(true);
        expect(notices).toContain(HELLO_TIMEOUT_NOTICE);
        expect(dualScreenCoordinator.consumeActivationNotice()).toBe('timeout');
        expect(document.getElementById('map-container').classList.contains('dual-screen-map-hidden')).toBe(false);
    });

    it('restores the main map when the popup says goodbye on pagehide', async () => {
        const { pending, sessionId } = await startPrimary();
        const { protocol } = attachSecondary(sessionId);
        let restored = 0;
        const unsub = bus.on('dual-screen:primary-restored', () => { restored += 1; });

        protocol.markHandshakeReady();
        await expect(pending).resolves.toBe(true);
        expect(harness.service.destroy).toHaveBeenCalledTimes(1);
        expect(harness.state.live).toBe(false);

        protocol.handlePageHide();
        protocol.handlePageHide();

        expect(dualScreenCoordinator.isActive).toBe(false);
        expect(harness.service.init).toHaveBeenCalledWith('map-container');
        expect(harness.state.live).toBe(true);
        expect(restored).toBe(1);
        expect(document.getElementById('map-container').classList.contains('dual-screen-map-hidden')).toBe(false);
        const byes = MockBroadcastChannel.traffic.filter((msg) => msg.type === MessageType.BYE && msg.role === 'secondary');
        expect(byes).toHaveLength(1);
        expect(byes[0].sessionId).toBe(sessionId);
        unsub();
    });

    it('queues every popup message until the handshake is ready, then flushes in order', () => {
        const sessionId = 'ds-queue-test';
        const applied = [];
        /** @type {DualScreenChannel | null} */
        let secondaryChannel = null;
        const protocol = createSecondaryProtocol({
            sessionId,
            post: (message) => secondaryChannel?.post(message),
            onApply: (msg) => applied.push(msg.payload.n)
        });
        secondaryChannel = new DualScreenChannel('secondary', (msg) => protocol.receive(msg), { sessionId });
        const peer = new DualScreenChannel('primary', () => {}, { sessionId });

        peer.post(createMessage('primary', MessageType.SNAPSHOT, { n: 1 }, sessionId));
        peer.post(createMessage('primary', MessageType.LAYER_ADD, { n: 2 }, sessionId));
        peer.post(createMessage('primary', MessageType.VIEWPORT, { n: 3 }, sessionId));
        protocol.enqueueOutbound(MessageType.MAP_CHROME, { n: 10 });
        protocol.enqueueOutbound(MessageType.SELECTION, { n: 11 });

        expect(applied).toEqual([]);
        expect(MockBroadcastChannel.traffic.filter((msg) => msg.role === 'secondary')).toEqual([]);

        protocol.markHandshakeReady();
        protocol.markHandshakeReady();

        expect(applied).toEqual([1, 2, 3]);
        const outbound = MockBroadcastChannel.traffic.filter((msg) => msg.role === 'secondary');
        expect(outbound.map((msg) => msg.type)).toEqual([
            MessageType.HELLO,
            MessageType.MAP_CHROME,
            MessageType.SELECTION
        ]);
        expect(outbound.map((msg) => msg.payload?.n ?? null)).toEqual([null, 10, 11]);
        peer.close();
        secondaryChannel.close();
    });

    it('ignores messages from a stale session', async () => {
        const { pending, sessionId } = await startPrimary();
        const stale = attachSecondary('ds-old-session');
        stale.protocol.markHandshakeReady();

        expect(dualScreenCoordinator.isActive).toBe(false);
        expect(harness.service.destroy).not.toHaveBeenCalled();

        const current = attachSecondary(sessionId);
        current.protocol.markHandshakeReady();
        await expect(pending).resolves.toBe(true);
        expect(dualScreenCoordinator.isActive).toBe(true);

        const byeBefore = harness.service.init.mock.calls.length;
        stale.protocol.handlePageHide();
        expect(dualScreenCoordinator.isActive).toBe(true);
        expect(harness.service.init.mock.calls.length).toBe(byeBefore);
    });

    it('shows a plain-words notice when the protocol version does not match', async () => {
        const { pending, sessionId } = await startPrimary();
        const peer = new DualScreenChannel('secondary', () => {}, { sessionId });
        peer.post({
            v: OTHER_PROTOCOL_VERSION,
            type: MessageType.HELLO,
            msgId: 'mismatch-1',
            role: 'secondary',
            sessionId,
            payload: {}
        });

        await expect(pending).resolves.toBe(false);
        expect(dualScreenCoordinator.isActive).toBe(false);
        expect(harness.service.destroy).not.toHaveBeenCalled();
        expect(harness.state.live).toBe(true);
        expect(notices).toContain(PROTOCOL_MISMATCH_NOTICE);
        expect(notices).not.toContain(HELLO_TIMEOUT_NOTICE);
        expect(dualScreenCoordinator.consumeActivationNotice()).toBe('version');
        peer.close();
    });
});
