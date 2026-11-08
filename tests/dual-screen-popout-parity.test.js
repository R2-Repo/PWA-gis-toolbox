/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/map/header-export.js', () => ({
    exportHeaderMapView: vi.fn(async () => ({ filename: 'map.png', width: 2, height: 2 })),
    willUseHighResExport: vi.fn(() => false)
}));

vi.mock('../js/map/map-export.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        buildGifBlob: vi.fn(async () => new Blob(['GIF89a'], { type: 'image/gif' })),
        captureLiveFrame: vi.fn(() => ({ width: 8, height: 8 })),
        scaleCanvasToImageData: vi.fn(() => ({
            width: 8,
            height: 8,
            data: new Uint8ClampedArray(16)
        })),
        suspendMapInteractions: vi.fn(() => vi.fn()),
        willUseHighResExport: vi.fn(() => false),
        buildMapExportFilename: vi.fn((ext) => `map.${ext}`)
    };
});

vi.mock('../js/export/exporter.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        downloadBlob: vi.fn()
    };
});

import { downloadBlob } from '../js/export/exporter.js';
import { exportHeaderMapView } from '../js/map/header-export.js';
import { buildGifBlob, suspendMapInteractions } from '../js/map/map-export.js';
import { EXPORT_CANVAS_MAX_PIXELS } from '../js/map/export-canvas-guard.js';
import { exportPopoutMapView } from '../js/dual-screen/popout-export.js';
import {
    notePopoutMapCommand,
    replacePopoutLayers,
    resetPopoutLayers
} from '../js/dual-screen/popout-layer-catalog.js';
import { popoutLegendEntries } from '../js/dual-screen/popout-legend.js';
import {
    bindPopoutContextMenu,
    buildPopoutContextMenuItems
} from '../js/dual-screen/popout-context-menu.js';
import { buildMapContextMenuItems } from '../js/tools/tool-handlers.js';
import { addLayer, getLayers, removeLayer } from '../js/core/state.js';
import mapService from '../js/map/map-service.js';
import dualScreenCoordinator from '../js/dual-screen/coordinator.js';
import { installDualScreenPrimaryHandlers } from '../js/dual-screen/primary-handlers.js';
import { MessageType } from '../js/dual-screen/protocol.js';

const SIMPLE_STYLE = {
    mode: 'simple',
    strokeColor: '#ff8800',
    fillColor: '#abcdef',
    strokeWidth: 3,
    strokeOpacity: 1,
    fillOpacity: 0.4,
    pointSize: 8,
    pointSymbol: 'circle'
};

function lineLayer(id, name) {
    return {
        id,
        name,
        type: 'spatial',
        visible: true,
        style: SIMPLE_STYLE,
        geojson: {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
                properties: { name: 'one' }
            }]
        }
    };
}

function menuLabels(built) {
    const labels = [];
    for (const item of built?.items || []) {
        labels.push(item.sep ? '---' : item.label);
        for (const child of item.children || []) labels.push(child.label);
    }
    return labels;
}

function clearLayers() {
    for (const layer of [...getLayers()]) removeLayer(layer.id);
    resetPopoutLayers();
}

