import { describe, expect, it } from 'vitest';
import {
    hasCapability,
    hasRequiredCapabilities,
    listAvailableOptionalCapabilities
} from '../js/platform/contracts.js';
import { createWebPlatform } from '../js/platform/web/web-platform.js';
import {
    createPlatform,
    isTauriShellPresent,
    isWindowsDesktopRuntime
} from '../js/platform/create-platform.js';
import { createWindowsPlatform } from '../js/platform/windows/windows-platform.js';

/**
 * Local mirror of registry filtering — avoids importing controllers that need DOM.
 * @param {import('../js/platform/contracts.js').PlatformInfo} platform
 * @param {Array<{ type: string, requiredCapabilities?: string[] }>} widgets
 */
function filterVisible(platform, widgets) {
    return widgets.filter((widget) =>
        hasRequiredCapabilities(platform, widget.requiredCapabilities)
    );
}

describe('platform contracts', () => {
    it('reports web capabilities as unavailable by default', () => {
        const { platform } = createWebPlatform();
        expect(platform.runtime).toBe('web');
        expect(platform.os).toBe('browser');
        expect(hasCapability(platform, 'pythonCompute')).toBe(false);
        expect(hasCapability(platform, 'localSqlite')).toBe(false);
        expect(hasCapability(platform, 'icmpPing')).toBe(false);
        expect(hasRequiredCapabilities(platform, [])).toBe(true);
        expect(hasRequiredCapabilities(platform, ['pythonCompute'])).toBe(false);
        expect(listAvailableOptionalCapabilities(platform, ['pythonCompute', 'gpuCompute'])).toEqual([]);
    });

    it('createPlatform defaults to the web provider in Node/test', () => {
        expect(isWindowsDesktopRuntime()).toBe(false);
        expect(isTauriShellPresent()).toBe(false);
        const bundle = createPlatform();
        expect(bundle.platform.runtime).toBe('web');
        expect(bundle.services.compute).toBeTruthy();
        expect(bundle.services.files).toBeTruthy();
        expect(bundle.services.jobs).toBeTruthy();
        expect(bundle.services.windows?.openMapWindow).toBeTypeOf('function');
    });

    it('windows platform marks nativeFiles when Tauri globals are absent', () => {
        const { platform, services } = createWindowsPlatform();
        expect(platform.runtime).toBe('windows');
        expect(platform.capabilities.nativeFiles.available).toBe(false);
        expect(services.files.open).toBeTypeOf('function');
        expect(services.files.revealInExplorer).toBeTypeOf('function');
        expect(services.windows?.openMapWindow).toBeTypeOf('function');
    });

    it('keeps shared widgets visible when they require no special capabilities', () => {
        const { platform } = createWebPlatform();
        const widgets = [
            { type: 'spatial-analyzer', requiredCapabilities: [] },
            { type: 'sheet-cutting', requiredCapabilities: [] },
            {
                type: 'point-cloud-classifier',
                requiredCapabilities: ['pythonCompute', 'localPdal']
            }
        ];
        const visible = filterVisible(platform, widgets);
        expect(visible.map((w) => w.type)).toEqual(['spatial-analyzer', 'sheet-cutting']);
    });

    it('web compute/job stubs reject unknown native operations', async () => {
        const { services } = createWebPlatform();
        await expect(services.compute.run('generate-contours', {})).rejects.toThrow(/Windows desktop/i);
        await expect(services.jobs.start({ operation: 'generate-contours', input: {} })).rejects.toThrow(/Windows desktop/i);
    });

    it('shows geojson-file-summary only when nativeFiles + pythonCompute are available', () => {
        const required = ['pythonCompute', 'nativeFiles'];
        const web = createWebPlatform().platform;
        expect(hasRequiredCapabilities(web, required)).toBe(false);

        const desktopReady = {
            runtime: 'windows',
            os: 'windows',
            capabilities: {
                nativeFiles: { available: true },
                pythonCompute: { available: true, version: '0.1.0' }
            }
        };
        expect(hasRequiredCapabilities(desktopReady, required)).toBe(true);
        expect(filterVisible(web, [{ type: 'geojson-file-summary', requiredCapabilities: required }])).toEqual([]);
        expect(filterVisible(desktopReady, [{ type: 'geojson-file-summary', requiredCapabilities: required }])
            .map((w) => w.type)).toEqual(['geojson-file-summary']);
    });
});
