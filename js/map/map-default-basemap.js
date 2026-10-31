/**
 * Default basemap key at map init (before URL chrome is applied).
 * E2E / preview test bundles set VITE_E2E so the map never hits remote tiles.
 */
export function resolveDefaultBasemapKey() {
    if (import.meta.env.VITE_E2E === '1') {
        return 'offline';
    }
    return 'voyager';
}
