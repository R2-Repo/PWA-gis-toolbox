/**
 * @vitest-environment jsdom
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DualScreenChannel } from '../js/dual-screen/channel.js';
import dualScreenCoordinator from '../js/dual-screen/coordinator.js';
import { classifyMapMethod, installDualScreenMapServiceDecorator } from '../js/dual-screen/map-bridge.js';
import { createMessage, MessageType } from '../js/dual-screen/protocol.js';
import { GIS_WIDGETS } from '../js/widgets/registry.js';
import { TerrainProfileDialog } from '../react/widgets/TerrainProfileDialog.jsx';
import { WidgetPanel } from '../react/panels/WidgetPanel.jsx';
import { buildLineOfSight } from '../js/widgets/terrain-profile/engine.js';
import { LOCAL_GLYPH_FONT_STACK } from '../js/map/local-glyphs.js';
import {
    LINE_OF_SITE_OVERLAY_SOURCE_ID,
    LOS_DOT_FILL,
    LOS_DOT_OUTLINE,
    LOS_DOT_RING,
    removeLineOfSiteOverlay,
    syncLineOfSiteOverlay
} from '../js/widgets/terrain-profile/preview-layer.js';

const mocks = vi.hoisted(() => ({
    openReactIsland: vi.fn()
}));

vi.mock('../js/ui/open-react-island.js', () => ({
    openReactIsland: mocks.openReactIsland
}));

const { openTerrainProfile } = await import('../js/widgets/terrain-profile/controller.js');

function button(container, text) {
    return [...container.querySelectorAll('button')].find((entry) => entry.textContent.includes(text));
}

async function clickButton(container, text) {
    await act(async () => {
        button(container, text).click();
        await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
}

describe('Line of Site widget', () => {
    it('is registered once as a visible widget', () => {
        const matches = GIS_WIDGETS.filter((widget) => widget.type === 'terrain-profile');
        expect(matches).toHaveLength(1);
        expect(matches[0].label).toBe('Line of Site');
        expect(matches[0].action).toBe('openTerrainProfile');
        expect(typeof matches[0].open).toBe('function');
    });

    it('draws the terrain profile and the sight line together, including a null gap', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        let role = 'observer';
        const onRun = vi.fn(async (input) => buildLineOfSight({
            ...input,
            sampleElevations: async (points) => points.map((_, index) => {
                if (index === 0 || index === points.length - 1) return 100;
                return index === 1 ? null : 110;
            })
        }));

        await act(async () => {
            root.render(h(TerrainProfileDialog, {
                onCancel: () => {},
                onPickPoint: async () => {
                    const coord = role === 'observer' ? [0, 0] : [0.002, 0];
                    role = 'target';
                    return coord;
                },
                onPreviewPoints: () => {},
                onRun
            }));
        });

        expect(button(container, 'Elevation profile')).toBeUndefined();
        expect(button(container, 'Draw line')).toBeUndefined();
        await clickButton(container, 'Pick observer');
        await clickButton(container, 'Pick target');
        await clickButton(container, 'Run');

        expect(onRun).toHaveBeenCalledTimes(1);
        expect(onRun.mock.calls[0][0].mode).toBe('los');
        expect(onRun.mock.calls[0][0].curvature).toBe(true);
        expect(container.querySelector('input[type="checkbox"]')).toBeNull();
        expect(container.textContent).not.toContain('Earth curvature and refraction');
        expect(container.textContent).toContain('Total gain');
        expect(container.textContent).toContain('Elevation gaps: 1');
        const chart = container.querySelector('svg[role="img"]');
        expect(chart).toBeTruthy();
        expect(chart.querySelector('polyline[stroke="#b7791f"]')).toBeTruthy();
        expect(chart.querySelector('polyline[stroke="#00e040"]')).toBeTruthy();
        expect(chart.querySelector('polyline[stroke-dasharray]')).toBeNull();
        expect(chart.getAttribute('aria-label')).toContain('Line of Site');

        root.unmount();
        container.remove();
    });

    it('marks a blocked sight line on the chart', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        let role = 'observer';
        const onRun = vi.fn(async (input) => buildLineOfSight({
            ...input,
            sampleElevations: async (points) => points.map((_, index) => (
                index === 0 || index === points.length - 1 ? 100 : 400
            ))
        }));

        await act(async () => {
            root.render(h(TerrainProfileDialog, {
                onCancel: () => {},
                onPickPoint: async () => {
                    const coord = role === 'observer' ? [0, 0] : [0.002, 0];
                    role = 'target';
                    return coord;
                },
                onPreviewPoints: () => {},
                onRun
            }));
        });

        await clickButton(container, 'Pick observer');
        await clickButton(container, 'Pick target');
        await clickButton(container, 'Run');

        expect(container.textContent).toContain('Blocked');
        expect(container.textContent).toContain('Obstruction at');
        const dot = container.querySelector('circle[fill="#b91c1c"]');
        expect(dot).toBeTruthy();
        expect(container.querySelector('polyline[stroke="#ff2d1a"]')).toBeTruthy();
        expect(container.querySelector('polyline[stroke="#00e040"]')).toBeTruthy();
        expect(container.querySelector('polyline[stroke-dasharray]')).toBeNull();

        root.unmount();
        container.remove();
    });

    it('samples through mapService.sampleElevations and shows the obstruction on the map', async () => {
        let island = null;
        mocks.openReactIsland.mockImplementation(async (options) => {
            island = options;
        });
        const calls = [];
        const layers = [];
        const ctx = {
            mapService: {
                sampleElevations: vi.fn(async (points) => {
                    calls.push(points);
                    return points.map((_, index) => (index === 0 || index === points.length - 1 ? 50 : 300));
                }),
                startPointPick: vi.fn(async () => [0, 0]),
                showLineOfSiteOverlay: vi.fn(),
                removeLineOfSiteOverlay: vi.fn(),
                cancelInteraction: vi.fn(),
                addLayer: vi.fn(),
                showLineOfSiteBeam: vi.fn(),
                removeLineOfSiteBeam: vi.fn()
            },
            showToast: vi.fn(),
            createSpatialDataset: vi.fn((name, geojson) => ({ id: 'los-1', name, geojson })),
            addLayer: vi.fn((dataset) => layers.push(dataset)),
            getLayers: () => layers,
            refreshUI: vi.fn()
        };

        await openTerrainProfile(ctx);
        const props = island.getProps(() => {});
        const observer = await props.onPickPoint('observer');
        const result = await props.onRun({
            mode: 'los',
            observer,
            target: [0.002, 0],
            observerHeightM: 1.7,
            targetHeightM: 0,
            spacingM: 30,
            curvature: false
        });

        expect(island.title).toBe('Line of Site');
        expect(ctx.mapService.sampleElevations).toHaveBeenCalledTimes(1);
        expect(calls[0][0]).toEqual([0, 0]);
        expect(calls[0].at(-1)).toEqual([0.002, 0]);
        expect(result.visible).toBe(false);
        expect(result.curvature).toBe(true);
        const beam = ctx.mapService.showLineOfSiteBeam.mock.calls[0][0];
        expect(beam.visible.length).toBeGreaterThan(1);
        expect(beam.blocked.length).toBeGreaterThan(1);
        expect(beam.visible[0].altitudeM).toBeCloseTo(51.7, 5);
        expect(beam.blocked[0].altitudeM).toBeCloseTo(beam.visible.at(-1).altitudeM, 5);
        const preview = ctx.mapService.showLineOfSiteOverlay.mock.calls.at(-1)[0];
        const obstruction = preview.features.find((feature) => feature.properties.kind === 'obstruction');
        expect(obstruction.geometry.type).toBe('Point');
        expect(obstruction.geometry.coordinates).toEqual([result.obstruction.lng, result.obstruction.lat]);
        expect(ctx.mapService.queryElevationAt).toBeUndefined();
        expect(ctx.mapService.getMap).toBeUndefined();

        const produced = props.onAddLayer(result);
        expect(produced.sourceId).toBe('terrain-profile');
        expect(produced.outputs[0].name).toBe('profile');
        expect(layers[0].geojson.features.some((feature) => feature.geometry.type === 'Point')).toBe(true);
    });

    it('enables terrain on open and restores the previous view when it is unchanged', async () => {
        let island = null;
        mocks.openReactIsland.mockImplementation(async (options) => {
            island = options;
        });
        const previous = { is3d: false, terrain: false, pitch: 0, bearing: 15 };
        const owned = { is3d: true, terrain: true, pitch: 30, bearing: 15 };
        const states = [previous, owned, owned];
        let n = 0;
        let closed = false;
        const ctx = {
            mapService: {
                captureTerrainViewState: vi.fn(async () => states[n++]),
                enable3D: vi.fn(),
                restoreTerrainViewState: vi.fn(),
                removeLineOfSiteBeam: vi.fn(),
                cancelInteraction: vi.fn()
            }
        };
        await openTerrainProfile(ctx);
        expect(ctx.mapService.enable3D).toHaveBeenCalledWith({ animate: false, pitch: 30, bearing: 15 });
        await island.getProps(() => { closed = true; }).onCancel();
        expect(ctx.mapService.removeLineOfSiteBeam).toHaveBeenCalled();
        expect(ctx.mapService.restoreTerrainViewState).toHaveBeenCalledWith(previous);
        expect(closed).toBe(true);
    });

    it('leaves a terrain view the user changed while the tool was open', async () => {
        let island = null;
        mocks.openReactIsland.mockImplementation(async (options) => {
            island = options;
        });
        const previous = { is3d: true, terrain: false, pitch: 48, bearing: 10 };
        const owned = { is3d: true, terrain: true, pitch: 48, bearing: 10 };
        const states = [previous, owned, { ...owned, pitch: 55 }];
        let n = 0;
        const ctx = {
            mapService: {
                captureTerrainViewState: vi.fn(async () => states[n++]),
                enable3D: vi.fn(),
                restoreTerrainViewState: vi.fn(),
                removeLineOfSiteBeam: vi.fn(),
                cancelInteraction: vi.fn()
            }
        };
        await openTerrainProfile(ctx);
        expect(ctx.mapService.enable3D).toHaveBeenCalledWith({ animate: false, pitch: 48, bearing: 10 });
        await island.getProps(() => {}).onCancel();
        expect(ctx.mapService.restoreTerrainViewState).not.toHaveBeenCalled();
    });

    it('does not retarget pitch when terrain is already on', async () => {
        mocks.openReactIsland.mockImplementation(async () => {});
        const view = { is3d: true, terrain: true, pitch: 48, bearing: 10 };
        const states = [view, view];
        let n = 0;
        const ctx = {
            mapService: {
                captureTerrainViewState: vi.fn(async () => states[n++]),
                enable3D: vi.fn()
            }
        };
        await openTerrainProfile(ctx);
        expect(ctx.mapService.enable3D).not.toHaveBeenCalled();
    });

    it('renders a Beta badge on the Line of Site pill and only on pills that declare one', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        await act(async () => {
            root.render(h(WidgetPanel));
        });

        const buttons = [...container.querySelectorAll('button[data-app-action]')];
        const lineOfSite = container.querySelector('[data-app-action="openTerrainProfile"]');
        expect(lineOfSite?.textContent).toContain('Line of Site');
        expect(lineOfSite?.querySelector('.geo-tool-badge')?.textContent).toBe('Beta');
        expect(container.querySelector('[data-app-action="openGeoreferenceRaster"] .geo-tool-badge')).toBeNull();
        for (const button of buttons) {
            const widget = GIS_WIDGETS.find((entry) => entry.action === button.getAttribute('data-app-action'));
            const badge = button.querySelector('.geo-tool-badge');
            if (widget?.badge) expect(badge?.textContent).toBe(widget.badge);
            else expect(badge).toBeNull();
        }

        root.unmount();
        container.remove();
    });
});

function createTrackedMap() {
    const sources = new Map();
    const layers = new Map();
    return {
        addSource(id, spec) {
            sources.set(id, {
                type: spec.type,
                data: spec.data,
                setData(data) { this.data = data; }
            });
        },
        getSource(id) { return sources.get(id) || null; },
        removeSource(id) { sources.delete(id); },
        addLayer(layer) { layers.set(layer.id, { ...layer }); },
        getLayer(id) { return layers.get(id) || null; },
        removeLayer(id) { layers.delete(id); }
    };
}

function seedUserLayer(map, id = 'kept-user-layer') {
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: `${id}-line`, type: 'line', source: id });
}

function assertSessionCleared(map, service, getMapCalls) {
    expect(map.getSource(LINE_OF_SITE_OVERLAY_SOURCE_ID)).toBeNull();
    expect(map.getLayer('gis-line-of-site-overlay-dot')).toBeNull();
    expect(map.getLayer('gis-line-of-site-overlay-label')).toBeNull();
    expect(map.getLayer('gis-line-of-site-beam')).toBeNull();
    expect(map.getSource('kept-user-layer')).toBeTruthy();
    expect(map.getLayer('kept-user-layer-line')).toBeTruthy();
    expect(map.getSource('los-added')).toBeTruthy();
    expect(map.getLayer('los-added-line')).toBeTruthy();
    expect(service.removeLayer).not.toHaveBeenCalled();
    expect(getMapCalls).toBe(0);
}

const losView = { is3d: true, terrain: true, pitch: 30, bearing: 4 };

function losService(map) {
    let getMapCalls = 0;
    const service = {
        captureTerrainViewState: vi.fn(async () => losView),
        enable3D: vi.fn(),
        restoreTerrainViewState: vi.fn(),
        cancelInteraction: vi.fn(),
        showLineOfSiteOverlay: (geojson) => syncLineOfSiteOverlay(map, geojson),
        removeLineOfSiteOverlay: () => removeLineOfSiteOverlay(map),
        showLineOfSiteBeam: vi.fn(() => {
            map.addLayer({ id: 'gis-line-of-site-beam', type: 'custom' });
        }),
        removeLineOfSiteBeam: vi.fn(() => {
            if (map.getLayer('gis-line-of-site-beam')) map.removeLayer('gis-line-of-site-beam');
        }),
        addLayer: vi.fn((dataset) => {
            map.addSource(dataset.id, { type: 'geojson', data: dataset.geojson });
            map.addLayer({ id: `${dataset.id}-line`, type: 'line', source: dataset.id });
        }),
        removeLayer: vi.fn(),
        getMap() { getMapCalls += 1; return null; },
        sampleElevations: vi.fn(async (points) => points.map((_, index) => (
            index === 0 || index === points.length - 1 ? 50 : 300
        )))
    };
    return { service, getMapCalls: () => getMapCalls };
}

async function openPaintedLos(map, service) {
    let island = null;
    mocks.openReactIsland.mockImplementation(async (options) => { island = options; });
    const layers = [];
    const ctx = {
        mapService: service,
        showToast: vi.fn(),
        createSpatialDataset: vi.fn((name, geojson) => ({ id: 'los-added', name, geojson })),
        addLayer: vi.fn((dataset) => layers.push(dataset)),
        getLayers: () => layers,
        refreshUI: vi.fn()
    };
    await openTerrainProfile(ctx);
    const props = island.getProps(() => {});
    const result = await props.onRun({
        mode: 'los',
        observer: [0, 0],
        target: [0.002, 0],
        observerHeightM: 1.7,
        targetHeightM: 0,
        spacingM: 30,
        curvature: false
    });
    props.onAddLayer(result);
    return { island, ctx, result };
}

describe('Line of Site close paths', () => {
    it('Cancel removes the beam, dots, labels, and preview and keeps user layers', async () => {
        const map = createTrackedMap();
        seedUserLayer(map);
        const built = losService(map);
        const { island } = await openPaintedLos(map, built.service);
        expect(map.getSource(LINE_OF_SITE_OVERLAY_SOURCE_ID)).toBeTruthy();
        expect(map.getLayer('gis-line-of-site-overlay-dot').paint['circle-color']).toBe(LOS_DOT_FILL);
        expect(map.getLayer('gis-line-of-site-overlay-ring').paint['circle-color']).toBe(LOS_DOT_RING);
        expect(map.getLayer('gis-line-of-site-overlay-outline').paint['circle-color']).toBe(LOS_DOT_OUTLINE);
        expect(map.getLayer('gis-line-of-site-overlay-label').layout['text-font']).toEqual([...LOCAL_GLYPH_FONT_STACK]);
        let closed = false;
        await island.getProps(() => { closed = true; }).onCancel();
        expect(closed).toBe(true);
        assertSessionCleared(map, built.service, built.getMapCalls());
        expect(built.service.restoreTerrainViewState).toHaveBeenCalledWith(losView);
    });

    it('overlay destroy removes session graphics when the dialog is closed without Cancel', async () => {
        const map = createTrackedMap();
        seedUserLayer(map);
        const built = losService(map);
        const { island } = await openPaintedLos(map, built.service);
        await island.onOverlayDestroy();
        assertSessionCleared(map, built.service, built.getMapCalls());
        expect(built.service.restoreTerrainViewState).toHaveBeenCalledWith(losView);
    });
});

class LosBroadcastChannel {
    static hub = new Map();

    constructor(name) {
        this.name = name;
        this.onmessage = null;
        this.closed = false;
        let peers = LosBroadcastChannel.hub.get(name);
        if (!peers) {
            peers = new Set();
            LosBroadcastChannel.hub.set(name, peers);
        }
        peers.add(this);
    }

    postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        const peers = [...(LosBroadcastChannel.hub.get(this.name) || [])];
        for (const peer of peers) {
            if (peer === this || peer.closed || typeof peer.onmessage !== 'function') continue;
            peer.onmessage({ data: JSON.parse(JSON.stringify(copy)) });
        }
    }

    close() {
        this.closed = true;
        LosBroadcastChannel.hub.get(this.name)?.delete(this);
    }
}

describe('Line of Site close through the dual-screen bridge', () => {
    /** @type {DualScreenChannel | null} */
    let secondary;
    const sessionId = 'sess-los';

    beforeEach(() => {
        LosBroadcastChannel.hub = new Map();
        vi.stubGlobal('BroadcastChannel', LosBroadcastChannel);
        vi.spyOn(window, 'open').mockReturnValue(null);
        dualScreenCoordinator.isActive = false;
        dualScreenCoordinator._secondaryReady = true;
        dualScreenCoordinator._sessionId = sessionId;
        dualScreenCoordinator._deactivating = false;
    });

    afterEach(() => {
        dualScreenCoordinator.isActive = false;
        dualScreenCoordinator._secondaryReady = false;
        dualScreenCoordinator._channel?.close();
        dualScreenCoordinator._channel = null;
        dualScreenCoordinator._sessionId = null;
        secondary?.close();
        secondary = null;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('forwards overlay and beam removal and leaves user layers on the popup map', async () => {
        const popupMap = createTrackedMap();
        seedUserLayer(popupMap);
        const states = [losView, losView, losView];
        let n = 0;
        const popup = {
            captureTerrainViewState: () => states[Math.min(n++, states.length - 1)],
            sampleElevations: (points) => points.map(() => 80),
            showLineOfSiteOverlay: (geojson) => syncLineOfSiteOverlay(popupMap, geojson),
            removeLineOfSiteOverlay: () => removeLineOfSiteOverlay(popupMap),
            showLineOfSiteBeam: () => popupMap.addLayer({ id: 'gis-line-of-site-beam', type: 'custom' }),
            removeLineOfSiteBeam: () => {
                if (popupMap.getLayer('gis-line-of-site-beam')) popupMap.removeLayer('gis-line-of-site-beam');
            },
            addLayer: (dataset) => {
                popupMap.addSource(dataset.id, { type: 'geojson', data: dataset.geojson });
                popupMap.addLayer({ id: `${dataset.id}-line`, type: 'line', source: dataset.id });
            },
            removeLayer: vi.fn(),
            restoreTerrainViewState: vi.fn(),
            enable3D: vi.fn(),
            cancelInteraction: vi.fn()
        };

        secondary = new DualScreenChannel('secondary', (msg) => {
            if (msg.type === MessageType.MAP_RPC) {
                const { requestId, method, args } = msg.payload;
                const result = typeof popup[method] === 'function' ? popup[method](...(args || [])) : null;
                secondary.post(createMessage('secondary', MessageType.MAP_RPC_RESULT, { requestId, result }, sessionId));
                return;
            }
            if (msg.type === MessageType.MAP_CMD && typeof popup[msg.payload?.method] === 'function') {
                popup[msg.payload.method](...(msg.payload.args || []));
            }
        }, { sessionId });
        dualScreenCoordinator._channel = new DualScreenChannel('primary', (msg) => {
            dualScreenCoordinator._handleMessage(msg);
        }, { sessionId });

        const localMap = createTrackedMap();
        const built = losService(localMap);
        installDualScreenMapServiceDecorator(built.service, dualScreenCoordinator);
        let getMapCalls = 0;
        const bridgedGetMap = built.service.getMap.bind(built.service);
        built.service.getMap = (...args) => {
            getMapCalls += 1;
            return bridgedGetMap(...args);
        };
        dualScreenCoordinator.isActive = true;

        expect(classifyMapMethod('showLineOfSiteOverlay')).toBe('forward');
        expect(classifyMapMethod('removeLineOfSiteOverlay')).toBe('forward');

        const { island, ctx } = await openPaintedLos(localMap, built.service);
        expect(localMap.getSource(LINE_OF_SITE_OVERLAY_SOURCE_ID)).toBeNull();
        expect(popupMap.getSource(LINE_OF_SITE_OVERLAY_SOURCE_ID)).toBeTruthy();
        expect(popupMap.getLayer('gis-line-of-site-overlay-label').layout['text-font']).toEqual([...LOCAL_GLYPH_FONT_STACK]);
        expect(popupMap.getSource('los-added')).toBeTruthy();

        await island.getProps(() => {}).onCancel();

        expect(popupMap.getSource(LINE_OF_SITE_OVERLAY_SOURCE_ID)).toBeNull();
        expect(popupMap.getLayer('gis-line-of-site-beam')).toBeNull();
        expect(popupMap.getLayer('gis-line-of-site-overlay-dot')).toBeNull();
        expect(popupMap.getLayer('gis-line-of-site-overlay-label')).toBeNull();
        expect(popupMap.getSource('kept-user-layer')).toBeTruthy();
        expect(popupMap.getSource('los-added')).toBeTruthy();
        expect(popupMap.getLayer('los-added-line')).toBeTruthy();
        expect(popup.removeLayer).not.toHaveBeenCalled();
        expect(localMap.getSource('los-added')).toBeNull();
        expect(getMapCalls).toBe(0);
        expect(ctx.mapService.getMap).toBeTypeOf('function');
    });
});
