import { SHOW_SPLASH } from './app-config.js';

const DESKTOP_MIN_WIDTH = 768;

/**
 * Shows the startup splash modal on desktop when enabled in app config.
 * Resolves immediately when splash is disabled so boot does not block on it.
 * @param {(opts?: object) => Promise<unknown>} showToolInfo
 */
export async function showStartupSplashIfEnabled(showToolInfo) {
    if (!SHOW_SPLASH) return;
    if (typeof window !== 'undefined' && window.innerWidth >= DESKTOP_MIN_WIDTH) {
        await showToolInfo();
    }
}
