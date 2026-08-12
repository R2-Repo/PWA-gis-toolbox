import bus from '../core/event-bus.js';
import { getAppUrlConfig } from './app-url-detector.js';
import { resolveAppUrlMapInit } from './app-url-builder.js';
import { isCameraAlreadyAt } from '../map/map-interaction-utils.js';

/**
 * True when the URL actually asked for a camera (not just chrome defaults).
 * Re-applying default Utah/zoom-7 after style-ready fights the first user zoom.
 * @param {import('./app-url-schema.js').AppUrlConfig | null | undefined} config
 */
export function shouldApplyUrlViewport(config) {
    return !!(config?.view || config?.bounds);
}

/**
 * @typedef {object} AppUrlBootstrapDeps
 * @property {import('../map/map-service.js').default} mapService
 * @property {(side: 'left' | 'right', collapsed: boolean) => void} setPanelCollapsed
 * @property {(mode: import('./app-url-schema.js').PanelMode) => void} [applyPanelMode]
 */

/**
 * Wait for map style to finish loading after setBasemap or 3D changes.
 * @param {import('maplibre-gl').Map | null | undefined} map
 * @param {number} [timeoutMs]
 */
export function waitForMapStyleReady(map, timeoutMs = 5000) {
    return new Promise((resolve) => {
        if (!map) {
            resolve();
            return;
        }

        const isReady = () => map.loaded?.() && map.isStyleLoaded?.();
        if (isReady()) {
            resolve();
            return;
        }

        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            map.off('load', onReady);
            map.off('styledata', onStyleData);
            clearTimeout(timer);
            resolve();
        };

        const onReady = () => {
            if (isReady()) finish();
        };
        const onStyleData = () => {
            if (isReady()) finish();
        };

        map.on('load', onReady);
        map.on('styledata', onStyleData);
        const timer = setTimeout(finish, timeoutMs);
    });
}

/**
 * Apply basemap and dimension from URL config.
 * @param {{ mapService: object }} ctx
 * @param {import('./app-url-schema.js').AppUrlConfig} config
 */
export async function applyChromeFromConfig(ctx, config) {
    const mapService = ctx.mapService;
    const currentBasemap = mapService.getCurrentBasemap?.();
    const targetBasemap = config.basemap;
    const target3d = config.dim === '3d';
    const current3d = mapService.is3DEnabled?.();

    if (targetBasemap && targetBasemap !== currentBasemap) {
        mapService.setBasemap(targetBasemap);
        await waitForMapStyleReady(mapService.getMap?.());
    }

    if (target3d) {
        mapService.set3DEnabled(true);
        mapService.reconcile3DState({ emitEvent: false });
        await waitForMapStyleReady(mapService.getMap?.());
    } else if (current3d) {
        mapService.disable3D({ animate: false });
        await waitForMapStyleReady(mapService.getMap?.());
    }

    bus.emit('map:chrome', {
        basemap: mapService.getCurrentBasemap?.(),
        is3d: mapService.is3DEnabled?.()
    });
}

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

    if (isCameraAlreadyAt(map, {
        center: init.center,
        zoom: init.zoom,
        pitch: init.pitch,
        bearing: init.bearing
    })) {
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
 * @param {AppUrlBootstrapDeps} deps
 */
export function bootstrapAppUrl(deps) {
    const config = getAppUrlConfig();
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
    if (!shouldApplyUrlViewport(config)) return;
    await waitForMapStyleReady(map);
    if (deps.mapService.userHasMovedCamera?.()) return;
    applyViewportConfig(map, init);
}

export { resolveAppUrlMapInit };
