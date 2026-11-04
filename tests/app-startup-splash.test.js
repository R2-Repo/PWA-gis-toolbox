/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('showStartupSplashIfEnabled', () => {
    beforeEach(() => {
        vi.resetModules();
        Object.defineProperty(window, 'innerWidth', {
            value: 1024,
            configurable: true
        });
    });

    afterEach(() => {
        vi.doUnmock('../js/app-config.js');
        vi.resetModules();
    });

    it('does not call showToolInfo or block when SHOW_SPLASH is false', async () => {
        vi.doMock('../js/app-config.js', () => ({ SHOW_SPLASH: false }));
        const { showStartupSplashIfEnabled } = await import('../js/app-startup-splash.js');
        const showToolInfo = vi.fn(() => new Promise(() => {}));

        await expect(
            Promise.race([
                showStartupSplashIfEnabled(showToolInfo),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 200))
            ])
        ).resolves.toBeUndefined();

        expect(showToolInfo).not.toHaveBeenCalled();
    });

    it('awaits showToolInfo on desktop when SHOW_SPLASH is true', async () => {
        vi.doMock('../js/app-config.js', () => ({ SHOW_SPLASH: true }));
        const { showStartupSplashIfEnabled } = await import('../js/app-startup-splash.js');
        let splashClosed = false;
        const showToolInfo = vi.fn(async () => {
            await new Promise((r) => setTimeout(r, 30));
            splashClosed = true;
        });

        await showStartupSplashIfEnabled(showToolInfo);

        expect(showToolInfo).toHaveBeenCalledOnce();
        expect(splashClosed).toBe(true);
    });

    it('skips showToolInfo on narrow viewports even when SHOW_SPLASH is true', async () => {
        vi.doMock('../js/app-config.js', () => ({ SHOW_SPLASH: true }));
        Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
        const { showStartupSplashIfEnabled } = await import('../js/app-startup-splash.js');
        const showToolInfo = vi.fn();

        await showStartupSplashIfEnabled(showToolInfo);

        expect(showToolInfo).not.toHaveBeenCalled();
    });
});

describe('ToolGuideDialog splash UI', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
    });

    it('still renders splash guide when mounted (flag true path uses this content)', async () => {
        const { ToolGuideDialog } = await import('../react/tools/ToolGuideDialog.jsx');

        await act(async () => {
            root.render(h(ToolGuideDialog, { showTitle: true }));
        });

        expect(container.querySelector('.splash-guide')).toBeTruthy();
        expect(container.querySelector('.splash-flow')).toBeTruthy();
        expect(container.querySelector('.splash-tips')).toBeTruthy();
    });
});
