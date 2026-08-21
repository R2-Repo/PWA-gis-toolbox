/**
 * Sheet Cutting controller.
 */

import bus from '../../core/event-bus.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { showProgressModal } from '../../ui/modals.js';
import { createLayerGroup, assignLayersToGroup } from '../../core/layer-groups.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { isProjectStationingCenterline } from '../project-stationing/route-profile.js';
import { markWidgetClosed, upsertWidgetState } from '../widget-state-store.js';
import { openRouteMilepostSegment } from '../route-milepost-segment/controller.js';
import { openProjectStationing } from '../project-stationing/controller.js';
import {
    WIDGET_ID,
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
import { buildCombinedSheetGeoJson } from './export-builder.js';
import { sanitizeExportFilename } from '../../export/folder-export.js';
import {
    collectSheetDesignFeatures,
    collectSheetDesignFeaturesSync,
    envelopeFromSheetSession
} from './design-features.js';
import { resolveUdotFiberLayerKey } from '../../symbology/udot-fiber/sheet-export.js';

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

function groupOutputLayers(groupName, datasets) {
    const layers = (datasets || []).filter(Boolean);
    if (layers.length < 2) return null;

    const group = createLayerGroup(
        groupName,
        layers.map((ds) => ds.id),
        { collapsed: true, source: 'manual' }
    );
    if (!group) return null;

    assignLayersToGroup(group.id, layers);
    return group;
}

function clearPreviewLayers(ctx) {
    clearSheetPreview(ctx.mapService);
}

function renderSheetPreview(ctx, session) {
    const exportPackage = buildSessionExport(session);
    showSheetPreview(ctx.mapService, exportPackage.layers || {});
}

function getRouteLayerOptions(ctx) {
    const byId = new Map();
    for (const layer of getSpatialLayerOptions(ctx, { requireLines: true })) {
        byId.set(layer.id, layer);
    }
    for (const layer of getSpatialLayerOptions(ctx)) {
        const full = ctx.getLayerById?.(layer.id) || ctx.getLayers().find((entry) => entry.id === layer.id);
        if (isProjectStationingCenterline(full)) {
            byId.set(layer.id, layer);
        }
    }
    return [...byId.values()];
}

function getLayerLists(ctx) {
    return {
        routeLayers: getRouteLayerOptions(ctx),
        designLayers: getSpatialLayerOptions(ctx).map((option) => {
            const layer = ctx.getLayerById?.(option.id)
                || ctx.getLayers().find((entry) => entry.id === option.id);
            const layerStyle = ctx.mapService?.getLayerStyle?.(option.id) || null;
            return {
                ...option,
                isUdotFiber: Boolean(resolveUdotFiberLayerKey(layer, layerStyle))
            };
        })
    };
}

async function applyDesignLayerSelection(ctx, session, layerIds = []) {
    const next = selectDesignLayersForSheets(session, layerIds);
    const envelope = envelopeFromSheetSession(next);
    const features = envelope
        ? await collectSheetDesignFeatures(ctx, layerIds, { envelope })
        : collectSheetDesignFeaturesSync(ctx, layerIds);
    return setSheetDesignFeatures(next, features);
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
        getProps: (close) => {
            const lists = getLayerLists(ctx);
            return {
                defaultTemplate: DEFAULT_SHEET_TEMPLATE,
                stationingLayers: lists.routeLayers,
                designLayers: lists.designLayers,
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
            onSelectDesignLayers: async (layerIds) => {
                session = await applyDesignLayerSelection(ctx, session, layerIds);
                persistSession(session);
                return session;
            },
            onGenerateSheets: async () => {
                session = generateSheetSet(session);
                session = await applyDesignLayerSelection(
                    ctx,
                    session,
                    session.sheets?.designLayerIds || []
                );
                session = generateSheetSet(session);
                renderSheetPreview(ctx, session);
                persistSession(session);
                return session;
            },
            onValidate: () => validateSheetSession(session),
            onExportPdf: async () => {
                session = await applyDesignLayerSelection(
                    ctx,
                    session,
                    session.sheets?.designLayerIds || []
                );
                persistSession(session);
                const exportPackage = buildSessionExport(session);
                const abortController = new AbortController();
                const progress = showProgressModal('Exporting Sheet PDFs');
                progress.onCancel(() => abortController.abort());
                try {
                    const result = await exportSheetPlanPdf({
                        mapService: ctx.mapService,
                        exportPackage,
                        session,
                        signal: abortController.signal,
                        onProgress: (data) => {
                            const payload = typeof data === 'string'
                                ? { percent: 0, step: data }
                                : data;
                            progress.update(
                                payload.percent ?? 0,
                                payload.step || 'Working…',
                                {
                                    fileIndex: payload.fileIndex,
                                    fileCount: payload.fileCount,
                                    fileName: payload.fileName,
                                    batchLabelUnit: payload.batchLabelUnit
                                }
                            );
                        },
                        onWarning: (text) => ctx.showToast(text, 'warning')
                    });
                    const count = result?.pageCount ?? 0;
                    const folder = result?.folderName ? ` in “${result.folderName}”` : '';
                    const skipped = result?.skippedSheets?.length
                        ? ` Skipped sheet ${result.skippedSheets.join(', ')}.`
                        : '';
                    ctx.showToast(`Saved ${count} sheet PDF(s)${folder}.${skipped}`, skipped ? 'warning' : 'success');
                    return result;
                } catch (err) {
                    if (err?.name === 'AbortError') {
                        ctx.showToast('Sheet PDF export cancelled.', 'warning');
                        return null;
                    }
                    ctx.showToast(err?.message || 'Sheet PDF export failed.', 'error');
                    throw err;
                } finally {
                    progress.close();
                }
            },
            onExportPackage: async () => {
                session = await applyDesignLayerSelection(
                    ctx,
                    session,
                    session.sheets?.designLayerIds || []
                );
                persistSession(session);
                const exportPackage = buildSessionExport(session);
                const base = sanitizeExportFilename(session.project.projectName || 'sheet_cutting');
                const combined = buildCombinedSheetGeoJson(exportPackage);

                if (!combined.features.length) {
                    ctx.showToast('Generate sheets before downloading layers', 'warning');
                    return exportPackage;
                }

                downloadTextFile(
                    `${base}_sheets.geojson`,
                    JSON.stringify(combined, null, 2),
                    'application/geo+json'
                );

                ctx.showToast('Downloaded combined sheet GeoJSON', 'success');
                return exportPackage;
            },
            onAddResultLayers: () => {
                const exportPackage = buildSessionExport(session);
                const layers = exportPackage.layers || {};
                const created = [];
                const baseName = session.project.projectName || 'Sheet_Cutting';
                const overviewWithoutRoute = {
                    type: 'FeatureCollection',
                    features: (layers.overview?.features || []).filter(
                        (feature) => feature.properties?.feature_type !== 'overview_route'
                    )
                };

                const layerDefs = [
                    { name: `${baseName}_Sheet_Frames`, data: layers.sheetFrames },
                    { name: `${baseName}_Overview`, data: overviewWithoutRoute }
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
                    const groupName = `${baseName} Sheets`;
                    groupOutputLayers(groupName, created);
                    ctx.refreshUI();
                    ctx.showToast(`Added ${created.length} sheet layer(s) under ${groupName}`, 'success');
                } else {
                    ctx.showToast('Generate sheets before adding layers', 'warning');
                }

                renderSheetPreview(ctx, session);
                return created;
            },
            onOpenRouteCenterline: () => {
                openRouteMilepostSegment(ctx);
            },
            onOpenProjectStationing: () => {
                openProjectStationing(ctx);
            },
            onRefreshLayers: () => getLayerLists(ctx),
            onSubscribeLayerRefresh: (onLayerListRefresh) => {
                bus.on('layers:changed', onLayerListRefresh);
                onLayerListRefresh?.();
                return () => bus.off('layers:changed', onLayerListRefresh);
            }
            };
        }
    });
}
