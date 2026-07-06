import { openReactIsland } from '../../ui/open-react-island.js';
import { applyLiveMapConfigToMap } from './apply-live-map-config.js';
import {
    buildLiveMapUrl,
    buildCatalogEntryJson,
    captureCurrentMapView,
    createDefaultFormState,
    formStateToAppUrlConfig,
    validateCustomUrls
} from './engine.js';

export async function openLiveMap(ctx) {
    await openReactIsland({
        title: 'Live Map',
        width: '640px',
        mountPath: '../../../react/widgets/mountLiveMapDialog.jsx',
        mountExport: 'mountLiveMapDialog',
        getProps: (close) => ({
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
            onValidateCustom: (urls) => validateCustomUrls(urls),
            onAddToMap: async (form) => {
                const errors = validateCustomUrls(form.customUrls);
                if (errors.length) throw new Error(errors[0]);

                const config = formStateToAppUrlConfig(form);
                const layerCount = await applyLiveMapConfigToMap(ctx, config);
                if (!layerCount) throw new Error('Add at least one layer URL.');

                ctx.showToast(`Added ${layerCount} live layer${layerCount === 1 ? '' : 's'}`, 'success');
                close();
                ctx.refreshUI();
            },
            onCopyUrl: async (form) => {
                const errors = validateCustomUrls(form.customUrls);
                if (errors.length) throw new Error(errors[0]);

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
