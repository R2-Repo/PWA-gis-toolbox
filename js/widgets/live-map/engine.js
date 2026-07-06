import { buildAppUrl, captureAppUrlFromMap, encodeLiveUrlEntry, parseLiveEntry } from '../../url/app-url-builder.js';
import { inferServiceKind, listLiveMapPresets, presetToAppUrlConfig, appUrlConfigToCatalogPreset, resolveMapPreset, resolveLiveLayer } from '../../live-layers/catalog-schema.js';
import { createServiceLayer } from '../../core/data-model.js';
import { createServiceLayerFromUrl } from '../../live-layers/live-layer-engine.js';

export const PANEL_OPTIONS = [
    { value: 'both', label: 'Both panels' },
    { value: 'left', label: 'Left only' },
    { value: 'right', label: 'Right only' },
    { value: 'none', label: 'No panels' }
];

export const BASEMAP_OPTIONS = [
    { value: 'voyager', label: 'Voyager' },
    { value: 'satellite', label: 'Satellite' }
];

export const DIM_OPTIONS = [
    { value: '2d', label: '2D' },
    { value: '3d', label: '3D' }
];

export function createDefaultFormState() {
    return {
        tab: 'prebuilt',
        selectedPresetId: '',
        customUrls: [''],
        basemap: 'voyager',
        dim: '2d',
        panel: 'both',
        viewMode: 'center',
        zoom: 7,
        lng: -111.09,
        lat: 39.32,
        pitch: 0,
        bearing: 0,
        boundsWest: -112.1,
        boundsSouth: 39.5,
        boundsEast: -111.0,
        boundsNorth: 40.5,
        padding: 30
    };
}

/**
 * @param {ReturnType<typeof createDefaultFormState>} form
 */
export function formStateToAppUrlConfig(form) {
    /** @type {import('../../url/app-url-schema.js').AppUrlConfig} */
    const config = {
        basemap: form.basemap,
        dim: form.dim,
        panel: form.panel,
        live: form.customUrls
            .map((url) => url.trim())
            .filter(Boolean)
            .map((url) => encodeLiveUrlEntry(url))
    };

    if (form.tab === 'prebuilt' && form.selectedPresetId) {
        const presetConfig = resolveMapPreset(form.selectedPresetId);
        if (presetConfig) {
            return {
                ...presetConfig,
                basemap: form.basemap || presetConfig.basemap,
                dim: form.dim || presetConfig.dim,
                panel: form.panel || presetConfig.panel,
                view: form.viewMode === 'center' ? configViewFromForm(form) : presetConfig.view,
                bounds: form.viewMode === 'bounds' ? boundsFromForm(form) : presetConfig.bounds,
                padding: form.padding
            };
        }
        config.map = form.selectedPresetId;
    }

    if (form.viewMode === 'bounds') {
        config.bounds = boundsFromForm(form);
        config.padding = form.padding;
    } else {
        config.view = configViewFromForm(form);
    }

    return config;
}

/**
 * @param {ReturnType<typeof createDefaultFormState>} form
 */
function configViewFromForm(form) {
    return {
        zoom: Number(form.zoom),
        center: [Number(form.lng), Number(form.lat)],
        pitch: Number(form.pitch) || 0,
        bearing: Number(form.bearing) || 0
    };
}

/**
 * @param {ReturnType<typeof createDefaultFormState>} form
 */
function boundsFromForm(form) {
    return [
        Number(form.boundsWest),
        Number(form.boundsSouth),
        Number(form.boundsEast),
        Number(form.boundsNorth)
    ];
}

/**
 * @param {ReturnType<typeof createDefaultFormState>} form
 */
export function buildLiveMapUrl(form, baseUrl) {
    return buildAppUrl(formStateToAppUrlConfig(form), baseUrl);
}

/**
 * @param {ReturnType<typeof createDefaultFormState>} form
 */
export function buildCatalogEntryJson(form, meta = {}) {
    const preset = appUrlConfigToCatalogPreset(formStateToAppUrlConfig(form), meta);
    return JSON.stringify(preset, null, 2);
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {ReturnType<typeof createDefaultFormState>} form
 */
export function captureCurrentMapView(form, map, chrome = {}) {
    const captured = captureAppUrlFromMap(map, { mode: form.viewMode === 'bounds' ? 'bounds' : 'center' });
    const next = { ...form };
    if (captured.view) {
        next.viewMode = 'center';
        next.zoom = captured.view.zoom;
        next.lng = captured.view.center[0];
        next.lat = captured.view.center[1];
        next.pitch = captured.view.pitch ?? 0;
        next.bearing = captured.view.bearing ?? 0;
    }
    if (captured.bounds) {
        next.viewMode = 'bounds';
        next.boundsWest = captured.bounds[0];
        next.boundsSouth = captured.bounds[1];
        next.boundsEast = captured.bounds[2];
        next.boundsNorth = captured.bounds[3];
        next.padding = captured.padding ?? 30;
    }
    if (chrome.basemap) next.basemap = chrome.basemap;
    if (chrome.dim) next.dim = chrome.dim;
    if (chrome.panel) next.panel = chrome.panel;
    return next;
}

/**
 * @param {string[]} urls
 */
export function validateCustomUrls(urls) {
    const errors = [];
    const trimmed = urls.map((u) => u.trim()).filter(Boolean);
    if (!trimmed.length) errors.push('Add at least one layer URL.');
    for (const url of trimmed) {
        try {
            // eslint-disable-next-line no-new
            new URL(url);
        } catch {
            errors.push(`Invalid URL: ${url}`);
            continue;
        }
        if (!inferServiceKind(url)) {
            errors.push(`Could not detect service type for: ${url}`);
        }
    }
    return errors;
}

/**
 * @param {string} presetId
 */
export function getPresetConfig(presetId) {
    return presetToAppUrlConfig({ id: presetId, layers: [], name: presetId, ...resolveMapPreset(presetId) });
}

export function listPresets() {
    return listLiveMapPresets();
}

/**
 * @param {ReturnType<typeof createDefaultFormState>} form
 */
export function buildServiceLayersFromForm(form) {
    if (form.tab === 'prebuilt' && form.selectedPresetId) {
        const config = resolveMapPreset(form.selectedPresetId);
        if (!config?.live?.length) return [];
        return config.live.map((entry) => {
            const parsed = parseLiveEntry(entry);
            if (parsed.type === 'url') {
                return createServiceLayerFromUrl('Live Layer', parsed.url);
            }
            const catalogEntry = resolveLiveLayer(parsed.id);
            if (!catalogEntry) return null;
            return createServiceLayer({
                name: catalogEntry.name,
                url: catalogEntry.url,
                kind: catalogEntry.kind,
                refreshMs: catalogEntry.refreshMs,
                opacity: catalogEntry.opacity,
                attribution: catalogEntry.attribution,
                presetId: catalogEntry.id
            });
        }).filter(Boolean);
    }

    return form.customUrls
        .map((url) => url.trim())
        .filter(Boolean)
        .map((url, index) => {
            const kind = inferServiceKind(url);
            return createServiceLayer({
                name: `Live Layer ${index + 1}`,
                url,
                kind: kind || 'geojson-feed'
            });
        });
}
