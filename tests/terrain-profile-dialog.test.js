/**
 * @vitest-environment jsdom
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { GIS_WIDGETS } from '../js/widgets/registry.js';
import { TerrainProfileDialog } from '../react/widgets/TerrainProfileDialog.jsx';
import { buildElevationProfile, buildLineOfSight } from '../js/widgets/terrain-profile/engine.js';

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

describe('Terrain Profile widget', () => {
    it('is registered once as a visible widget', () => {
        const matches = GIS_WIDGETS.filter((widget) => widget.type === 'terrain-profile');
        expect(matches).toHaveLength(1);
        expect(matches[0].label).toBe('Terrain Profile');
        expect(matches[0].action).toBe('openTerrainProfile');
        expect(typeof matches[0].open).toBe('function');
    });

    it('draws a profile chart from sampled elevations, including a null gap', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        const onRun = vi.fn(async (input) => buildElevationProfile({
            ...input,
            sampleElevations: async (points) => points.map((_, index) => (index === 1 ? null : 100 + index))
        }));

        await act(async () => {
            root.render(h(TerrainProfileDialog, {
                onCancel: () => {},
                onDrawLine: async () => [[0, 0], [0.002, 0]],
                onRun
            }));
        });

        await clickButton(container, 'Draw line');
        await clickButton(container, 'Run');

        expect(onRun).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('Total gain');
        expect(container.textContent).toContain('Elevation gaps: 1');
        const chart = container.querySelector('svg[role="img"]');
        expect(chart).toBeTruthy();
        expect(chart.querySelectorAll('polyline').length).toBeGreaterThan(0);
        expect(chart.getAttribute('aria-label')).toContain('Elevation profile');

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

        await clickButton(container, 'Line of sight');
        await clickButton(container, 'Pick observer');
        await clickButton(container, 'Pick target');
        await clickButton(container, 'Run');

        expect(container.textContent).toContain('Blocked');
        expect(container.textContent).toContain('Obstruction at');
        const dot = container.querySelector('circle[fill="#b91c1c"]');
        expect(dot).toBeTruthy();

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
                addLayer: vi.fn()
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

        expect(ctx.mapService.sampleElevations).toHaveBeenCalledTimes(1);
        expect(calls[0][0]).toEqual([0, 0]);
        expect(calls[0].at(-1)).toEqual([0.002, 0]);
        expect(result.visible).toBe(false);
        const preview = ctx.mapService.showTempFeature.mock.calls.at(-1)[0];
        const obstruction = preview.features.find((feature) => feature.properties.kind === 'obstruction');
        expect(obstruction.geometry.type).toBe('Point');
        expect(obstruction.geometry.coordinates).toEqual([result.obstruction.lng, result.obstruction.lat]);
        expect(ctx.mapService.queryElevationAt).toBeUndefined();

        const produced = props.onAddLayer(result);
        expect(produced.sourceId).toBe('terrain-profile');
        expect(produced.outputs[0].name).toBe('profile');
        expect(layers[0].geojson.features.some((feature) => feature.geometry.type === 'Point')).toBe(true);
    });
});
