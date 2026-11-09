/**
 * @vitest-environment jsdom
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountModalHost } from '../react/ui/mountModalHost.jsx';
import { openTerrainProfile } from '../js/widgets/terrain-profile/controller.js';
import { LINE_OF_SITE_OVERLAY_SOURCE_ID, syncLineOfSiteOverlay, removeLineOfSiteOverlay } from '../js/widgets/terrain-profile/preview-layer.js';

const originalRect = HTMLElement.prototype.getBoundingClientRect;

function rect(width, height, left = 0, top = 0) {
    return {
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON() { return {}; }
    };
}

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

function buttonNamed(text) {
    return [...document.querySelectorAll('button')].find((entry) => entry.textContent.includes(text));
}

async function waitFor(read, attempts = 40) {
    for (let i = 0; i < attempts; i += 1) {
        const value = read();
        if (value) return value;
        await act(async () => {
            await new Promise((resolve) => { setTimeout(resolve, 15); });
        });
    }
    return null;
}

describe('Line of Site dialog close paths', () => {
    /** @type {ReturnType<typeof mountModalHost> | null} */
    let host = null;

    afterEach(() => {
        host?.unmount();
        host = null;
        HTMLElement.prototype.getBoundingClientRect = originalRect;
        document.body.innerHTML = '';
    });

    async function openSession() {
        HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
            if (this.classList.contains('panel-right') || this.classList.contains('panel-right-body')) {
                return rect(420, 700, 860, 48);
            }
            if (this.classList.contains('modal')) return rect(420, 360, 0, 0);
            return rect(120, 40);
        };
        const panel = document.createElement('div');
        panel.className = 'panel panel-right';
        panel.innerHTML = '<div class="panel-right-body"><div id="widget-panel-dock"></div></div>';
        const modalHost = document.createElement('div');
        modalHost.id = 'modal-host';
        const reactHost = document.createElement('div');
        document.body.append(panel, modalHost, reactHost);
        host = mountModalHost(reactHost);

        const map = createTrackedMap();
        map.addSource('kept-user-layer', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'kept-user-layer-line', type: 'line', source: 'kept-user-layer' });
        let picks = 0;
        let getMapCalls = 0;
        const removeLayer = vi.fn();
        const ctx = {
            mapService: {
                captureTerrainViewState: vi.fn(async () => ({ is3d: true, terrain: true, pitch: 20, bearing: 1 })),
                enable3D: vi.fn(),
                restoreTerrainViewState: vi.fn(),
                cancelInteraction: vi.fn(),
                startPointPick: vi.fn(async () => {
                    picks += 1;
                    return picks === 1 ? [0, 0] : [0.002, 0];
                }),
                sampleElevations: vi.fn(async (points) => points.map((_, index) => (
                    index === 0 || index === points.length - 1 ? 40 : 280
                ))),
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
                setLayerStyle: vi.fn(),
                removeLayer,
                getMap() {
                    getMapCalls += 1;
                    return null;
                }
            },
            showToast: vi.fn(),
            addedLayers: [],
            createSpatialDataset: vi.fn((name, geojson) => {
                const dataset = { id: `los-added-${ctx.addedLayers.length + 1}`, name, geojson };
                return dataset;
            }),
            addLayer: vi.fn((dataset) => { ctx.addedLayers.push(dataset); }),
            getLayers() { return ctx.addedLayers; },
            refreshUI: vi.fn(),
            getMapCalls: () => getMapCalls
        };

        await act(async () => {
            await openTerrainProfile(ctx);
        });
        const observer = await waitFor(() => buttonNamed('Pick observer'));
        expect(observer).toBeTruthy();
        await act(async () => { observer.click(); });
        const target = await waitFor(() => buttonNamed('Pick target'));
        expect(target).toBeTruthy();
        await act(async () => { target.click(); });
        const run = await waitFor(() => buttonNamed('Run'));
        await act(async () => { run.click(); });
        const added = await waitFor(() => map.getLayer('gis-line-of-site-beam') && buttonNamed('Add to map') && !buttonNamed('Add to map').disabled);
        expect(added).toBeTruthy();
        expect(map.getSource(LINE_OF_SITE_OVERLAY_SOURCE_ID)).toBeTruthy();
        expect(buttonNamed('Send to')).toBeUndefined();
        await act(async () => { buttonNamed('Add to map').click(); });
        expect(ctx.addedLayers.length).toBeGreaterThan(1);
        for (const dataset of ctx.addedLayers) {
            expect(map.getSource(dataset.id)).toBeTruthy();
        }
        return { panel, map, ctx, removeLayer };
    }

    function assertCleared(map, ctx, removeLayer) {
        expect(map.getSource(LINE_OF_SITE_OVERLAY_SOURCE_ID)).toBeNull();
        expect(map.getLayer('gis-line-of-site-overlay-dot')).toBeNull();
        expect(map.getLayer('gis-line-of-site-overlay-label')).toBeNull();
        expect(map.getLayer('gis-line-of-site-beam')).toBeNull();
        expect(map.getSource('kept-user-layer')).toBeTruthy();
        expect(map.getLayer('kept-user-layer-line')).toBeTruthy();
        expect(ctx.addedLayers.length).toBeGreaterThan(1);
        for (const dataset of ctx.addedLayers) {
            expect(map.getSource(dataset.id)).toBeTruthy();
            expect(map.getLayer(`${dataset.id}-line`)).toBeTruthy();
        }
        expect(removeLayer).not.toHaveBeenCalled();
        expect(ctx.getMapCalls()).toBe(0);
        expect(ctx.mapService.restoreTerrainViewState).toHaveBeenCalled();
    }

    async function flushClose() {
        await act(async () => {
            await new Promise((resolve) => { setTimeout(resolve, 0); });
        });
    }

    it('Cancel removes session graphics and keeps layers added to the map', async () => {
        const { map, ctx, removeLayer } = await openSession();
        await act(async () => { buttonNamed('Cancel').click(); });
        await flushClose();
        assertCleared(map, ctx, removeLayer);
    });

    it('the X button removes session graphics and keeps layers added to the map', async () => {
        const { map, ctx, removeLayer } = await openSession();
        await act(async () => { document.querySelector('.close-modal').click(); });
        await flushClose();
        assertCleared(map, ctx, removeLayer);
    });

    it('removing the panel removes session graphics and keeps layers added to the map', async () => {
        const { panel, map, ctx, removeLayer } = await openSession();
        expect(panel.querySelector('.modal')).toBeTruthy();
        panel.remove();
        await flushClose();
        assertCleared(map, ctx, removeLayer);
    });

    it('unmount removes session graphics and keeps layers added to the map', async () => {
        const { map, ctx, removeLayer } = await openSession();
        await act(async () => { host.unmount(); });
        host = null;
        await flushClose();
        assertCleared(map, ctx, removeLayer);
    });
});
