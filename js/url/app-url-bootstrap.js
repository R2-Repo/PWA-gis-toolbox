import bus from '../core/event-bus.js';
import { getAppUrlConfig } from './app-url-detector.js';
import { resolveAppUrlMapInit } from './app-url-builder.js';
import { applyLiveLayerConfig } from '../live-layers/live-layer-bootstrap.js';
import { resolveMapPreset } from '../live-layers/catalog-schema.js';
import { applyChromeFromConfig, waitForMapStyleReady } from '../widgets/live-map/apply-live-map-config.js';

/**
 * @typedef {object} AppUrlBootstrapDeps
 * @property {import('../map/map-service.js').default} mapService
 * @property {(side: 'left' | 'right', collapsed: boolean) => void} setPanelCollapsed
 * @property {(mode: import('./app-url-schema.js').PanelMode) => void} [applyPanelMode]
 */

/**
 * Apply panel chrome from URL config.
 * @param {import('./app-url-schema.js').PanelMode | undefined} panel
 * @param {AppUrlBootstrapDeps} deps
 */
export function applyPanelConfig(panel, deps) {
    if (!panel) return;
    const { setPanelCollapsed } = deps;

    switch (panel) {
        case 'both':
            setPanelCollapsed('left', false);
            setPanelCollapsed('right', false);
            break;
        case 'left':
            setPanelCollapsed('left', false);
            setPanelCollapsed('right', true);
            break;
        case 'right':
            setPanelCollapsed('left', true);
            setPanelCollapsed('right', false);
            break;
        case 'none':
            setPanelCollapsed('left', true);
            setPanelCollapsed('right', true);
            break;
        default:
            break;
    }

    bus.emit('app-url:panel', panel);
    deps.applyPanelMode?.(panel);
}

/**
 * Apply viewport after map is loaded (bounds fit or jumpTo).
 * @param {import('maplibre-gl').Map} map
 * @param {ReturnType<typeof resolveAppUrlMapInit>} init
 */
export function applyViewportConfig(map, init) {
    if (!map || !init) return;

    if (init.bounds?.length === 4) {
        map.fitBounds(
            [
                [init.bounds[0], init.bounds[1]],
                [init.bounds[2], init.bounds[3]]
            ],
            { padding: init.padding ?? 30, duration: 0 }
        );
        if (init.pitch || init.bearing) {
            map.jumpTo({ pitch: init.pitch, bearing: init.bearing });
        }
        return;
    }

    map.jumpTo({
        center: init.center,
        zoom: init.zoom,
        pitch: init.pitch,
        bearing: init.bearing
    });
}

/**
 * Merge preset config with explicit URL params (explicit wins).
 * @param {import('./app-url-schema.js').AppUrlConfig} urlConfig
 */
export function mergePresetWithUrlConfig(urlConfig) {
    if (!urlConfig.map) return urlConfig;
    const preset = resolveMapPreset(urlConfig.map);
    if (!preset) return urlConfig;

    return {
        basemap: urlConfig.basemap ?? preset.basemap,
        dim: urlConfig.dim ?? preset.dim,
        panel: urlConfig.panel ?? preset.panel,
        view: urlConfig.view ?? preset.view,
        bounds: urlConfig.bounds ?? preset.bounds,
        padding: urlConfig.padding ?? preset.padding,
        map: urlConfig.map,
        live: urlConfig.live?.length ? urlConfig.live : preset.live
    };
}

/**
 * @param {AppUrlBootstrapDeps} deps
 */
export function bootstrapAppUrl(deps) {
    const rawConfig = getAppUrlConfig();
    const config = mergePresetWithUrlConfig(rawConfig);
    const init = resolveAppUrlMapInit(config);

    applyPanelConfig(config.panel, deps);

    const map = deps.mapService.getMap?.();
    if (map?.loaded?.()) {
        void applyAfterMapReady(deps, config, init);
    } else {
        const onReady = () => {
            bus.off('map:ready', onReady);
            void applyAfterMapReady(deps, config, init);
        };
        bus.on('map:ready', onReady);
    }
}

/**
 * @param {AppUrlBootstrapDeps} deps
 * @param {import('./app-url-schema.js').AppUrlConfig} config
 * @param {ReturnType<typeof resolveAppUrlMapInit>} init
 */
async function applyAfterMapReady(deps, config, init) {
    const map = deps.mapService.getMap?.();
    if (!map) return;

    await applyChromeFromConfig({ mapService: deps.mapService }, config);
    await waitForMapStyleReady(map);
    applyViewportConfig(map, init);

    await applyLiveLayerConfig(config, deps);
}

export { resolveAppUrlMapInit };
