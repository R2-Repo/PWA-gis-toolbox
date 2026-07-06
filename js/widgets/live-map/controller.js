import bus from '../../core/event-bus.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { addLiveConfigToMap } from '../../live-layers/live-layer-bootstrap.js';
import { applyViewportConfig } from '../../url/app-url-bootstrap.js';
import { resolveAppUrlMapInit } from '../../url/app-url-builder.js';
import {
    buildLiveMapUrl,
    buildCatalogEntryJson,
    buildServiceLayersFromForm,
    captureCurrentMapView,
    createDefaultFormState,
    formStateToAppUrlConfig,
    listPresets,
    validateCustomUrls
} from './engine.js';
import { addLayer, getLayers } from '../../core/state.js';

function applyChromeFromConfig(ctx, config) {
    if (config.panel) bus.emit('app-url:panel', config.panel);
    if (config.dim === '3d') ctx.mapService.enable3D({ animate: false });
    else if (config.dim === '2d') ctx.mapService.disable3D({ animate: false });
    if (config.basemap) ctx.mapService.setBasemap(config.basemap);
    bus.emit('map:chrome', {
        basemap: config.basemap || ctx.mapService.getCurrentBasemap?.(),
        is3d: config.dim === '3d'
    });
}

export async function openLiveMap(ctx) {
    await openReactIsland({
        title: 'Live Map',
        width: '640px',
        mountPath: '../../../react/widgets/mountLiveMapDialog.jsx',
        mountExport: 'mountLiveMapDialog',
        getProps: (close) => ({
            presets: listPresets(),
            initialForm: createDefaultFormState(),
            onCancel: close,
            onCaptureView: (currentForm) => {
                const map = ctx.mapService.getMap?.();
                if (!map) return currentForm;
                return captureCurrentMapView(currentForm, map, {
                    basemap: ctx.mapService.getCurrentBasemap?.(),
                    dim: ctx.mapService.is3DEnabled?.() ? '3d' : '2d',
                    panel: currentForm.panel
                });
            },
            onBuildUrl: (form) => buildLiveMapUrl(form),
            onBuildCatalogEntry: (form) => buildCatalogEntryJson(form),
            onValidateCustom: (urls) => validateCustomUrls(urls),
            onAddToMap: async (form) => {
                if (form.tab === 'custom') {
                    const errors = validateCustomUrls(form.customUrls);
                    if (errors.length) throw new Error(errors[0]);
                }

                const config = formStateToAppUrlConfig(form);

                if (form.tab === 'prebuilt' && form.selectedPresetId) {
                    applyChromeFromConfig(ctx, config);
                    await addLiveConfigToMap(ctx, config);
                    const init = resolveAppUrlMapInit(config);
                    const map = ctx.mapService.getMap?.();
                    if (map?.loaded?.()) applyViewportConfig(map, init);
                    ctx.showToast('Prebuilt map added', 'success');
                    close();
                    ctx.refreshUI();
                    return;
                }

                applyChromeFromConfig(ctx, config);
                const init = resolveAppUrlMapInit(config);
                const map = ctx.mapService.getMap?.();
                if (map?.loaded?.()) applyViewportConfig(map, init);

                const layers = buildServiceLayersFromForm(form);
                for (let i = 0; i < layers.length; i++) {
                    const dataset = layers[i];
                    addLayer(dataset, { activate: i === layers.length - 1 });
                    await ctx.mapService.addServiceLayer(dataset, getLayers().indexOf(dataset), { fit: i === 0 });
                }
                ctx.showToast(`Added ${layers.length} live layer${layers.length === 1 ? '' : 's'}`, 'success');
                close();
                ctx.refreshUI();
            },
            onCopyUrl: async (form) => {
                const url = buildLiveMapUrl(form);
                await navigator.clipboard.writeText(url);
                ctx.showToast('URL copied to clipboard', 'success');
            },
            onCopyCatalogEntry: async (form) => {
                const json = buildCatalogEntryJson(form);
                await navigator.clipboard.writeText(json);
                ctx.showToast('Catalog entry JSON copied', 'success');
            }
        })
    });
}