describe('dual-screen pop-out parity', () => {
    beforeEach(() => {
        clearLayers();
        vi.clearAllMocks();
    });

    it('uses the same context menu items in the pop-out and the main window', () => {
        const layer = lineLayer('layer-1', 'Roads');
        const feature = layer.geojson.features[0];
        const payload = {
            latlng: { lat: 40, lng: -111 },
            layerId: layer.id,
            featureIndex: 0,
            feature,
            originalEvent: { clientX: 12, clientY: 20 }
        };

        replacePopoutLayers([layer]);
        const popoutOnly = menuLabels(buildPopoutContextMenuItems(payload));
        const mainWithoutLayer = menuLabels(buildMapContextMenuItems(payload));
        expect(popoutOnly).toContain('View attributes');
        expect(popoutOnly).toContain('Edit feature');
        expect(popoutOnly).toContain('Orbit camera around point');
        expect(popoutOnly).toContain('Open location in Google Earth');
        expect(popoutOnly).toContain('Hide layer');
        expect(mainWithoutLayer).not.toContain('Hide layer');

        addLayer(layer);
        replacePopoutLayers([layer]);
        expect(menuLabels(buildPopoutContextMenuItems(payload)))
            .toEqual(menuLabels(buildMapContextMenuItems(payload)));
        expect(buildPopoutContextMenuItems(payload).layerName).toBe('Roads');
    });

    it('runs map actions locally and sends project actions to the main window', () => {
        const posts = [];
        bindPopoutContextMenu((type, payload) => posts.push({ type, payload }));
        const orbit = vi.spyOn(mapService, 'startCameraOrbit').mockImplementation(() => {});
        const layer = lineLayer('layer-1', 'Roads');
        replacePopoutLayers([layer]);
        const built = buildPopoutContextMenuItems({
            latlng: { lat: 40.1, lng: -111.2 },
            layerId: layer.id,
            featureIndex: 0,
            feature: layer.geojson.features[0]
        });
        built.items.find((item) => item.label === 'Orbit camera around point').action();
        expect(orbit).toHaveBeenCalledWith({ lat: 40.1, lng: -111.2 });
        built.items.find((item) => item.label === 'Delete feature').action();
        built.items.find((item) => item.label === 'Zoom to layer').action();
        expect(posts.map((entry) => entry.payload.action)).toEqual(['deleteFeature', 'zoomToLayer']);
        expect(posts[0].type).toBe(MessageType.CTX_CMD);
        orbit.mockRestore();
    });

    it('handles pop-out context commands on the main window', () => {
        const deleted = vi.fn();
        const quickDraw = vi.fn();
        const presentation = vi.fn();
        installDualScreenPrimaryHandlers({
            deleteFeature: deleted,
            startQuickDraw: quickDraw,
            openPresentationLink: presentation
        });
        dualScreenCoordinator._handleMessage({
            type: MessageType.CTX_CMD,
            payload: { action: 'deleteFeature', layerId: 'layer-1', featureIndex: 3 }
        });
        dualScreenCoordinator._handleMessage({
            type: MessageType.CTX_CMD,
            payload: { action: 'quickDraw' }
        });
        dualScreenCoordinator._handleMessage({
            type: MessageType.CTX_CMD,
            payload: { action: 'presentationLink' }
        });
        expect(deleted).toHaveBeenCalledWith('layer-1', 3);
        expect(quickDraw).toHaveBeenCalledOnce();
        expect(presentation).toHaveBeenCalledOnce();
    });

    it('shows the map legend from pop-out layers and hides layers that are off', () => {
        const roads = lineLayer('roads', 'Roads');
        const hidden = lineLayer('hidden', 'Hidden');
        hidden.visible = false;
        replacePopoutLayers([roads, hidden]);
        expect(popoutLegendEntries().map((entry) => entry.name)).toEqual(['Roads']);
        expect(popoutLegendEntries()[0].items[0].swatch).toBe('line');

        notePopoutMapCommand('toggleLayer', ['roads', false]);
        expect(popoutLegendEntries()).toEqual([]);
        notePopoutMapCommand('toggleLayer', ['roads', true]);
        notePopoutMapCommand('toggleLayer', ['hidden', true]);
        notePopoutMapCommand('syncLayerOrder', [['hidden', 'roads']]);
        expect(popoutLegendEntries().map((entry) => entry.id)).toEqual(['hidden', 'roads']);
    });

    it('routes pop-out PNG and PDF through the header export wrappers', async () => {
        const warn = vi.fn();
        const mapApi = { getMap: () => ({ loaded: () => true }) };
        await exportPopoutMapView(mapApi, 'png', { onWarning: warn });
        await exportPopoutMapView(mapApi, 'pdf', {
            pageSize: 'tabloid',
            title: 'Site map',
            onWarning: warn
        });
        expect(EXPORT_CANVAS_MAX_PIXELS).toBe(16_000_000);
        expect(exportHeaderMapView).toHaveBeenNthCalledWith(1, mapApi, 'png', expect.objectContaining({
            blockWhenDualScreen: false,
            onWarning: warn
        }));
        expect(exportHeaderMapView.mock.calls[0][2].maxPixels).toBeUndefined();
        expect(exportHeaderMapView).toHaveBeenNthCalledWith(2, mapApi, 'pdf', expect.objectContaining({
            blockWhenDualScreen: false,
            pageSize: 'tabloid',
            title: 'Site map',
            onWarning: warn
        }));
    });

    it('records an orbit GIF with more than one frame', async () => {
        const moveHandlers = [];
        const map = {
            getCenter: () => ({ lng: -111.8, lat: 40.4 }),
            getBearing: () => 15,
            once(event, cb) { if (event === 'moveend') moveHandlers.push(cb); },
            off() {},
            easeTo(options) {
                this.easeOptions = options;
                moveHandlers.shift()?.();
            },
            easeOptions: null
        };
        const resume = vi.fn();
        suspendMapInteractions.mockReturnValue(resume);
        const mapApi = {
            getMap: () => map,
            prepareOrbitView: vi.fn(async () => ({ startBearing: 15 }))
        };

        const result = await exportPopoutMapView(mapApi, 'gif', {
            durationMs: 0,
            frameCount: 4,
            onInfo: vi.fn()
        });

        expect(mapApi.prepareOrbitView).toHaveBeenCalledWith(
            { lng: -111.8, lat: 40.4 },
            { duration: 0 }
        );
        expect(map.easeOptions.bearing).toBe(375);
        expect(buildGifBlob.mock.calls[0][0]).toHaveLength(4);
        expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'map.gif');
        expect(resume).toHaveBeenCalled();
        expect(result.frames).toBe(4);
        expect(exportHeaderMapView).not.toHaveBeenCalled();
    });

    it('shares main window CSS and mounts the React print menu and context menu without a legend overlay', () => {
        const html = readFileSync('map-window.html', 'utf8');
        const css = readFileSync('css/map-window.css', 'utf8');
        const source = readFileSync('js/map-window.js', 'utf8');
        const mainAt = html.indexOf('css/main.css');
        const shellAt = html.indexOf('css/map-window.css');
        expect(mainAt).toBeGreaterThan(-1);
        expect(shellAt).toBeGreaterThan(mainAt);
        expect(html).toContain('id="map-print-host"');
        expect(html).not.toContain('data-format="gif"');
        expect(css).not.toMatch(/\.map-legend\b/);
        expect(css).not.toMatch(/\.map-context-menu\b/);
        expect(css).not.toMatch(/\.header-print-dropdown\b/);
        expect(source).not.toContain('setupMapPrintMenu');
        expect(source).toContain('exportPopoutMapView');
        expect(source).toContain('mountMapContextMenu');
        expect(source).not.toContain('mountPopoutLegend');
        expect(source).not.toContain('map-window-legend-host');
        expect(source).toContain('mountMapPrintMenu');
    });
});
