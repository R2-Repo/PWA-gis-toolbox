/**
 * @vitest-environment jsdom
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { GIS_WIDGETS } from '../js/widgets/registry.js';
import { TerrainProfileDialog } from '../react/widgets/TerrainProfileDialog.jsx';
import { buildLineOfSight } from '../js/widgets/terrain-profile/engine.js';

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
                showTempFeature: vi.fn(() => ({ srcId: 'temp-1' })),
                removeTempFeature: vi.fn(),
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
        const beam = ctx.mapService.showLineOfSiteBeam.mock.calls[0][0];
        expect(beam.visible.length).toBeGreaterThan(1);
        expect(beam.blocked.length).toBeGreaterThan(1);
        expect(beam.visible[0].altitudeM).toBeCloseTo(51.7, 5);
        expect(beam.blocked[0].altitudeM).toBeCloseTo(beam.visible.at(-1).altitudeM, 5);
        const preview = ctx.mapService.showTempFeature.mock.calls.at(-1)[0];
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
});
