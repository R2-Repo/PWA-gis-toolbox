/**
 * Sheet Cutting controller.
 */

import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { isProjectStationingCenterline } from '../project-stationing/route-profile.js';
import { markWidgetClosed, upsertWidgetState } from '../widget-state-store.js';
import { openPlanProductionExport } from '../plan-production-export/controller.js';
import {
    WIDGET_ID,
    SHEET_STEPS,
    PAPER_SIZES,
    PAGE_ORIENTATIONS,
    DEFAULT_SHEET_TEMPLATE,
    createSheetCuttingSession,
    updateSheetProject,
    selectRouteSource,
    configureSheetTemplate,
    selectDesignLayersForSheets,
    setSheetDesignFeatures,
    generateSheetSet,
    buildSessionExport,
    serializeSheetSession,
    restoreSheetSession,
    validateSheetSession
} from './engine.js';
import { clearSheetPreview, showSheetPreview } from './sheet-preview.js';
import { exportSheetPlanPdf } from './sheet-pdf-export.js';

function persistSession(session, open = true) {
    upsertWidgetState(WIDGET_ID, {
        open,
        state: serializeSheetSession(session)
    });
}

function downloadTextFile(filename, content, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function clearPreviewLayers(ctx) {
    clearSheetPreview(ctx.mapService);
}

function renderSheetPreview(ctx, session) {
    const exportPackage = buildSessionExport(session);
    showSheetPreview(ctx.mapService, exportPackage.layers || {});
}

function collectFeaturesFromLayers(ctx, layerIds = []) {
    const features = [];
    for (const layerId of layerIds) {
        const layer = ctx.getLayerById?.(layerId) || ctx.getLayers().find((entry) => entry.id === layerId);
        if (!layer?.geojson?.features?.length) continue;
        features.push(...layer.geojson.features);
    }
    return features;
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {{ restoreState?: object }} [options]
 */
export async function openSheetCutting(ctx, { restoreState = null } = {}) {
    let session = restoreState
        ? restoreSheetSession(restoreState)
        : createSheetCuttingSession();

    await openReactIsland({
        title: 'Sheet Cutter',
        width: '600px',
        mountPath: '../../../react/widgets/mountSheetCuttingDialog.jsx',
        mountExport: 'mountSheetCuttingDialog',
        onClose: () => {
            clearPreviewLayers(ctx);
            markWidgetClosed(WIDGET_ID);
        },
        getProps: (close) => ({
            steps: SHEET_STEPS,
            paperSizes: Object.keys(PAPER_SIZES),
            orientations: Object.values(PAGE_ORIENTATIONS),
            defaultTemplate: DEFAULT_SHEET_TEMPLATE,
            stationingLayers: getSpatialLayerOptions(ctx).filter((layer) => {
                const full = ctx.getLayerById?.(layer.id) || ctx.getLayers().find((entry) => entry.id === layer.id);
                return isProjectStationingCenterline(full);
            }),
            designLayers: getSpatialLayerOptions(ctx),
            initialSession: session,
            onCancel: () => {
                clearPreviewLayers(ctx);
                markWidgetClosed(WIDGET_ID);
                close();
            },
            onCreateProject: (input) => {
                session = createSheetCuttingSession(input);
                persistSession(session);
                return session;
            },
            onUpdateProject: (patch) => {
                session = updateSheetProject(session, patch);
                persistSession(session);
                return session;
            },
            onSelectRoute: (layerId) => {
                const layers = ctx.getLayers();
                session = selectRouteSource(session, layers, layerId);
                renderSheetPreview(ctx, session);
                persistSession(session);
                return session;
            },
            onConfigureTemplate: (patch) => {
                session = configureSheetTemplate(session, patch);
                persistSession(session);
                return session;
            },
            onSelectDesignLayers: (layerIds) => {
                session = selectDesignLayersForSheets(session, layerIds);
                const features = collectFeaturesFromLayers(ctx, layerIds);
                session = setSheetDesignFeatures(session, features);
                persistSession(session);
                return session;
            },
            onGenerateSheets: () => {
                session = generateSheetSet(session);
                renderSheetPreview(ctx, session);
                persistSession(session);
                return session;
            },
            onValidate: () => validateSheetSession(session),
            onExportPdf: async () => {
                const exportPackage = buildSessionExport(session);
                const result = await exportSheetPlanPdf({
                    mapService: ctx.mapService,
                    exportPackage,
                    session,
                    onProgress: (text) => ctx.showToast(text, 'info')
                });
                const count = result?.pageCount ?? 0;
                const folder = result?.folderName ? ` in “${result.folderName}”` : '';
                ctx.showToast(`Saved ${count} sheet PDF(s)${folder}.`, 'success');
                return result;
            },
            onExportPackage: () => {
                const exportPackage = buildSessionExport(session);
                const base = (session.project.projectName || 'sheet_cutting').replace(/\s+/g, '_');
                const layers = exportPackage.layers || {};

                if (layers.sheetFrames?.features?.length) {
                    downloadTextFile(
                        `${base}_sheet_frames.geojson`,
                        JSON.stringify(layers.sheetFrames, null, 2),
                        'application/geo+json'
                    );
                }
                if (layers.overview?.features?.length) {
                    downloadTextFile(
                        `${base}_overview.geojson`,
                        JSON.stringify(layers.overview, null, 2),
                        'application/geo+json'
                    );
                }
                for (const sheetLayer of layers.perSheet || []) {
                    if (!sheetLayer.contents?.features?.length) continue;
                    const sheetLabel = String(sheetLayer.sheetNumber).padStart(2, '0');
                    downloadTextFile(
                        `${base}_sheet_${sheetLabel}.geojson`,
                        JSON.stringify(sheetLayer.contents, null, 2),
                        'application/geo+json'
                    );
                }

                ctx.showToast('GIS sheet layers downloaded', 'success');
                return exportPackage;
            },
            onAddResultLayers: () => {
                const exportPackage = buildSessionExport(session);
                const layers = exportPackage.layers || {};
                const created = [];
                const baseName = session.project.projectName || 'Sheet_Cutting';

                const layerDefs = [
                    { name: `${baseName}_Sheet_Frames`, data: layers.sheetFrames },
                    { name: `${baseName}_Overview`, data: layers.overview }
                ];

                for (const sheetLayer of layers.perSheet || []) {
                    if (!sheetLayer.contents?.features?.length) continue;
                    layerDefs.push({
                        name: `${baseName}_Sheet_${String(sheetLayer.sheetNumber).padStart(2, '0')}`,
                        data: sheetLayer.contents
                    });
                }

                for (const def of layerDefs) {
                    if (!def.data?.features?.length) continue;
                    const dataset = ctx.createSpatialDataset(def.name, def.data, { format: 'derived' });
                    ctx.addLayer(dataset);
                    ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset));
                    created.push(dataset);
                }

                if (created.length) {
                    ctx.refreshUI();
                    ctx.showToast(`Added ${created.length} sheet layer(s)`, 'success');
                } else {
                    ctx.showToast('Generate sheets before adding layers', 'warning');
                }

                renderSheetPreview(ctx, session);
                return created;
            },
            onSaveSession: () => {
                persistSession(session);
                downloadTextFile(
                    `${session.project.projectName || 'sheet_cutting'}.json`,
                    JSON.stringify(serializeSheetSession(session), null, 2),
                    'application/json'
                );
            },
            onOpenFullPlanExport: () => {
                openPlanProductionExport(ctx);
            }
        })
    });
}
