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
import { applyImportLayerStyles } from '../../import/post-import.js';
import { markDatasetForUdotFiberStyle } from '../../symbology/udot-fiber/resolve-style.js';
import { isUdotFiberLiveDataset } from '../../symbology/udot-fiber/hover-fields.js';
import { removeLayer, updateLayer } from '../../core/state.js';
import {
    resolveUdotFiberLayerKey
} from './sheet-pdf-fiber.js';
import {
    buildSheetFiberOperationalSpec,
    clipFeaturesToSheetCoverage,
    envelopeFromFeatures,
    listSheetFiberSnapshotLayers,
    replaceLiveFiberIdsInDesignList
} from './fiber-operational.js';
import { queryFiberFeaturesByEnvelope } from './fiber-operational-fetch.js';
import { addInsetView, removeInsetView } from './inset-views.js';

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
            const full = ctx.getLayerById?.(option.id)
                || ctx.getLayers().find((entry) => entry.id === option.id);
            return {
                ...option,
                isUdotFiberLive: isUdotFiberLiveDataset(full)
            };
        })
    };
}

function getLayerFeatures(ctx, layerId) {
    const layer = ctx.getLayerById?.(layerId) || ctx.getLayers().find((entry) => entry.id === layerId);
    const fromDataset = layer?.geojson?.features;
    if (fromDataset?.length) return fromDataset;
    const fromMap = ctx.mapService?.getLayerRecord?.(layerId)?.geojson?.features;
    return fromMap?.length ? fromMap : [];
}

function collectFeaturesFromLayers(ctx, layerIds = []) {
    const features = [];
    for (const layerId of layerIds) {
        for (const feature of getLayerFeatures(ctx, layerId)) {
            if (!feature?.geometry) continue;
            features.push({
                ...feature,
                properties: {
                    ...(feature.properties || {}),
                    _sourceLayerId: layerId
                }
            });
        }
    }
    return features;
}

function applyDesignLayerSelection(ctx, session, layerIds = []) {
    const next = selectDesignLayersForSheets(session, layerIds);
    return setSheetDesignFeatures(next, collectFeaturesFromLayers(ctx, layerIds));
}

function viewportFiberFeatures(ctx, liveLayer) {
    const fromRecord = ctx.mapService?.getLayerRecord?.(liveLayer.id)?.geojson?.features;
    const fromLayer = liveLayer?.geojson?.features;
    return fromRecord?.length ? fromRecord : (fromLayer || []);
}

