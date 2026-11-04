/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../js/ui/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../js/export/exporter.js', () => ({
    downloadBlob: vi.fn()
}));

vi.mock('../js/core/libs.js', () => ({
    loadJsPDF: vi.fn()
}));

vi.mock('../js/map/map-export.js', () => ({
    ensureMapCaptureReady: vi.fn(async () => {}),
    captureLiveFrame: vi.fn(),
    captureMapCanvas: vi.fn(),
    canvasToPngBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    buildMapExportFilename: vi.fn((ext) => `map.${ext}`),
    willUseHighResExport: vi.fn(() => false),
    computeExportPixelRatio: vi.fn(() => 1)
}));

import { loadJsPDF } from '../js/core/libs.js';
import { captureMapCanvas } from '../js/map/map-export.js';
import { exportHeaderMapView } from '../js/map/header-export.js';
import { MapPrintMenu } from '../react/header/MapPrintMenu.jsx';
import { loadWidgetStore } from '../js/widgets/widget-state-store.js';

function mapWithView() {
    return {
        areTilesLoaded: () => true,
        getBounds: () => ({
            getWest: () => 0,
            getSouth: () => 0,
            getEast: () => 1,
            getNorth: () => 0
        }),
        getCenter: () => ({ lat: 0, lng: 0.5 }),
        getZoom: () => 10,
        getBearing: () => 0,
        getContainer: () => ({ clientWidth: 800, clientHeight: 600 })
    };
}

function jpegCanvas(width, height) {
    return {
        width,
        height,
        toDataURL() {
            return 'data:image/jpeg;base64,bWFw';
        }
    };
}

function installFakeJsPDF() {
    const calls = [];
    class FakeJsPDF {
        constructor(options) {
            calls.push({ type: 'construct', options });
        }
        setFont() {}
        setFontSize() {}
        setTextColor() {}
        setFillColor() {}
        setDrawColor() {}
        setLineWidth() {}
        text(...args) {
            calls.push({ type: 'text', args });
        }
        rect() {}
        triangle() {}
        addImage() {}
        output() {
            return new Blob(['pdf'], { type: 'application/pdf' });
        }
    }
    loadJsPDF.mockResolvedValue(FakeJsPDF);
    return calls;
}

function buttonByText(container, text) {
    return [...container.querySelectorAll('button')].find((btn) => btn.textContent.trim() === text);
}

async function clickAndFinish(container, label, onExportMapView) {
    const before = onExportMapView.mock.results.length;
    await act(async () => {
        buttonByText(container, label).click();
    });
    const pending = onExportMapView.mock.results.slice(before).map((result) => result.value);
    await act(async () => {
        await Promise.all(pending);
    });
}

async function renderMenu(onExportMapView) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(h(MapPrintMenu, { onExportMapView }));
    });
    await act(async () => {
        container.querySelector('#btn-print-map').click();
    });
    return {
        container,
        async unmount() {
            await act(async () => {
                root.unmount();
            });
            container.remove();
        }
    };
}

describe('header print menu PDF choices', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        loadWidgetStore({ activeWidgets: [] });
        captureMapCanvas.mockImplementation(async (mapService, options) => {
            options?.beforeCapture?.(mapService.getMap());
            return jpegCanvas(2000, 500);
        });
    });

    afterEach(() => {
        loadWidgetStore({ activeWidgets: [] });
    });

    it('sends Letter and the project name, or Map, through to the header PDF layout', async () => {
        const calls = installFakeJsPDF();
        const onExportMapView = vi.fn(async (format, options) => {
            if (format === 'pdf') {
                return exportHeaderMapView({ getMap: () => mapWithView() }, format, options);
            }
            return null;
        });

        const view = await renderMenu(onExportMapView);
        const title = view.container.querySelector('#header-pdf-title');
        expect(title.value).toBe('Map');
        expect(buttonByText(view.container, 'Letter').getAttribute('aria-pressed')).toBe('true');

        await clickAndFinish(view.container, 'Download PDF', onExportMapView);

        expect(onExportMapView).toHaveBeenCalledWith('pdf', { pageSize: 'letter', title: 'Map' });
        expect(calls.find((call) => call.type === 'construct').options.format).toEqual([792, 612]);
        expect(calls.filter((call) => call.type === 'text').map((call) => call.args[0])).toContain('Map');
        await view.unmount();

        loadWidgetStore({
            activeWidgets: [{
                type: 'sheet-cutting',
                open: true,
                state: { project: { projectName: 'Highway 88' } }
            }]
        });
        calls.length = 0;
        const named = await renderMenu(onExportMapView);
        expect(named.container.querySelector('#header-pdf-title').value).toBe('Highway 88');
        await clickAndFinish(named.container, 'Download PDF', onExportMapView);
        expect(onExportMapView).toHaveBeenCalledWith('pdf', { pageSize: 'letter', title: 'Highway 88' });
        expect(calls.filter((call) => call.type === 'text').map((call) => call.args[0])).toContain('Highway 88');
        await named.unmount();
        loadWidgetStore({ activeWidgets: [] });
    });

    it('sends the chosen Tabloid page and title through to the header PDF layout', async () => {
        const calls = installFakeJsPDF();
        loadWidgetStore({
            activeWidgets: [{
                type: 'sheet-cutting',
                open: true,
                state: { project: { projectName: 'Highway 88' } }
            }]
        });
        const onExportMapView = vi.fn(async (format, options) => {
            return exportHeaderMapView({ getMap: () => mapWithView() }, format, options);
        });
        const view = await renderMenu(onExportMapView);
        const title = view.container.querySelector('#header-pdf-title');
        expect(title.value).toBe('Highway 88');

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        await act(async () => {
            buttonByText(view.container, 'Tabloid').click();
            setter.call(title, 'Site map');
            title.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await clickAndFinish(view.container, 'Download PDF', onExportMapView);

        expect(onExportMapView).toHaveBeenCalledWith('pdf', { pageSize: 'tabloid', title: 'Site map' });
        expect(calls.find((call) => call.type === 'construct').options).toMatchObject({
            orientation: 'landscape',
            format: [1224, 792]
        });
        expect(calls.filter((call) => call.type === 'text').map((call) => call.args[0])).toContain('Site map');
        await view.unmount();
        loadWidgetStore({ activeWidgets: [] });
    });

    it('keeps a working Orbit GIF action in the print menu', async () => {
        const onExportMapView = vi.fn(async () => null);
        const view = await renderMenu(onExportMapView);
        const gif = buttonByText(view.container, 'Download Orbit GIF');
        expect(gif).toBeTruthy();
        expect(gif.hidden).toBe(false);
        await clickAndFinish(view.container, 'Download Orbit GIF', onExportMapView);
        expect(onExportMapView).toHaveBeenCalledWith('gif', undefined);
        await view.unmount();
    });
});
