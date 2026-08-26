/**
 * App-owned CARTO basemap key injected at build time (Cloudflare / Vite).
 * Users never enter a key in the app.
 */

/**
 * @returns {string}
 */
export function getEnvCartoApiKey() {
    try {
        return String(import.meta.env?.VITE_CARTO_API_KEY || '').trim();
    } catch {
        return '';
    }
}

/**
 * @returns {string}
 */
export function resolveCartoApiKey() {
    return getEnvCartoApiKey() || '';
}

/**
 * @returns {boolean}
 */
export function hasResolvedCartoApiKey() {
    return Boolean(resolveCartoApiKey());
}

/**
 * Append `key` to a CARTO URL. Leaves template braces (`{fontstack}`) intact.
 * @param {string} url
 * @param {string} [apiKey]
 * @returns {string}
 */
export function withCartoKey(url, apiKey = resolveCartoApiKey()) {
    if (!url) return url;
    const key = String(apiKey || '').trim();
    if (!key) return url;

    if (url.includes('{')) {
        if (/[?&]key=/.test(url)) return url;
        return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
    }

    try {
        const parsed = new URL(url);
        parsed.searchParams.set('key', key);
        return parsed.toString();
    } catch {
        if (/[?&]key=/.test(url)) return url;
        return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
    }
}
