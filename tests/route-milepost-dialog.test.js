/**
 * @vitest-environment jsdom
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GIS_WIDGETS } from '../js/widgets/registry.js';
import { RouteMilepostDialog } from '../react/widgets/RouteMilepostDialog.jsx';

const mocks = vi.hoisted(() => ({
    openReactIsland: vi.fn(),
    searchMilepostRoutes: vi.fn(),
    fetchMilepostSelection: vi.fn()
}));

vi.mock('../js/ui/open-react-island.js', () => ({
    openReactIsland: mocks.openReactIsland
}));

vi.mock('../js/widgets/route-milepost/query.js', () => ({
    searchMilepostRoutes: mocks.searchMilepostRoutes,
    fetchMilepostSelection: mocks.fetchMilepostSelection
}));

const { openRouteMilepost } = await import('../js/widgets/route-milepost/controller.js');

function setNativeValue(element, value) {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    descriptor.set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Route Milepost dialog', () => {
    it('is registered once as a visible widget', () => {
        const matches = GIS_WIDGETS.filter((widget) => widget.type === 'route-milepost');
        expect(matches).toHaveLength(1);
        expect(matches[0].label).toBe('Route Milepost');
        expect(matches[0].action).toBe('openRouteMilepost');
    });

    it('renders the three sources and does not query on open', async () => {
        const onSearch = vi.fn();
        const onPreview = vi.fn();
        const onRun = vi.fn();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(h(RouteMilepostDialog, {
                onCancel: () => {},
                onSearchRoutes: onSearch,
                onPreview,
                onRun
            }));
        });

        expect(container.textContent).toContain('LR Mile');
        expect(container.textContent).toContain('LR Tenth Mile');
        expect(container.textContent).toContain('Physical Mile Post');
        expect(container.textContent).toContain('Preview');
        expect(container.textContent).toContain('Add as layer');
        expect(onSearch).not.toHaveBeenCalled();
        expect(onPreview).not.toHaveBeenCalled();
        expect(onRun).not.toHaveBeenCalled();

        const input = container.querySelector('#route-milepost-search');
        await act(async () => {
            setNativeValue(input, 'I-15');
        });
        expect(onSearch).not.toHaveBeenCalled();

        const form = container.querySelector('form');
        await act(async () => {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onSearch).toHaveBeenCalledWith('I-15');
        expect(onPreview).not.toHaveBeenCalled();

        await act(async () => {
            root.unmount();
        });
        container.remove();
    });
});

describe('Route Milepost controller', () => {
    beforeEach(() => {
        mocks.openReactIsland.mockReset();
        mocks.searchMilepostRoutes.mockReset();
        mocks.fetchMilepostSelection.mockReset();
    });

    it('previews and adds through mapService and does not query on open or call getMap', async () => {
        const feature = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-111.9, 40.7] },
            properties: { milepost: 10, source: 'lr-mile' }
        };
        const previewFeature = {
            ...feature,
            properties: { ...feature.properties, _preview: 'milepost' }
        };
        mocks.fetchMilepostSelection.mockResolvedValue({
            layerName: 'I-15 MP 10 LR Mile',
            features: [feature],
            preview: { type: 'FeatureCollection', features: [previewFeature] },
            warnings: [],
            summary: { count: 1, sourceLabel: 'LR Mile' }
        });

        let props;
        mocks.openReactIsland.mockImplementation(async ({ getProps }) => {
            props = getProps(() => {});
        });

        const layers = [];
        const getMap = vi.fn(() => {
            throw new Error('getMap must not be used');
        });
        const ctx = {
            turf: { bbox: () => [-112, 40, -111, 41] },
            mapService: {
                getMap,
                showTempFeature: vi.fn(),
                clearTempFeatures: vi.fn(),
                fitBounds: vi.fn(),
                addLayer: vi.fn(),
                cancelInteraction: vi.fn()
            },
            createSpatialDataset: vi.fn((name, geojson) => ({ id: 'mp-1', name, geojson })),
            addLayer: vi.fn((dataset) => layers.push(dataset)),
            getLayers: () => layers,
            refreshUI: vi.fn(),
            showToast: vi.fn()
        };

        await openRouteMilepost(ctx);
        expect(mocks.searchMilepostRoutes).not.toHaveBeenCalled();
        expect(mocks.fetchMilepostSelection).not.toHaveBeenCalled();
        expect(getMap).not.toHaveBeenCalled();

        const preview = await props.onPreview({
            routeId: '0015PM',
            sourceId: 'lr-mile',
            mode: 'point',
            milepost: '10'
        });
        expect(mocks.fetchMilepostSelection).toHaveBeenCalledTimes(1);
        expect(ctx.mapService.showTempFeature).toHaveBeenCalledWith(preview.preview, 0);
        expect(ctx.mapService.fitBounds).toHaveBeenCalled();
        expect(getMap).not.toHaveBeenCalled();

        const added = await props.onRun({
            layerName: preview.layerName,
            features: preview.features
        });
        expect(mocks.fetchMilepostSelection).toHaveBeenCalledTimes(1);
        expect(ctx.createSpatialDataset).toHaveBeenCalledWith(
            'I-15 MP 10 LR Mile',
            { type: 'FeatureCollection', features: [feature] },
            { format: 'derived' }
        );
        expect(ctx.mapService.addLayer).toHaveBeenCalled();
        expect(added.producedResult.sourceId).toBe('route-milepost');
        expect(added.producedResult.layerIds).toEqual(['mp-1']);
        expect(getMap).not.toHaveBeenCalled();
    });
});