function hideLiveFiberLayer(ctx, layer) {
    if (!layer?.id) return;
    updateLayer(layer.id, { visible: false });
    ctx.mapService?.toggleLayer?.(layer.id, false);
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {object} session
 * @param {{ liveLayerIds?: string[] }} [options]
 */
async function addEditableFiberLayersFromSheets(ctx, session, options = {}) {
    const exportPackage = buildSessionExport(session);
    const frames = exportPackage.layers?.sheetFrames?.features || [];
    if (!frames.length) {
        throw new Error('Generate sheets before converting Fiber to an editable map layer.');
    }

    const requested = new Set((options.liveLayerIds || []).filter(Boolean));
    const liveLayers = (ctx.getLayers() || []).filter((layer) => {
        if (!isUdotFiberLiveDataset(layer)) return false;
        if (requested.size) return requested.has(layer.id);
        return layer.visible !== false;
    });
    if (!liveLayers.length) {
        throw new Error('Select a UDOT Fiber live layer in Add map layers, then convert it.');
    }

    const projectName = session.project?.projectName || 'Sheets';
    const removedSnapshotIds = [];
    for (const existing of listSheetFiberSnapshotLayers(ctx.getLayers(), projectName)) {
        removedSnapshotIds.push(existing.id);
        ctx.mapService.removeLayer(existing.id);
        removeLayer(existing.id);
    }

    const envelope = envelopeFromFeatures(frames);
    const created = [];
    const hiddenLiveIds = [];
    let truncated = false;

    for (const live of liveLayers) {
        const fiberKey = resolveUdotFiberLayerKey(live, ctx.mapService.getLayerStyle?.(live.id));
        if (!fiberKey) continue;

        let features = [];
        try {
            const fetched = await queryFiberFeaturesByEnvelope(
                live.service?.url || live.source?.url,
                envelope,
                fiberKey
            );
            features = fetched.features || [];
            truncated = truncated || !!fetched.truncated;
        } catch {
            features = viewportFiberFeatures(ctx, live);
        }

        const clipped = clipFeaturesToSheetCoverage(features, frames);
        if (!clipped.length) continue;

        const spec = buildSheetFiberOperationalSpec({
            projectName,
            liveLayer: live,
            fiberKey,
            features: clipped
        });
        const dataset = ctx.createSpatialDataset(spec.name, spec.geojson, spec.source);
        markDatasetForUdotFiberStyle(dataset, spec.source.url);
        dataset._udotFiberLayerKey = fiberKey;
        dataset._applyUdotFiberStyle = true;

        ctx.addLayer(dataset);
        const layerIdx = ctx.getLayers().indexOf(dataset);
        applyImportLayerStyles(dataset, {
            mapService: ctx.mapService,
            getLayers: ctx.getLayers,
            layerIndex: layerIdx
        });
        ctx.mapService.addLayer(dataset, layerIdx, { fit: false });
        hideLiveFiberLayer(ctx, live);
        hiddenLiveIds.push(live.id);
        created.push(dataset);
    }

    if (!created.length) {
        throw new Error('No UDOT Fiber features fall inside the sheet polygons.');
    }

    groupOutputLayers(`${projectName} Fiber (editable)`, created);
    ctx.refreshUI();
    return { created, truncated, hiddenLiveIds, removedSnapshotIds };
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {object} session
 * @param {string[]} [liveLayerIds]
 */
async function convertSelectedFiberToOperational(ctx, session, liveLayerIds) {
    const selectedLiveIds = (liveLayerIds || session.sheets?.designLayerIds || []).filter((id) => {
        const layer = ctx.getLayerById?.(id) || ctx.getLayers().find((entry) => entry.id === id);
        return isUdotFiberLiveDataset(layer);
    });
    const result = await addEditableFiberLayersFromSheets(ctx, session, {
        liveLayerIds: selectedLiveIds
    });
    const nextIds = replaceLiveFiberIdsInDesignList(
        session.sheets?.designLayerIds || [],
        [...result.hiddenLiveIds, ...result.removedSnapshotIds],
        result.created.map((dataset) => dataset.id)
    );
    return {
        session: applyDesignLayerSelection(ctx, session, nextIds),
        created: result.created,
        truncated: result.truncated,
        hiddenLiveIds: result.hiddenLiveIds
    };
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
            onSelectDesignLayers: (layerIds) => {
                session = applyDesignLayerSelection(ctx, session, layerIds);
                persistSession(session);
                return session;
            },
            onGenerateSheets: async ({ fiberMode, designLayerIds } = {}) => {
                session = generateSheetSet(session);
                renderSheetPreview(ctx, session);
                persistSession(session);
                if (fiberMode === 'convert') {
                    const hasLiveFiber = (designLayerIds || session.sheets?.designLayerIds || []).some((id) => {
                        const layer = ctx.getLayerById?.(id) || ctx.getLayers().find((entry) => entry.id === id);
                        return isUdotFiberLiveDataset(layer);
                    });
                    if (hasLiveFiber) {
                        try {
                            const converted = await convertSelectedFiberToOperational(
                                ctx,
                                session,
                                designLayerIds
                            );
                            session = converted.session;
                            persistSession(session);
                            renderSheetPreview(ctx, session);
                            const count = converted.created.length;
                            const extra = converted.truncated
                                ? ' Some dense areas were capped — zoomed-in live Fiber may show more.'
                                : '';
                            ctx.showToast(
                                `Converted ${count} Fiber layer${count === 1 ? '' : 's'} to editable map layers. Live Fiber is off. Sheet PDFs use the editable copy.${extra}`,
                                converted.truncated ? 'warning' : 'success'
                            );
                        } catch (err) {
                            ctx.showToast(
                                err?.message || 'Could not convert Fiber to an editable map layer.',
                                'warning'
                            );
                        }
                    }
                }
                return session;
            },
            onValidate: () => validateSheetSession(session),
            onExportPdf: async () => {
                session = applyDesignLayerSelection(
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
                    const skippedSheets = result?.skippedSheets?.length
                        ? ` Skipped sheet ${result.skippedSheets.join(', ')}.`
                        : '';
                    const skippedInsets = result?.skippedInsets?.length
                        ? ` Skipped detail ${result.skippedInsets.join(', ')}.`
                        : '';
                    const skipped = `${skippedSheets}${skippedInsets}`;
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
            onExportPackage: () => {
                session = applyDesignLayerSelection(
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
            onAddFiberOperationalLayers: async (layerIds) => {
                const converted = await convertSelectedFiberToOperational(ctx, session, layerIds);
                session = converted.session;
                persistSession(session);
                const count = converted.created.length;
                const extra = converted.truncated
                    ? ' Some dense areas were capped — zoomed-in live Fiber may show more.'
                    : '';
                ctx.showToast(
                    `Converted ${count} Fiber layer${count === 1 ? '' : 's'} to editable map layers. Live Fiber is off. Sheet PDFs use the editable copy.${extra}`,
                    converted.truncated ? 'warning' : 'success'
                );
                renderSheetPreview(ctx, session);
                return session;
            },
            onDrawInsetBox: async () => {
                const frames = buildSessionExport(session).layers?.sheetFrames?.features || [];
                if (!frames.length) {
                    throw new Error('Generate sheets before drawing a detail box.');
                }
                const bbox = await ctx.mapService.startRectangleDraw(
                    'Click and drag a detail box on a sheet polygon. Esc cancels.'
                );
                if (!bbox) return session;
                const turfLib = ctx.turf || (typeof turf !== 'undefined' ? turf : null);
                if (!turfLib?.bboxPolygon) {
                    throw new Error('Unable to build the detail box.');
                }
                session = addInsetView(session, turfLib.bboxPolygon(bbox), frames);
                persistSession(session);
                renderSheetPreview(ctx, session);
                const view = session.sheets.insetViews.at(-1);
                const sheetNo = String(view?.parentSheetNumber || 0).padStart(2, '0');
                ctx.showToast(`Added DETAIL ${view?.label || ''} on Sheet ${sheetNo}.`, 'success');
                return session;
            },
            onRemoveInsetView: (insetId) => {
                session = removeInsetView(session, insetId);
                persistSession(session);
                renderSheetPreview(ctx, session);
                return session;
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
