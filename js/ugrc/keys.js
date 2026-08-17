/**
 * App-owned browser key injected at build time (Cloudflare / Vite).
 * Users never enter a key in the app.
 * @returns {string}
 */
export function getEnvUgrcApiKey() {
    try {
        return String(import.meta.env?.VITE_UGRC_API_KEY || '').trim();
    } catch {
        return '';
    }
}

/**
 * @returns {string}
 */
export function resolveUgrcApiKey() {
    return getEnvUgrcApiKey() || '';
}

/**
 * @returns {boolean}
 */
export function hasResolvedUgrcApiKey() {
    return Boolean(resolveUgrcApiKey());
}
