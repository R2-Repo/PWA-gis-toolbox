import { describe, expect, it } from 'vitest';
import {
    hasCapability,
    hasRequiredCapabilities,
    listAvailableOptionalCapabilities
} from '../js/platform/contracts.js';
import { createWebPlatform } from '../js/platform/web/web-platform.js';
import { createPlatform, refreshPlatformBundle } from '../js/platform/create-platform.js';

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
        const bundle = createPlatform();
        expect(bundle.platform.runtime).toBe('web');
        expect(bundle.services.compute).toBeTruthy();
        expect(bundle.services.files).toBeTruthy();
        expect(bundle.services.jobs).toBeTruthy();
        expect(bundle.services.windows?.openMapWindow).toBeTypeOf('function');
    });

    it('refreshPlatformBundle keeps the web provider', async () => {
        const bundle = await refreshPlatformBundle();
        expect(bundle.platform.runtime).toBe('web');
        expect(bundle.services.windows?.openMapWindow).toBeTypeOf('function');
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

    it('web compute/job stubs reject unknown operations', async () => {
        const { services } = createWebPlatform();
        await expect(services.compute.run('generate-contours', {})).rejects.toThrow(/No browser implementation/i);
        await expect(services.jobs.start({ operation: 'generate-contours', input: {} })).rejects.toThrow(/No browser runner/i);
    });
});
