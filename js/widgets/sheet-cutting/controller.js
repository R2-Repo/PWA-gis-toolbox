/**
 * Sheet Cutting controller.
 */

import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { isProjectStationingCenterline } from '../project-stationing/route-profile.js';
import { markWidgetClosed, upsertWidgetState } from '../widget-state-store.js';
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

const PREVIEW_LAYER_PREFIX = 'sheet_cutting_preview_';

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
    for (const key of ['route', 'frames', 'overview']) {
        ctx.mapService.removeTempLayer?.(`${PREVIEW_LAYER_PREFIX}${key}`);
    }
}

function renderSheetPreview(ctx, session) {
    clearPreviewLayers(ctx);
    const exportPackage = buildSessionExport(session);

    if (session.routeLine?.geometry) {
        ctx.mapService.showTempFeature?.(exportPackage.geojson.route, 0, `${PREVIEW_LAYER_PREFIX}route`);
    }
    if (exportPackage.geojson.sheetFrames?.features?.length) {
        ctx.mapService.showTempFeature?.(exportPackage.geojson.sheetFrames, 0, `${PREVIEW_LAYER_PREFIX}frames`);
    }
    if (exportPackage.geojson.overview?.features?.length) {
        ctx.mapService.showTempFeature?.(exportPackage.geojson.overview, 0, `${PREVIEW_LAYER_PREFIX}overview`);
    }
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
        title: 'Sheet Cutting',
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
            onExportPackage: () => {
                const exportPackage = buildSessionExport(session);
                const base = session.project.projectName || 'sheet_cutting';
                downloadTextFile(`${base}_sheet_index.csv`, exportPackage.csv.sheetIndex, 'text/csv');
                downloadTextFile(`${base}_match_lines.csv`, exportPackage.csv.matchLines, 'text/csv');
                downloadTextFile(`${base}_sheets.json`, JSON.stringify(exportPackage, null, 2), 'application/json');
                ctx.showToast('Sheet export files downloaded', 'success');
                return exportPackage;
            },
            onAddResultLayers: () => {
                const exportPackage = buildSessionExport(session);
                const created = [];
                const baseName = session.project.projectName || 'Sheet_Cutting';

                const layerDefs = [
                    { name: `${baseName}_Sheet_Frames`, data: exportPackage.geojson.sheetFrames },
                    { name: `${baseName}_Overview`, data: exportPackage.geojson.overview }
                ];

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
            }
        })
    });
}
