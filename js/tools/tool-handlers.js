/**
 * GIS Toolbox — tool handlers, app wiring, and action dispatch.
 * UI shell lives in react/App.jsx; this module owns domain-side handlers.
 */
import logger from '../core/logger.js';
import bus from '../core/event-bus.js';
import { handleError } from '../core/error-handler.js';
import {
    getState, getLayers, getActiveLayer, addLayer, removeLayer, updateLayer,
    setActiveLayer, toggleLayerVisibility, toggleLayerLock, getMapLayerOrderIds,
    reorderLayer, reorderLayerToIndex, setUIState, toggleAGOLCompat
} from '../core/state.js';
import { mergeDatasets, getSelectedFields, tableToSpatial, createSpatialDataset, createTableDataset, analyzeSchema, analyzeTableSchema, isSpatialLayer, isServiceLayer, isWorkspaceLayer, isAnalyzableLayer, isLiveVectorLayer } from '../core/data-model.js';
import { isLayerDisplayReady, layerCrsWarning, getLayerCrs, resolveReprojectFromCrs } from '../crs/layer-crs.js';
import { importFile, importFiles } from '../import/importer.js';
import { cancelWorkerParse } from '../import/import-parse-service.js';
import { convertSpatialDatasetToWorkspace } from '../import/workspace-import.js';
import {
    materializeForOperation,
    getWorkingFeaturesFromLayer,
    getWorkingDatasetFromLayer
} from './gis-layer-context.js';
import { removeWorkspaceLayer, detachFieldsForExport } from '../workspace/workspace-store.js';
import { removeSourceFileIfUnreferenced } from '../workspace/source-file-store.js';
import { commitWorkspaceFeatureEdit } from '../workspace/edit-session.js';
import {
    finalizeImportedDatasets,
    applyImportLayerStyles,
    applyImportMetadata,
    revokeKmzBlobUrls,
    normalizeImporterResult
} from '../import/post-import.js';
import { getLayerDefaultColor } from '../map/layer-palette.js';
import { getActiveTask, TaskRunner } from '../core/task-runner.js';
import { buildImportSummary, formatImportSummaryToast } from '../import/import-summary.js';
import { guardFilesBeforeImport } from '../import/import-guard.js';
import { assessImportRoute, shouldConvertToWorkspace, arcgisShouldUseWorkspace } from '../import/import-routing.js';
import { ErrorCategory } from '../core/error-handler.js';
import { getAvailableFormats, exportDataset, exportMultiLayerKMZFile, exportMultiLayerKMLFile, setExportMapManager } from '../export/exporter.js';
import { isCoverageRasterLayer } from '../core/coverage-raster-layer.js';
import {
    getContextMenuGisTools,
    isLayerFeatureDeletable
} from './context-menu-gis-tools.js';
import {
    createQuickDrawLayer,
    findQuickDrawLayer,
    clearQuickDrawLayerFlag
} from './quick-draw.js';
import mapService, { formatElevationLabel } from '../map/map-service.js';
import { resolveLayerDisplayMode } from '../map/layer-display-mode.js';
import { syncBasemapToggleActive } from '../map/basemap-catalog.js';
import { isSmartStyleActive } from '../map/style-engine.js';
import dualScreenCoordinator from '../dual-screen/coordinator.js';
import { isPresentationMode } from '../presentation/presentation-mode-detector.js';
import { installDualScreenPrimaryHandlers } from '../dual-screen/primary-handlers.js';
import {
    POPUP_BLOCKED_MESSAGE,
    RELOAD_REMINDER_MESSAGE,
    consumeDualScreenReloadReminder
} from '../dual-screen/storage-hint.js';

import { showToast, showErrorToast } from '../ui/toast.js';
import { showModal, confirm, confirmArcgisLargeImport, showProgressModal } from '../ui/modals.js';
import { openToolDialog } from '../ui/open-tool-dialog.js';
import * as transforms from '../dataprep/transforms.js';
import { applyTemplate } from '../dataprep/template-builder.js';
import { saveSnapshot, undo as undoHistory, redo as redoHistory, getHistoryState } from '../dataprep/transform-history.js';
import { photoMapper } from '../photo/photo-mapper.js';
import { arcgisImporter, ARCGIS_MAX_FEATURES, arcgisNeedsLargeDownloadConfirm } from '../arcgis/rest-importer.js';
import { mergeArcgisStyleFields, requiredStyleFieldsFromDrawingInfo } from '../arcgis/drawing-info.js';
import { arcgisOutFieldsParam } from '../import/import-field-filter.js';
import {
    markDatasetForUdotFiberStyle,
    mergeUdotFiberStyleFields,
    requiredStyleFieldsForUdotFiberLayer
} from '../symbology/udot-fiber/resolve-style.js';
import { matchUdotFiberLayerUrl } from '../symbology/udot-fiber/constants.js';
import ARCGIS_ENDPOINTS from '../arcgis/endpoints.js';
import { checkAGOLCompatibility, applyAGOLFixes } from '../agol/compatibility.js';
import * as gisTools from './gis-tools.js';
import { convertFeatureCoords } from './coordinates.js';
import { guessCoordinateFields } from '../import/coord-detect.js';
import { findFirstLineStringFeature, listLineStringFeatures } from './line-geojson.js';

import drawManager from '../map/draw-manager.js';
import { initSelectionShortcuts } from '../map/selection-shortcuts.js';
import { buildSelectionActionItems, createSelectionActionHandlers, attributeFieldsFromSelection } from './selection-actions.js';
import sessionStore from '../core/session-store.js';
import { buildDatasetFromSavedLayer, buildDatasetFromWorkspaceRef, prepareLayersFromKitSection } from '../core/layer-restore.js';
import {
    buildProjectKitSnapshot,
    packProjectKit,
    parseProjectKit,
    downloadProjectKit,
    summarizeProjectKit,
    isProjectKitFile,
    PROJECT_KIT_SECTIONS
} from '../core/project-kit.js';
import { loadJSZip } from '../core/libs.js';
import { loadPaletteFavorites, savePaletteFavorites } from '../map/palette-store.js';
import {
    getWorkspaceLayer,
    exportWorkspaceLayerBundle,
    writeWorkspaceLayerToKitZip
} from '../workspace/workspace-store.js';
import { getSourceFile } from '../workspace/source-file-store.js';
import { WorkflowStore } from '../workflow/workflow-store.js';
import { buildWidgetActions } from '../widgets/registry.js';
import { shouldSkipSessionRestore } from '../url/app-url-detector.js';
import { bootstrapAppUrl } from '../url/app-url-bootstrap.js';
import { openPresentationLinkBuilder } from '../widgets/presentation-link-builder/controller.js';
import {
    loadWidgetStore,
    remapWidgetLayerIds,
    serializeWidgetStore,
    getWidgetsToRestore,
    restoreOpenWidget
} from '../widgets/widget-state-store.js';
import { createWidgetContext } from '../widgets/widget-context.js';
import { getPlatformBundle } from '../platform/create-platform.js';
import { openImportStationTable } from '../widgets/project-stationing/controller.js';
import { isProjectStationingCenterline } from '../widgets/project-stationing/route-profile.js';
import { getPlanSetCalloutMenuItems } from '../widgets/plan-set-callouts/context-menu-bridge.js';
import { createWorkflowController } from '../workflow/workflow-controller.js';
import {
    getLayerGroups,
    setLayerGroups,
    createImportGroupForDatasets,
    toggleGroupCollapsed,
    renameLayerGroup,
    dissolveLayerGroup,
    onLayerRemoved,
    reconcileGroupsAfterReorder,
    moveGroupBlockToIndex,
    expandLayerIdsForRemoval,
    createManualGroupFromLayerIds,
    getGroupChildLayers,
    isGroupFullyVisible,
    clearAllLayerGroups
} from '../core/layer-groups.js';

// ============================
// Initialize app
// ============================
let _importInputEl = null;
let _appWiringInstalled = false;
let _workflowOverlay = null;
export function getWorkflowOverlay() { return _workflowOverlay; }

// ============================
// Session Restore
// ============================
export async function restoreSessionIfAvailable() {
    try {
        if (shouldSkipSessionRestore()) {
            logger.info('Session', 'Skipped restore — app URL config present');
            return;
        }
        const info = await sessionStore.hasSession();
        if (!info) return;

        const ago = _timeAgo(info.timestamp);
        const ok = await confirm(
            'Restore Previous Session?',
            `You have ${info.layerCount} layer${info.layerCount > 1 ? 's' : ''} saved from ${ago}. Would you like to restore them?`,
            { layer: 'deferred' }
        );

        if (ok) {
            const session = await sessionStore.loadSession();
            if (!session) { showToast('Could not read saved session.', 'warning'); return; }

            if (session.layerStyles) {
                mapService.setLayerStylesRecord(session.layerStyles);
            }

            if (Array.isArray(session.layerGroups) && session.layerGroups.length) {
                setLayerGroups(session.layerGroups);
            }

            let restored = 0;
            for (const saved of session.layers) {
                try {
                    let dataset = null;
                    if (saved.type === 'spatial-chunked' || saved.storage === 'workspace') {
                        const wsId = saved.workspaceLayerId || saved.id;
                        const wsMeta = await getWorkspaceLayer(wsId);
                        if (!wsMeta) {
                            logger.warn('Session', `Workspace layer "${saved.name}" not found in storage`);
                            continue;
                        }
                        dataset = buildDatasetFromWorkspaceRef({
                            ...saved,
                            schema: saved.schema || wsMeta.schema,
                            datasetProfile: saved.datasetProfile || wsMeta.datasetProfile || null,
                            source: saved.source || wsMeta.source
                        });
                    } else if (saved.type === 'service') {
                        dataset = await buildDatasetFromSavedLayer(saved, {});
                    } else {
                        dataset = await buildDatasetFromSavedLayer(saved, {
                            spatial: saved.geojson,
                            tableRows: saved.rows
                        });
                    }
                    if (!dataset) continue;

                    addLayer(dataset);
                    const layerIdx = getLayers().indexOf(dataset);
                    applyImportLayerStyles(dataset, { mapService, getLayers, layerIndex: layerIdx });

                    if (isWorkspaceLayer(dataset)) {
                        await mapService.addWorkspaceLayer(dataset, layerIdx, { fit: false });
                    } else if (dataset.type === 'spatial') {
                        mapService.addLayer(dataset, layerIdx, { fit: false });
                    } else if (dataset.type === 'service') {
                        await mapService.addServiceLayer(dataset, layerIdx, { fit: false });
                    }
                    restored++;
                } catch (err) {
                    logger.warn('Session', `Failed to restore layer "${saved.name}"`, { error: err.message });
                }
            }

            // Set active layer from saved meta
            if (session.meta?.activeLayerId) {
                setActiveLayer(session.meta.activeLayerId);
            }

            // Fit map to all restored spatial layers unless the user already zoomed.
            if (restored > 0) {
                mapService.syncLayerOrder(getMapLayerOrderIds());
                if (mapService.userHasMovedCamera?.()) {
                    logger.info('Session', 'Skipped fit-to-all — user already moved the map');
                } else {
                    mapService.fitToAll();
                }
            }

            showToast(`Restored ${restored} layer${restored !== 1 ? 's' : ''} from previous session`, 'success');
            logger.info('Session', `Restored ${restored} layers`);
        } else {
            await sessionStore.clearSession();
            logger.info('Session', 'User discarded saved session');
        }
    } catch (err) {
        logger.error('Session', 'Restore failed', { error: err.message });
    }
}

function _timeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

// ============================
// Toolbox Kit — project export/import
// ============================

function _getMapChromeSnapshot() {
    const map = mapService.getMap();
    let viewport = null;
    if (map) {
        const center = map.getCenter();
        viewport = {
            center: [center.lng, center.lat],
            zoom: map.getZoom(),
            bearing: map.getBearing?.() ?? 0,
            pitch: map.getPitch?.() ?? 0
        };
    }
    return {
        basemap: mapService.getCurrentBasemap(),
        is3d: mapService.is3DEnabled(),
        viewport
    };
}

function _collectWorkflowNodeCache(engine) {
    const cache = {};
    if (!engine?.nodes) return cache;
    for (const node of engine.nodes.values()) {
        if (node._cachedResult) cache[node.id] = node._cachedResult;
    }
    return cache;
}

async function _clearLayersForKitReplace() {
    const ids = [...getLayers().map((layer) => layer.id)];
    const opfsKeys = new Set();
    for (const id of ids) {
        const layer = getLayers().find((entry) => entry.id === id);
        if (layer) revokeKmzBlobUrls(layer);
        if (layer?.source?.opfsKey) opfsKeys.add(layer.source.opfsKey);
        if (isWorkspaceLayer(layer)) {
            await removeWorkspaceLayer(layer.workspaceLayerId || id);
        }
        mapService.removeLayer(id);
        removeLayer(id);
    }
    for (const key of opfsKeys) {
        await removeSourceFileIfUnreferenced(key, getLayers());
    }
    clearAllLayerGroups();
}

function _mergePaletteFavorites(existing, incoming, mode) {
    if (mode !== 'merge') return incoming;
    const byId = new Map(existing.map((entry) => [entry.id, entry]));
    for (const entry of incoming) {
        if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
    return [...byId.values()];
}

async function _addRestoredDatasets(datasets, styles, activeLayerId, { replaceStyles = false } = {}) {
    if (replaceStyles) {
        mapService.setLayerStylesRecord(styles || {});
    } else if (styles && Object.keys(styles).length) {
        mapService.setLayerStylesRecord({
            ...mapService.getLayerStylesRecord(),
            ...styles
        });
    }

    for (const dataset of datasets) {
        addLayer(dataset, { activate: false });
        const layerIdx = getLayers().indexOf(dataset);
        applyImportLayerStyles(dataset, { mapService, getLayers, layerIndex: layerIdx });
        if (isWorkspaceLayer(dataset)) {
            await mapService.addWorkspaceLayer(dataset, layerIdx, { fit: false });
        } else if (dataset.type === 'spatial') {
            mapService.addLayer(dataset, layerIdx, { fit: false });
        }
    }

    if (activeLayerId) {
        setActiveLayer(activeLayerId);
    }
}

async function applyProjectKitSnapshot(snapshot, { sections, mode = 'replace' }) {
    const selected = PROJECT_KIT_SECTIONS.filter((key) => sections.includes(key));
    sessionStore.pauseSessionSave();
    let layerIdMap = null;
    try {
        if (selected.includes('layers') && snapshot.layers) {
            if (mode === 'replace') {
                await _clearLayersForKitReplace();
            }
            const { datasets, styles, activeLayerId, idMap } = await prepareLayersFromKitSection({
                layersSection: snapshot.layers,
                mode,
                existingLayerIds: new Set(getLayers().map((layer) => layer.id)),
                kitZip: snapshot._zip || null
            });
            layerIdMap = idMap;
            await _addRestoredDatasets(datasets, styles, activeLayerId, {
                replaceStyles: mode === 'replace'
            });

            const kitGroups = snapshot.layers.layerGroups || [];
            if (kitGroups.length) {
                const remapped = layerIdMap?.size
                    ? kitGroups.map((group) => ({
                        ...group,
                        childLayerIds: group.childLayerIds.map((id) => layerIdMap.get(id) || id)
                    }))
                    : kitGroups;
                setLayerGroups(remapped.filter((group) => group.childLayerIds.length >= 2));
            }
        }

        if (selected.includes('widgets') && snapshot.widgets) {
            loadWidgetStore(snapshot.widgets);
            if (layerIdMap?.size) {
                remapWidgetLayerIds(layerIdMap);
            }
        }

        if (selected.includes('map') && snapshot.map) {
            if (snapshot.map.basemap) applyBasemapHeaderSelection(snapshot.map.basemap);
            mapService.set3DEnabled(!!snapshot.map.is3d);
            setDimensionToggleActive(snapshot.map.is3d ? '3d' : '2d');
            const vp = snapshot.map.viewport;
            if (vp && mapService.getMap()) {
                mapService.reconcile3DState({
                    camera: {
                        center: vp.center,
                        zoom: vp.zoom,
                        bearing: vp.bearing ?? 0,
                        pitch: snapshot.map.is3d ? (vp.pitch ?? 30) : 0
                    }
                });
            } else if (snapshot.map.is3d) {
                mapService.enable3D();
            } else {
                mapService.disable3D();
            }
        }

        if (selected.includes('workflow')) {
            const wf = getWorkflowOverlay();
            if (wf?.clearPipeline || wf?.applyConfig) {
                const config = snapshot.workflow?.pipeline;
                const inner = config?.pipeline ?? config;
                const nodeCount = inner?.nodes?.length ?? 0;
                if (nodeCount > 0 && wf.applyConfig) {
                    wf.applyConfig(config);
                    const cache = config?.nodeCache || {};
                    for (const [nodeId, data] of Object.entries(cache)) {
                        const node = wf.engine?.nodes?.get(nodeId);
                        if (node) node._cachedResult = data;
                    }
                    WorkflowStore.save(wf.engine);
                } else {
                    wf.clearPipeline?.();
                }
            }
        }

        if (selected.includes('preferences') && snapshot.preferences?.paletteFavorites) {
            savePaletteFavorites(_mergePaletteFavorites(
                loadPaletteFavorites(),
                snapshot.preferences.paletteFavorites,
                mode
            ));
        }

        refreshUI();
        if (selected.includes('layers') && !mapService.userHasMovedCamera?.()) {
            mapService.fitToAll();
        }

        if (selected.includes('widgets')) {
            const widgetsToRestore = getWidgetsToRestore();
            for (const entry of widgetsToRestore) {
                await restoreOpenWidget(entry.type, getWidgetContext());
            }
            const { hydratePlanSetCallouts } = await import('../widgets/plan-set-callouts/controller.js');
            hydratePlanSetCallouts(getWidgetContext());
        }
    } finally {
        sessionStore.resumeSessionSave(true);
    }
}

export async function exportProjectKit(options = {}) {
    const { pickExportProjectKitModal } = await import('../../react/tools/mountProjectKitDialog.jsx');
    const dialogResult = await pickExportProjectKitModal({
        defaultName: options.defaultName || 'toolbox-project',
        layerCount: getLayers().length
    });
    if (!dialogResult) return;

    await runWithTaskProgress('Export Toolbox Kit', async () => {
        const { TaskRunner } = await import('../core/task-runner.js');
        const task = new TaskRunner('Export Toolbox Kit', 'ProjectKit');
        await task.run(async (t) => {
            const JSZip = await loadJSZip();
            const wf = getWorkflowOverlay();
            const snapshot = await buildProjectKitSnapshot({
                sections: dialogResult.sections,
                projectName: dialogResult.projectName,
                layers: getLayers(),
                activeLayerId: getState().activeLayerId,
                layerStyles: mapService.getLayerStylesRecord(),
                layerGroups: getLayerGroups(),
                map: _getMapChromeSnapshot(),
                workflow: wf?.engine ? {
                    pipeline: wf.engine.toJSON(),
                    nodeCache: _collectWorkflowNodeCache(wf.engine)
                } : null,
                preferences: { paletteFavorites: loadPaletteFavorites() },
                widgets: serializeWidgetStore(),
                exportWorkspaceLayerBundle,
                deferLargeWorkspace: true
            });
            const blob = await packProjectKit(snapshot, JSZip, t, {
                writeWorkspaceLayer: (zip, folderKey, workspaceLayerId, helpers) =>
                    writeWorkspaceLayerToKitZip(zip, folderKey, workspaceLayerId, helpers),
                getSourceFile
            });
            downloadProjectKit(blob, dialogResult.projectName || 'toolbox-project');
            const deferredCount = Object.keys(snapshot.layers?.workspaceDeferred || {}).length;
            const sourceCount = snapshot.manifest?.sourceKeys?.length || 0;
            showToast(
                deferredCount || sourceCount
                    ? `Toolbox Export saved${deferredCount ? ` (${deferredCount} streamed workspace layer${deferredCount === 1 ? '' : 's'})` : ''}${sourceCount ? ` + ${sourceCount} source file${sourceCount === 1 ? '' : 's'}` : ''}.`
                    : 'Toolbox Export saved.',
                'success'
            );
        });
    });
}

export async function exportMapView(format) {
    try {
        const mod = await import('../map/map-export.js');
        if (mod.willUseHighResExport(mapService)) {
            showToast('Exporting high-resolution map…', 'info');
        }
        const result = await mod.exportMapView(mapService, format, {
            blockWhenDualScreen: true,
            dualScreenCoordinator
        });
        showToast(`${format.toUpperCase()} saved.`, 'success');
        return result;
    } catch (err) {
        showToast(err.message || 'Map export failed.', 'error');
        throw err;
    }
}

export async function importProjectKit(initialFile) {
    if (!initialFile) return;

    let snapshot;
    try {
        const JSZip = await loadJSZip();
        snapshot = await parseProjectKit(initialFile, JSZip);
    } catch (err) {
        showToast(err.message || 'Invalid Toolbox Kit file.', 'error');
        return;
    }

    const summary = summarizeProjectKit(snapshot);
    const { pickImportProjectKitModal } = await import('../../react/tools/mountProjectKitDialog.jsx');
    const dialogResult = await pickImportProjectKitModal({ summary, availableSections: summary.sections });
    if (!dialogResult) return;

    if (dialogResult.mode === 'replace') {
        const ok = await confirm(
            'Replace current workspace?',
            'Importing will replace the selected sections of your current workspace. Continue?',
            { layer: 'deferred' }
        );
        if (!ok) return;
    }

    await runWithTaskProgress('Import Toolbox Kit', async () => {
        const { TaskRunner } = await import('../core/task-runner.js');
        const task = new TaskRunner('Import Toolbox Kit', 'ProjectKit');
        await task.run(async () => {
            await applyProjectKitSnapshot(snapshot, {
                sections: dialogResult.sections,
                mode: dialogResult.mode
            });
            const parts = [];
            if (dialogResult.sections.includes('layers')) parts.push(`${summary.layerCount} layer${summary.layerCount !== 1 ? 's' : ''}`);
            if (dialogResult.sections.includes('workflow') && summary.hasWorkflow) parts.push('pipeline');
            if (dialogResult.sections.includes('map') && summary.hasMap) parts.push('map settings');
            if (dialogResult.sections.includes('preferences') && summary.hasPreferences) parts.push('preferences');
            if (dialogResult.sections.includes('widgets') && summary.hasWidgets) parts.push('widget state');
            showToast(`Toolbox project restored${parts.length ? ` (${parts.join(', ')})` : ''}.`, 'success');
            logger.info('ProjectKit', 'Import complete', { mode: dialogResult.mode, sections: dialogResult.sections });
        });
    });
}

export function buildMapContextMenuItems(payload) {
    const { latlng, layerId, featureIndex, feature } = payload;
    const layers = getLayers();
    const layer = layerId ? layers.find((l) => l.id === layerId) : null;
    const layerIdx = layer ? layers.indexOf(layer) : -1;
    const items = [];

    const calloutItems = getPlanSetCalloutMenuItems(payload);
    if (calloutItems.length) {
        items.push(...calloutItems);
        items.push({ sep: true });
    }

    if (feature && layer) {
        items.push({
            icon: '👁',
            label: 'View attributes',
            action: () => {
                const nearby = mapService.findFeaturesNearClick(latlng, layerId, featureIndex);
                const popupOptions = { forceFull: true };
                if (nearby.length > 0) mapService.showMultiPopup(nearby, latlng, popupOptions);
                else mapService.showPopup(feature, null, latlng, popupOptions);
            }
        });
        items.push({
            icon: '✏',
            label: 'Edit feature',
            action: () => openFeatureEditor(layerId, featureIndex)
        });
        if (isProjectStationingCenterline(layer)) {
            items.push({
                icon: '📍',
                label: 'Import Station Table',
                action: () => openImportStationTable(getWidgetContext(), layer)
            });
        }

        const gisTools = getContextMenuGisTools(layer, feature);
        if (gisTools.length > 0) {
            items.push({
                icon: '🛠',
                label: 'Tools',
                children: gisTools.map((tool) => ({
                    label: tool.label,
                    action: () => invokeAppAction(tool.action)
                }))
            });
        }

        if (isLayerFeatureDeletable(layer)) {
            items.push({
                icon: '🗑',
                label: 'Delete feature',
                action: () => deleteFeatureAt(layerId, featureIndex)
            });
        }
    }

    if (!isPresentationMode()) {
        items.push({
            icon: '✏️',
            label: 'Quick Draw',
            action: () => startQuickDraw()
        });
        items.push({
            icon: '📐',
            label: 'Measure from here',
            action: () => mapService.startMeasureFrom(latlng)
        });
    }

    items.push({
        icon: '📋',
        label: 'Copy coordinates',
        action: () => {
            const text = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
            navigator.clipboard.writeText(text).catch(() => showToast(text, 'info'));
        }
    });

    items.push({
        icon: '🛤️',
        label: 'Get route & milepost',
        title: 'UDOT state routes and interstates only — not city streets.',
        action: () => {
            void lookupRouteAndMilepostAt(latlng);
        }
    });

    if (mapService.is3DEnabled()) {
        items.push({
            icon: '⛰️',
            label: 'Get elevation',
            action: () => {
                const meters = mapService.queryElevationAt(latlng.lat, latlng.lng);
                if (meters == null) {
                    showToast('Elevation unavailable — terrain tiles may still be loading', 'warning');
                    return;
                }
                const text = formatElevationLabel(meters);
                const message = `Elevation: ${text}`;
                navigator.clipboard.writeText(text)
                    .then(() => showToast(message, 'success'))
                    .catch(() => showToast(message, 'info'));
            }
        });
    }

    if (mapService.isOrbiting()) {
        items.push({
            icon: '⏹',
            label: 'Stop camera orbit',
            action: () => {
                mapService.stopCameraOrbit();
            }
        });
    } else {
        items.push({
            icon: '🔄',
            label: 'Orbit camera around point',
            action: () => {
                mapService.startCameraOrbit({ lat: latlng.lat, lng: latlng.lng });
            }
        });
    }

    items.push({
        icon: '🚶',
        label: 'Open location in Google Street View',
        action: () => {
            const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latlng.lat},${latlng.lng}`;
            window.open(url, '_blank', 'noopener');
        }
    });

    items.push({
        icon: '🌍',
        label: 'Open location in Google Earth',
        action: () => {
            const url = `https://earth.google.com/web/@${latlng.lat},${latlng.lng},1200a,900d,60y,0h,35t,0r`;
            window.open(url, '_blank', 'noopener');
        }
    });

    if (layer) {
        items.push({ sep: true });
        if (layerIdx > 0) {
            items.push({ icon: '⬆', label: 'Move layer up', action: () => moveLayerUp(layerId) });
        }
        if (layerIdx >= 0 && layerIdx < layers.length - 1) {
            items.push({ icon: '⬇', label: 'Move layer down', action: () => moveLayerDown(layerId) });
        }
        if (layers.length > 1 && layerIdx !== 0) {
            items.push({
                icon: '⏫',
                label: 'Bring to front',
                action: () => {
                    while (layers.indexOf(layers.find((l) => l.id === layerId)) > 0) {
                        reorderLayer(layerId, 'up');
                    }
                    mapService.syncLayerOrder(getMapLayerOrderIds());
                    refreshUI();
                }
            });
        }
        if (layers.length > 1 && layerIdx !== layers.length - 1) {
            items.push({
                icon: '⏬',
                label: 'Send to back',
                action: () => {
                    while (layers.indexOf(layers.find((l) => l.id === layerId)) < layers.length - 1) {
                        reorderLayer(layerId, 'down');
                    }
                    mapService.syncLayerOrder(getMapLayerOrderIds());
                    refreshUI();
                }
            });
        }
        items.push({ sep: true });
        items.push({
            icon: layer.visible !== false ? '👁️‍🗨️' : '👁️',
            label: layer.visible !== false ? 'Hide layer' : 'Show layer',
            action: () => {
                toggleLayerVisibility(layerId);
                mapService.toggleLayer(layerId, layers.find((l) => l.id === layerId)?.visible);
                refreshUI();
            }
        });
        items.push({
            icon: '🔍',
            label: 'Zoom to layer',
            action: () => {
                const ll = mapService.getLayerRecord(layerId);
                if (ll?.geojson) {
                    try {
                        const bb = turf.bbox(ll.geojson);
                        mapService.getMap()?.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 30 });
                    } catch (_) { /* ignore */ }
                }
            }
        });
        items.push({
            icon: '★',
            label: 'Set as active layer',
            action: () => {
                setActiveLayer(layerId);
                refreshUI();
            }
        });
    }

    return { items, layerName: layer?.name || null };
}

export function getRightPanelSnapshot() {
    const layer = getActiveLayer();
    const map = mapService.getMap();
    const mapZoom = map?.getZoom?.() ?? 7;
    const mapLatitude = map?.getCenter?.()?.lat ?? 0;

    if (!layer) {
        return {
            layer: null,
            selectedFields: [],
            formats: [],
            agolMode: !!getState().agolCompatMode,
            agolCheck: null,
            layerStyle: null,
            styleDefaultColor: '#2563eb',
            mapZoom,
            mapLatitude
        };
    }

    const agolMode = !!getState().agolCompatMode;
    const layerIndex = getLayers().indexOf(layer);
    const isService = isServiceLayer(layer);
    return {
        layer,
        selectedFields: layer.schema ? getSelectedFields(layer.schema) : [],
        formats: isService ? [] : getAvailableFormats(layer),
        agolMode,
        agolCheck: agolMode && !isService ? checkAGOLCompatibility(layer) : null,
        layerStyle: isSpatialLayer(layer) ? mapService.getLayerStyle(layer.id) : null,
        styleDefaultColor: getLayerDefaultColor(layerIndex),
        mapZoom,
        mapLatitude
    };
}

export function handleLayerStyleChange(style) {
    const layer = getActiveLayer();
    if (!layer || !isSpatialLayer(layer)) return;
    mapService.restyleLayer(layer.id, layer, style);
}

export function handleLayerScaleRangeChange(layerId, range) {
    const layer = getLayers().find((l) => l.id === layerId);
    if (!layer || !isSpatialLayer(layer)) return;

    const patch = {
        scaleRangeEnabled: !!range.scaleRangeEnabled,
        minScale: range.minScale ?? null,
        maxScale: range.maxScale ?? null
    };
    updateLayer(layerId, patch);

    let latitude = 0;
    if (dualScreenCoordinator.isActive) {
        const bounds = dualScreenCoordinator.getBounds();
        if (bounds) {
            latitude = (bounds.getSouth() + bounds.getNorth()) / 2;
        }
    } else {
        const map = mapService.getMap();
        latitude = map?.getCenter?.()?.lat ?? 0;
    }
    mapService.setLayerScaleRange(layerId, patch, latitude);
    refreshUI();
}

// ============================
// Drag & Drop file import (global — works anywhere in the app)
// ============================

/** Workflow editor or any app modal — those UIs handle drops themselves (e.g. Import). */
function shouldSuppressGlobalFileDrop() {
    if (document.querySelector('.wf-overlay.visible')) return true;
    // Avoid stacking a second Import modal on top of Local Files setup / chooser.
    if (document.querySelector('.modal-overlay')) return true;
    return false;
}

export function setupDragDrop() {
    let dragCounter = 0;

    // Create full-screen drop overlay
    const overlay = document.createElement('div');
    overlay.id = 'global-drop-overlay';
    overlay.innerHTML = '<div class="drop-overlay-content">📂<br>Drop files to import<br><span class="text-sm text-muted">GeoJSON, CSV, KML, .gis-toolbox, …</span></div>';
    document.body.appendChild(overlay);

    // Prevent default browser behavior for all drag events on the document
    document.addEventListener('dragover', e => { e.preventDefault(); });
    document.addEventListener('dragenter', e => {
        e.preventDefault();
        if (shouldSuppressGlobalFileDrop()) return;
        dragCounter++;
        overlay.classList.add('visible');
    });
    document.addEventListener('dragleave', e => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            overlay.classList.remove('visible');
        }
    });
    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        overlay.classList.remove('visible');

        // Let open Import / other modals (and the workflow editor) own the drop.
        if (shouldSuppressGlobalFileDrop()) return;

        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length === 0) return;

        // Separate image files from data files
        const imageFiles = files.filter(f =>
            f.type.startsWith('image/') ||
            /\.(jpe?g|png|heic|heif|tiff?|webp)$/i.test(f.name)
        );
        const dataFiles = files.filter(f => !imageFiles.includes(f));

        // Import data files (GIS formats)
        if (dataFiles.length > 0) {
            await openImportForFiles(dataFiles);
        }
        // Import image files (photo mapper)
        if (imageFiles.length > 0) {
            const result = await photoMapper.processPhotos(imageFiles);
            if (result?.dataset) {
                addLayer(result.dataset, { activate: true });
                mapService.addLayer(result.dataset, getLayers().indexOf(result.dataset), { fit: true });
                refreshUI();
                showToast(`Mapped ${result.withGPS} photo(s) with GPS`, 'success');
            }
            if (result?.withoutGPS > 0) {
                showToast(`${result.withoutGPS} photo(s) have no GPS data`, 'warning');
            }
        }
    });
}

// ============================
// File import handler
// ============================
function throwIfTaskCancelled() {
    if (getActiveTask()?.cancelled) {
        const err = new Error('Operation cancelled');
        err.cancelled = true;
        throw err;
    }
}

/** Progress modal + cancel wired to the active TaskRunner (returns null if cancelled). */
async function runWithTaskProgress(title, operation) {
    const progress = showProgressModal(title);
    const onProgress = (data) => progress.update(data.percent, data.step);
    bus.on('task:progress', onProgress);
    let userCancelled = false;

    progress.onCancel(() => {
        userCancelled = true;
        getActiveTask()?.cancel();
        progress.close();
        bus.off('task:progress', onProgress);
        showToast('Operation cancelled', 'warning');
    });

    try {
        const result = await operation();
        if (!userCancelled) progress.close();
        bus.off('task:progress', onProgress);
        return userCancelled ? null : result;
    } catch (e) {
        if (!userCancelled) progress.close();
        bus.off('task:progress', onProgress);
        if (e?.cancelled || userCancelled) return null;
        throw e;
    }
}

function _rollbackImportedLayers(layerIds) {
    for (const id of layerIds) {
        const layer = getLayers().find((l) => l.id === id);
        if (layer) {
            revokeKmzBlobUrls(layer);
            if (isWorkspaceLayer(layer)) {
                void removeWorkspaceLayer(id);
            }
        }
        mapService.removeLayer(id);
        removeLayer(id);
    }
}

async function _addImportedDatasets(datasets, importOpts = {}) {
    const ids = [];
    const INCREMENTAL_THRESHOLD = 10000;
    let createdGroup = null;

    if (datasets.length >= 2) {
        const result = createImportGroupForDatasets(datasets);
        createdGroup = result.group;
    }

    for (const raw of datasets) {
        let ds = raw;
        if (ds.type === 'spatial' && !isWorkspaceLayer(ds)) {
            const featureCount = ds.geojson?.features?.length ?? 0;
            if (shouldConvertToWorkspace(featureCount, importOpts)) {
                ds = await convertSpatialDatasetToWorkspace(ds);
                if (ds.storage === 'workspace' && raw.geojson?.features?.length) {
                    raw.geojson.features.length = 0;
                }
            }
        }

        addLayer(ds, { activate: true });
        const layerIdx = getLayers().indexOf(ds);
        applyImportLayerStyles(ds, { mapService, getLayers, layerIndex: layerIdx });

        if (isWorkspaceLayer(ds)) {
            await mapService.addWorkspaceLayer(ds, layerIdx, { fit: false });
        } else if (ds.type === 'pmtiles') {
            await mapService.addLayer(ds, layerIdx, { fit: false });
        } else if (ds.type === 'spatial') {
            const featureCount = ds.geojson?.features?.length || 0;
            if (featureCount > INCREMENTAL_THRESHOLD) {
                await mapService.addLayerIncremental(ds, layerIdx, { fit: false });
            } else {
                mapService.addLayer(ds, layerIdx, { fit: false });
            }
        } else if (ds.type === 'service') {
            await mapService.addServiceLayer(ds, layerIdx, { fit: false });
        } else {
            mapService.addLayer(ds, layerIdx, { fit: false });
        }
        ids.push(ds.id);
    }

    const crsWarnings = datasets.filter((ds) => isSpatialLayer(ds) && !isLayerDisplayReady(ds));
    if (crsWarnings.length) {
        const names = crsWarnings.map((ds) => ds.name).join(', ');
        showToast(
            `${crsWarnings.length} layer(s) need reprojection for map display: ${names}`,
            'warning'
        );
    }

    return { ids, group: createdGroup };
}

export async function handleFileImport(files, fenceBbox = null, options = {}) {
    const fileList = Array.from(files || []);
    const kitFiles = fileList.filter(isProjectKitFile);
    let dataFiles = fileList.filter((file) => !isProjectKitFile(file));

    if (kitFiles.length) {
        if (!dataFiles.length) {
            options.onComplete?.();
        }
        for (const file of kitFiles) {
            await importProjectKit(file);
        }
        if (!dataFiles.length) return;
    }

    let progress = null;
    let userCancelled = false;
    const batchLayerIds = [];
    let onProgress = null;
    const useExternalProgress = typeof options.onProgress === 'function';

    try {
        if (!options.preflightConfirmed) {
            const platform = options.platform ?? getPlatformBundle({ showToast }).platform;
            const guard = await guardFilesBeforeImport(dataFiles, {
                source: 'handleFileImport',
                getLayers,
                platform
            });
            if (guard.cancelled) return;
        }

        if (useExternalProgress) {
            onProgress = (data) => {
                options.onProgress({
                    percent: data?.percent || 0,
                    step: data?.step || '',
                    fileName: data?.fileName,
                    fileSize: data?.fileSize,
                    fileIndex: data?.fileIndex,
                    fileCount: data?.fileCount
                });
            };
            bus.on('task:progress', onProgress);
            options.onProgress({ percent: 0, step: 'Starting import…' });
            options.onCancelReady?.(() => {
                if (userCancelled) return;
                userCancelled = true;
                getActiveTask()?.cancel();
                cancelWorkerParse();
                bus.off('task:progress', onProgress);
                showToast('Import cancelled', 'warning');
            });
        } else {
            progress = showProgressModal('Importing Files');
            onProgress = (data) => progress.update(data.percent, data.step, {
                fileName: data.fileName,
                fileSize: data.fileSize,
                fileIndex: data.fileIndex,
                fileCount: data.fileCount
            });
            bus.on('task:progress', onProgress);

            progress.onCancel(() => {
                userCancelled = true;
                getActiveTask()?.cancel();
                cancelWorkerParse();
                progress.close();
                bus.off('task:progress', onProgress);
                showToast('Import cancelled', 'warning');
            });
        }

        let allExpanded = [];
        let totalFiltered = 0;
        let totalFeatureFiltered = 0;
        const importGroupsCreated = [];

        sessionStore.pauseSessionSave();
        const { errors, cancelled } = await importFiles(dataFiles, {
            importMode: options.importMode,
            useWorkspace: options.useWorkspace,
            selectedFields: options.selectedFields,
            onFileImported: async (_file, result) => {
                throwIfTaskCancelled();
                if (!result) return;
                const normalized = normalizeImporterResult(result);
                const {
                    expanded,
                    totalFiltered: tf,
                    featureFiltered: ff
                } = await finalizeImportedDatasets(normalized, {
                    fenceBbox,
                    featureFilter: options.featureFilter || null,
                    task: getActiveTask()
                });
                totalFiltered += tf;
                totalFeatureFiltered += ff || 0;
                const { resolveImportCrsForDatasets } = await import('../import/import-crs-resolve.js');
                const { pickCrsConfirmModal } = await import('../../react/tools/mountCrsConfirmDialog.jsx');
                await resolveImportCrsForDatasets(expanded, pickCrsConfirmModal);
                const { ids, group } = await _addImportedDatasets(expanded, {
                    importMode: options.importMode,
                    useWorkspace: options.useWorkspace
                });
                if (group) importGroupsCreated.push(group);
                batchLayerIds.push(...ids);
                allExpanded.push(...expanded);
            }
        });

        if (!userCancelled) {
            if (progress) progress.close();
            else options.onComplete?.();
        }
        bus.off('task:progress', onProgress);

        if (userCancelled || cancelled) {
            options.onAborted?.();
            _rollbackImportedLayers(batchLayerIds);
            return;
        }

        throwIfTaskCancelled();

        if (batchLayerIds.length > 0) {
            await mapService.scheduleFitToLayers(batchLayerIds, { allowZoomOut: false });
        }

        if (allExpanded.length > 0) {
            const summary = buildImportSummary({
                expanded: allExpanded,
                totalFiltered,
                featureFiltered: totalFeatureFiltered,
                errors,
                fenceBbox,
                importGroups: importGroupsCreated
            });
            const fenceNote = fenceBbox && totalFiltered > 0 ? ` (${totalFiltered} features outside fence excluded)` : '';
            const filterNote = totalFeatureFiltered > 0
                ? ` (${totalFeatureFiltered} features excluded by filter)`
                : '';
            showToast(`${formatImportSummaryToast(summary)}${fenceNote}${filterNote}`, 'success');
            if (summary.warnings.length > 0 || summary.errors.length > 0) {
                const body = [
                    ...summary.warnings.map((w) => `<p><strong>${w.layer}:</strong> ${w.message}</p>`),
                    ...summary.errors.map((e) => `<p><strong>${e.file}:</strong> ${e.message}</p>`)
                ].join('');
                if (body) {
                    showModal('Import Summary', body, { width: '480px' });
                }
            }
            refreshUI();
        } else if (errors.length > 0) {
            const summary = buildImportSummary({ expanded: [], totalFiltered: 0, errors, fenceBbox });
            showModal(
                'Import Failed',
                summary.errors.map((e) => `<p><strong>${e.file}:</strong> ${e.message}</p>`).join(''),
                { width: '480px' }
            );
        }
        for (const ds of allExpanded) {
            if (ds._importWarning) {
                showToast(ds._importWarning, 'warning');
            }
        }
        for (const ds of allExpanded) {
            if (ds._networkLinkHrefs?.length) {
                await _promptNetworkLinkAfterImport(ds);
            }
        }
        if (errors.length > 0) {
            for (const err of errors) {
                const classified = handleError(err.error, 'Import', err.file);
                showErrorToast(classified);
            }
        }
    } catch (e) {
        if (progress) progress.close();
        if (onProgress) bus.off('task:progress', onProgress);
        _rollbackImportedLayers(batchLayerIds);
        if (e?.cancelled || userCancelled) {
            options.onAborted?.();
            return;
        }
        const classified = handleError(e, 'Import', 'File import');
        if (classified.category === ErrorCategory.OUT_OF_MEMORY) {
            showModal(
                'Import Failed — File Too Large',
                `<p>${classified.message || e.message}</p>${classified.guidance ? `<p class="text-xs text-muted">${classified.guidance}</p>` : ''}<p class="text-xs text-muted">Import guard ${e?.details?.guardVersion || 'active'}</p>`,
                { width: '480px' }
            );
        } else {
            showErrorToast(classified);
        }
    } finally {
        sessionStore.resumeSessionSave(true);
    }
}

export function openImportFlow() {
    clearAfterFenceRestore();
    _openImportFlowModal();
}

function _pickProjectKitFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gis-toolbox,.gtbx';
    input.setAttribute('aria-label', 'Import Toolbox Kit');
    input.style.cssText = 'opacity:0;position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.remove();
        if (file) await importProjectKit(file);
    }, { once: true });
    input.click();
}

function _openImportFlowModal(flowProps = {}) {
    const rootId = `import-flow-react-${Date.now()}`;
    showModal('Import', `<div id="${rootId}"></div>`, {
        width: '920px',
        onMount: async (overlay, close) => {
            overlay.querySelector('.modal')?.classList.add('modal--import');
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            try {
            const { mountImportFlowDialog } = await import('../../react/tools/mountImportFlowDialog.jsx');
            const { listCatalogLiveLayers } = await import('../live-layers/catalog-schema.js');
            const { addCatalogLayerToMap } = await import('../live-layers/live-layer-bootstrap.js');
            const { getPlatformBundle } = await import('../platform/create-platform.js');
            const platformBundle = getPlatformBundle({ showToast });

            const mounted = mountImportFlowDialog(root, {
                onCancel: () => close(),
                hasActiveFence: hasActiveImportFence(),
                fenceBbox: _fenceBbox,
                onImportFiles: async (files, importOpts = {}, ui = {}) => {
                    const { classifyImportFiles } = await import('../import/import-policy.js');
                    const { memoryFiles } = classifyImportFiles(
                        files,
                        platformBundle.platform
                    );
                    if (!memoryFiles.length) return;
                    await handleFileImport(memoryFiles, _fenceBbox, {
                        preflightConfirmed: true,
                        importMode: importOpts.importMode,
                        useWorkspace: importOpts.useWorkspace,
                        selectedFields: importOpts.selectedFields,
                        featureFilter: importOpts.featureFilter || null,
                        onProgress: ui.onProgress,
                        onCancelReady: ui.onCancelReady,
                        onAborted: ui.onAborted,
                        onComplete: () => ui.close?.(),
                        platform: platformBundle.platform
                    });
                },
                onStreamImport: (files, streamOpts = {}) => {
                    close();
                    void openImportForFiles(files, _fenceBbox, {
                        selectedFields: streamOpts.selectedFields || null,
                        featureFilter: streamOpts.featureFilter || null,
                        allowStreamImport: streamOpts.allowStreamImport === true
                    });
                },
                onOpenArcGIS: () => {
                    close();
                    openArcGISImporter();
                },
                onOpenPhotoMapper: () => {
                    close();
                    openPhotoMapper();
                },
                onOpenProjectKit: () => {
                    close();
                    _pickProjectKitFile();
                },
                onOpenDraw: () => {
                    close();
                    createDrawLayer();
                },
                onOpenFence: (session = null) => {
                    close();
                    const restore = () => {
                        if (session?.files?.length) {
                            _openImportFlowModal({
                                initialFiles: session.files,
                                initialScans: session.scans || null,
                                initialSelectedFields: session.selectedFields || null,
                                initialFeatureFilter: session.featureFilter ?? null,
                                startAtFieldPick: true
                            });
                            return;
                        }
                        _openImportFlowModal();
                    };
                    void startImportFence(restore);
                },
                onClearFence: () => {
                    clearImportFenceState();
                },
                catalogLiveLayers: listCatalogLiveLayers(),
                onAddCatalogLiveLayer: async (layerId) => {
                    try {
                        const added = await addCatalogLayerToMap(
                            { mapService, showToast, refreshUI },
                            layerId
                        );
                        if (added) close();
                    } catch (error) {
                        showErrorToast(handleError(error, 'Import', 'Add live layer'));
                    }
                },
                ...flowProps
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
            } catch (e) {
            const classified = handleError(e, 'Import', 'ImportFlowDialog mount');
            showErrorToast(classified);
            }
        }
    });
}

/**
 * Shared entry for drag-drop, toolbar, and routed imports — guard + route before parse.
 * @param {File[]} files
 * @param {Array|null} [fenceBbox]
 * @param {{ selectedFields?: string[]|null, featureFilter?: object|null }} [options] applies to streamed + standard paths
 */
export async function openImportForFiles(files, fenceBbox = null, options = {}) {
    if (!files?.length) return;

    const kitFiles = files.filter(isProjectKitFile);
    const dataFiles = files.filter((file) => !isProjectKitFile(file));

    for (const file of kitFiles) {
        await importProjectKit(file);
    }
    if (!dataFiles.length) return;

    const { platform, services } = getPlatformBundle({ showToast });

    // High-capacity path: large GeoJSON/CSV the standard pipeline would reject
    // stream through a worker into IndexedDB instead (see stream-policy).
    let partition = null;
    try {
        const { partitionStreamingFiles } = await import('../import/stream/stream-policy.js');
        partition = await partitionStreamingFiles(dataFiles);
    } catch (e) {
        logger.warn('Import', 'Streaming partition failed — using standard path', { error: e?.message });
        partition = null;
    }

    if (partition) {
        for (const { message } of partition.rejectedFiles) {
            showToast(message, 'error');
        }
        if (partition.streamFiles.length) {
            const activeFence = fenceBbox ?? _fenceBbox;
            // Large files always open the configure UI unless the dialog already
            // confirmed unlock (≤250k stored) via allowStreamImport.
            if (!options.allowStreamImport) {
                _openImportFlowModal({
                    initialFiles: dataFiles,
                    startAtFieldPick: true
                });
                return;
            }
            const { runStreamingImportFlow } = await import('./stream-import-flow.js');
            await runStreamingImportFlow(partition.streamFiles, {
                fenceBbox: activeFence,
                refreshUI,
                selectedFields: options.selectedFields || null,
                featureFilter: options.featureFilter || null
            });
        }
    }

    const standardFiles = partition ? partition.standardFiles : dataFiles;
    if (!standardFiles.length) return;

    try {
        await guardFilesBeforeImport(standardFiles, {
            source: 'openImportForFiles',
            getLayers,
            platform
        });
    } catch (e) {
        const classified = handleError(e, 'Import', 'openImportForFiles guard');
        showErrorToast(classified);
        return;
    }

    try {
    const { classifyImportFiles } = await import('../import/import-policy.js');
    const { memoryFiles } = classifyImportFiles(standardFiles, platform);

    if (!memoryFiles.length) return;

    const { scanFilesForImport } = await import('../import/import-scan.js');
    const { preflightFile, PREFLIGHT_LEVEL } = await import('../import/import-preflight.js');
    const { detectFormat } = await import('../import/importer.js');

    const shouldPreScan = memoryFiles.some((f) => {
        const pf = preflightFile(f);
        const fmt = detectFormat(f);
        return pf.level === PREFLIGHT_LEVEL.SOFT || fmt === 'zip' || fmt === 'kmz';
    });

    let scans = shouldPreScan ? await scanFilesForImport(memoryFiles) : [];
    const assessment = await assessImportRoute(memoryFiles, { scans });

    if (assessment.route === 'optimizer') {
        _openImportFlowModal({
            initialFiles: memoryFiles,
            startAtFieldPick: true
        });
        return;
    }

    // Standard route: import as-is (in-memory). Field picking stays in the Import Files dialog.
    await handleFileImport(memoryFiles, fenceBbox ?? _fenceBbox, {
        preflightConfirmed: true,
        platform,
        ...(options.selectedFields?.length ? { selectedFields: options.selectedFields } : {}),
        ...(options.featureFilter ? { featureFilter: options.featureFilter } : {})
    });
    } catch (e) {
        const classified = handleError(e, 'Import', 'openImportForFiles');
        showErrorToast(classified);
    }
}

function setBasemapToggleActive(value) {
    syncBasemapToggleActive(value);
}

function setDimensionToggleActive(value) {
    document.querySelectorAll('#dimension-toggle .header-toggle-option').forEach((button) => {
        const isActive = button.dataset.value === value;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
}

export function applyBasemapHeaderSelection(value) {
    if (!value) return;
    mapService.setBasemap(value);
    setBasemapToggleActive(value);
}

export function applyBasemapToneSelection(tone) {
    if (!tone) return;
    return mapService.setBasemapTone(tone);
}

export function applyDimensionHeaderSelection(value) {
    if (!value) return;
    if (value === '3d') mapService.enable3D();
    else mapService.disable3D();
    setDimensionToggleActive(value);
}

export function setPanelCollapsed(side, collapsed) {
    const panel = document.querySelector(`.panel-${side}`);
    if (!panel) return;
    panel.classList.toggle('collapsed', !!collapsed);

    const expandId = side === 'left' ? 'expand-left-panel' : 'expand-right-panel';
    const toggleId = side === 'left' ? 'toggle-left-panel' : 'toggle-right-panel';
    const collapsedGlyph = side === 'left' ? '▶' : '◀';
    const expandedGlyph = side === 'left' ? '◀' : '▶';

    document.getElementById(expandId)?.classList.toggle('hidden', !collapsed);
    const toggleButton = document.getElementById(toggleId);
    if (toggleButton) {
        toggleButton.textContent = collapsed ? collapsedGlyph : expandedGlyph;
    }
    setTimeout(() => { mapService.resize(); }, 250);
}

export function togglePanelCollapsed(side) {
    const panel = document.querySelector(`.panel-${side}`);
    if (!panel) return;
    const willCollapse = !panel.classList.contains('collapsed');
    setPanelCollapsed(side, willCollapse);
}

function closestFromEvent(event, selector) {
    const node = event.target instanceof Element ? event.target : event.target?.parentElement;
    return node?.closest(selector) ?? null;
}

// ============================
// Setup all event listeners
// ============================
export function setupAppWiring() {
    if (_appWiringInstalled) return;
    _appWiringInstalled = true;

    // Import button ??? use a persistent hidden input (iOS-safe)
    _importInputEl = document.createElement('input');
    _importInputEl.type = 'file';
    _importInputEl.multiple = true;
    _importInputEl.accept = '.geojson,.json,.csv,.tsv,.txt,.xlsx,.xls,.kml,.kmz,.gpx,.zip,.xml,.gis-toolbox,.gtbx';
    _importInputEl.setAttribute('aria-label', 'Import files');
    _importInputEl.style.cssText = 'opacity:0;position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
    document.body.appendChild(_importInputEl);
    _importInputEl.addEventListener('change', () => {
        if (_importInputEl.files.length > 0) {
            const files = Array.from(_importInputEl.files);
            openImportForFiles(files, _fenceBbox);
        }
    });

    // Workflow editor
    if (!_workflowOverlay) {
        _workflowOverlay = createWorkflowController({
            getLayers: () => getLayers(),
            importFile: (file) => importFile(file),
            addToMap: (data, name, opts = {}) => {
                if (data.type !== 'spatial') {
                    // Tables: just add to state, no map layer
                    const dataset = createTableDataset(name, data.rows, null, { format: 'workflow' });
                    addLayer(dataset);
                    refreshUI();
                    showToast(`Table "${name}" added from workflow`, 'success');
                    return dataset.id;
                }
                // Check if a workflow layer with this name already exists — update in place
                const existing = getLayers().find(l => l.name === name && l.source?.format === 'workflow');
                if (existing) {
                    updateLayer(existing.id, { geojson: data.geojson });
                    applyImportMetadata(existing, data);
                    mapService.removeLayer(existing.id);
                    const idx = getLayers().indexOf(existing);
                    mapService.addLayer(existing, idx, { fit: !opts.workflow });
                    applyImportLayerStyles(existing, { mapService, getLayers, layerIndex: idx });
                    refreshUI();
                    return existing.id;
                }
                // New layer
                const dataset = createSpatialDataset(name, data.geojson, { format: 'workflow' });
                applyImportMetadata(dataset, data);
                addLayer(dataset);
                const layerIdx = getLayers().indexOf(dataset);
                mapService.addLayer(dataset, layerIdx, { fit: !opts.workflow });
                applyImportLayerStyles(dataset, { mapService, getLayers, layerIndex: layerIdx });
                refreshUI();
                if (!opts.workflow) showToast(`Layer "${name}" added from workflow`, 'success');
                return dataset.id;
            },
            updateMapLayer: (layerId, data) => {
                const layer = getLayers().find(l => l.id === layerId);
                if (!layer) return;
                updateLayer(layerId, { geojson: data.geojson });
                mapService.removeLayer(layerId);
                mapService.addLayer(layer, getLayers().indexOf(layer));
                refreshUI();
            },
            removeFromMap: (layerId) => {
                const layer = getLayers().find(l => l.id === layerId);
                if (layer) revokeKmzBlobUrls(layer);
                mapService.removeLayer(layerId);
                removeLayer(layerId);
                refreshUI();
            }
        });
        _workflowOverlay.warmup();
    }

    document.addEventListener('click', (event) => {
        if (!closestFromEvent(event, '#btn-workflow')) return;
        _workflowOverlay?.toggle();
    });
    
    setupDualScreenMode();

    // Handle drawn features
    bus.on('draw:featureCreated', ({ layerId, feature }) => {
        const layer = getLayers().find(l => l.id === layerId);
        if (!layer || layer.type !== 'spatial') return;
        saveSnapshot(layer.id, 'Draw feature', layer.geojson);
        layer.geojson.features.push(feature);
        layer.schema = analyzeSchema(layer.geojson);
        bus.emit('layer:updated', layer);
        bus.emit('layers:changed', getLayers());
        mapService.addLayer(layer, getLayers().indexOf(layer));
        refreshUI();
    });

    // Handle edited features (vertex dragging)
    bus.on('draw:featureEdited', ({ layerId, featureIndex }) => {
        const layer = getLayers().find(l => l.id === layerId);
        if (!layer || layer.type !== 'spatial') return;
        saveSnapshot(layer.id, 'Edit feature', layer.geojson);
        layer.schema = analyzeSchema(layer.geojson);
        bus.emit('layer:updated', layer);
        bus.emit('layers:changed', getLayers());
        refreshUI();
    });

    // Handle deleted features
    bus.on('draw:featureDeleted', ({ layerId, featureIndex }) => {
        const layer = getLayers().find(l => l.id === layerId);
        if (!layer || layer.type !== 'spatial') return;
        saveSnapshot(layer.id, 'Delete feature', layer.geojson);
        layer.geojson.features.splice(featureIndex, 1);
        layer.schema = analyzeSchema(layer.geojson);
        bus.emit('layer:updated', layer);
        bus.emit('layers:changed', getLayers());
        mapService.addLayer(layer, getLayers().indexOf(layer));
        refreshUI();
    });

    // App action delegation for HTML-rendered tool buttons (replaces inline onclick usage)
    document.addEventListener('click', (event) => {
        const actionButton = closestFromEvent(event, '[data-app-action]');
        if (!actionButton) return;
        const { appAction, appArg } = actionButton.dataset;
        if (!appAction) return;
        event.preventDefault();
        event.stopPropagation();
        invokeAppAction(appAction, appArg);
    });

    // Layer list activation
    document.addEventListener('click', (event) => {
        const layerItem = closestFromEvent(event, '.layer-item[data-layer-id]');
        if (!layerItem) return;
        if (closestFromEvent(event, '[data-app-action]')) return;
        setActiveLayerAndRefresh(layerItem.dataset.layerId);
    });

    // Inline rename gestures
    document.addEventListener('dblclick', (event) => {
        const layerName = closestFromEvent(event, '.layer-name[data-layer-rename-id]');
        if (layerName) {
            event.preventDefault();
            event.stopPropagation();
            renameLayer(layerName.dataset.layerRenameId, layerName);
            return;
        }
        const fieldName = closestFromEvent(event, '.field-name[data-field-rename-id]');
        if (fieldName) {
            event.preventDefault();
            renameField(fieldName.dataset.fieldRenameId, fieldName);
        }
    });

    // Field list controls
    document.addEventListener('input', (event) => {
        if (event.target.id === 'field-search') {
            filterFields(event.target.value);
        }
    });
    document.addEventListener('change', (event) => {
        const fieldToggle = closestFromEvent(event, 'input[data-field-toggle]');
        if (!fieldToggle) return;
        toggleField(fieldToggle.dataset.fieldToggle, fieldToggle.checked);
    });

    // Listen for layer changes to update UI
    bus.on('layers:changed', refreshUI);
    bus.on('map:scaleRangeChanged', refreshUI);
    bus.on('layers:changed', () => sessionStore.scheduleSave(getLayers(), mapService.getLayerStylesRecord(), getLayerGroups()));
    bus.on('map:styleChanged', () => sessionStore.scheduleSave(getLayers(), mapService.getLayerStylesRecord(), getLayerGroups()));
    bus.on('layer-groups:changed', () => sessionStore.scheduleSave(getLayers(), mapService.getLayerStylesRecord(), getLayerGroups()));
    bus.on('layer:active', (layer) => {
        mapService.setActiveLayerId?.(layer?.id ?? getActiveLayer()?.id ?? null);
        notifyActiveLayerDisplayMode(layer);
        refreshUI();
    });
    bus.on('map:ready', () => {
        const layer = getActiveLayer();
        mapService.setActiveLayerId?.(layer?.id ?? null);
    });
    bus.on('task:error', (data) => {
        showErrorToast(data.error);
    });

    bus.on('map:popup:edit', (hit) => {
        if (!hit) return;
        mapService.closePopup();
        openFeatureEditor(hit.layerId, hit.featureIndex);
    });

    initSelectionShortcuts({
        clearSelection,
        selectAllFeatures,
        invertSelection,
        deleteSelectedFeatures,
        getSelectionCount: () => {
            const layer = getActiveLayer();
            return layer ? mapService.getSelectionCount(layer.id) : 0;
        },
        isDrawToolActive: () => !!drawManager.activeTool
    });

    bus.on('selection:boxEmpty', () => {
        showToast('No features in selection box', 'info');
    });

    bus.on('coord-search:add-new', _coordSearchAddNew);
    bus.on('coord-search:add-existing', _coordSearchAddToExisting);
    bus.on('coord-search:clear', _coordSearchClear);

    if ('launchQueue' in window) {
        window.launchQueue.setConsumer(async (launchParams) => {
            const file = launchParams.files?.[0];
            if (!file || !isProjectKitFile(file)) return;
            await importProjectKit(file);
        });
    }
}

// ============================
// Dual Screen Mode
// ============================
function setupDualScreenMode() {
    const btn = document.getElementById('btn-dual-screen');
    if (!btn) return;

    installDualScreenPrimaryHandlers({
        onDrawFeatureCreated: (layerId, feature) => {
            bus.emit('draw:featureCreated', { layerId, feature });
        },
        onDrawFeatureEdited: (layerId, featureIndex) => {
            bus.emit('draw:featureEdited', { layerId, featureIndex });
        },
        onDrawFeatureDeleted: (layerId, featureIndex) => {
            bus.emit('draw:featureDeleted', { layerId, featureIndex });
        },
        openFeatureEditor,
        handleFileImport: (files) => openImportForFiles(files, _fenceBbox),
        handlePhotoImport: async (imageFiles) => {
            const result = await photoMapper.processPhotos(imageFiles);
            if (result?.dataset) {
                addLayer(result.dataset, { activate: true });
                mapService.addLayer(result.dataset, getLayers().indexOf(result.dataset), { fit: true });
                refreshUI();
                showToast(`Imported ${imageFiles.length} photo(s)`, 'success');
            }
        },
        setFenceBbox: (bbox) => {
            _fenceBbox = bbox;
            dualScreenCoordinator.setFenceBbox(bbox);
            updateFenceButtonState();
            showToast('Import fence placed — all imports will be filtered to this area', 'success');
            maybeReopenImportAfterFence();
        },
        clearFence: () => {
            _fenceBbox = null;
            dualScreenCoordinator.setFenceBbox(null);
            mapService.clearImportFence();
            updateFenceButtonState();
            if (dualScreenCoordinator.isActive) {
                dualScreenCoordinator.broadcastDrawCmd({ action: 'clearFence' });
            }
        },
        toggleLayerVisibility: (layerId) => {
            toggleLayerVisibility(layerId);
            mapService.toggleLayer(layerId, getLayers().find(l => l.id === layerId)?.visible);
            refreshUI();
        },
        zoomToLayer: (layerId) => {
            if (dualScreenCoordinator.isActive) {
                dualScreenCoordinator.broadcastFit('fitLayers', { layerIds: [layerId] });
                return;
            }
            const layer = mapService.getLayerRecord(layerId);
            if (layer?.geojson) {
                try {
                    const bb = turf.bbox(layer.geojson);
                    mapService.getMap()?.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 30 });
                } catch (_) { /* ignore */ }
            }
        },
        setActiveLayer: (id) => { setActiveLayer(id); refreshUI(); },
        onCoordSearchAddNew: _coordSearchAddNew,
        onCoordSearchAddToExisting: _coordSearchAddToExisting
    });

    document.getElementById('map-container')?.addEventListener('click', (e) => {
        if (e.target.closest('#btn-return-map-primary')) toggleDualScreen();
    });

    dualScreenCoordinator.onStateChange((active) => {
        if (active && _fenceBbox) {
            dualScreenCoordinator.setFenceBbox(_fenceBbox);
            setTimeout(() => {
                dualScreenCoordinator.broadcastDrawCmd({ action: 'applyFence', bbox: _fenceBbox });
            }, 600);
        }
        if (!active) dualScreenCoordinator.setFenceBbox(_fenceBbox);
    });

    bus.on('layers:changed', () => {
        if (dualScreenCoordinator.isActive) dualScreenCoordinator.syncLayersChanged();
    });

    const toggleDualScreen = async () => {
        if (getState().ui.isMobile) return;
        if (dualScreenCoordinator.isActive) {
            dualScreenCoordinator.deactivate();
            return;
        }
        const ok = await dualScreenCoordinator.activate();
        if (!ok) {
            showToast(POPUP_BLOCKED_MESSAGE, 'error', { duration: 8000 });
        }
    };

    btn.addEventListener('click', toggleDualScreen);
    window._toggleDualScreen = toggleDualScreen;

    window.addEventListener('message', (e) => {
        if (e.origin !== window.location.origin) return;
        if (e.data?.type === 'gis-toolbox-dual-screen-exit' && dualScreenCoordinator.isActive) {
            dualScreenCoordinator.deactivate({ fromSecondaryBye: true });
        }
    });

    if (typeof sessionStorage !== 'undefined'
        && consumeDualScreenReloadReminder(sessionStorage, window._dualScreenReloadState ||= {})) {
        showToast(RELOAD_REMINDER_MESSAGE, 'info', { duration: 8000 });
    }
}

// ============================
// UI refresh — emit ui:refresh for React store
// ============================
const REFRESH_UI_DEBOUNCE_MS = 150;
let _refreshUITimer = null;

function refreshUINow() {
    bus.emit('ui:refresh');
}

/** Debounced ui:refresh — coalesces bursts during import / multi-layer updates. */
export function refreshUI() {
    clearTimeout(_refreshUITimer);
    _refreshUITimer = setTimeout(() => {
        _refreshUITimer = null;
        refreshUINow();
    }, REFRESH_UI_DEBOUNCE_MS);
}

// ============================
// Layer List (left panel)
// ============================


export function moveLayerUp(id) {
    reorderLayer(id, 'up');
    mapService.syncLayerOrder(getMapLayerOrderIds());
    refreshUI();
}

export function moveLayerDown(id) {
    reorderLayer(id, 'down');
    mapService.syncLayerOrder(getMapLayerOrderIds());
    refreshUI();
}

export function moveLayerToIndex(id, toIndex) {
    reorderLayerToIndex(id, toIndex);
    reconcileGroupsAfterReorder(getLayers());
    mapService.syncLayerOrder(getMapLayerOrderIds());
    refreshUI();
}

export function moveGroupToIndex(groupId, toIndex) {
    moveGroupBlockToIndex(groupId, toIndex, getLayers());
    mapService.syncLayerOrder(getMapLayerOrderIds());
    refreshUI();
}

export function toggleGroupCollapsedAndRefresh(groupId) {
    toggleGroupCollapsed(groupId);
    refreshUI();
}

export function renameLayerGroupInline(groupId, el) {
    if (!el) return;
    const group = getLayerGroups().find((g) => g.id === groupId);
    if (!group) return;
    const current = group.name;
    el.contentEditable = 'true';
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = () => {
        el.contentEditable = 'false';
        const next = el.textContent?.trim();
        if (next && next !== current) renameLayerGroup(groupId, next);
        else el.textContent = current;
        refreshUI();
    };
    el.onblur = finish;
    el.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        if (e.key === 'Escape') { el.textContent = current; el.blur(); }
    };
}

export function toggleGroupVisibilityAndRender(groupId) {
    const children = getGroupChildLayers(groupId, getLayers());
    if (!children.length) return;
    const showAll = !isGroupFullyVisible(groupId, getLayers());
    for (const layer of children) {
        if ((layer.visible !== false) !== showAll) {
            toggleLayerVisibility(layer.id);
            mapService.toggleLayer(layer.id, showAll);
        }
    }
    refreshUI();
}

export async function dissolveLayerGroupWithConfirm(groupId) {
    const group = getLayerGroups().find((g) => g.id === groupId);
    if (!group) return;
    const ok = await confirm('Ungroup Layers', `Ungroup "${group.name}"? Layers will stay on the map.`);
    if (!ok) return;
    dissolveLayerGroup(groupId, getLayers());
    refreshUI();
}

export async function removeLayerGroupWithConfirm(groupId) {
    const group = getLayerGroups().find((g) => g.id === groupId);
    if (!group) return;
    const count = group.childLayerIds.length;
    const isImport = group.source === 'import';
    const ok = await confirm(
        isImport ? 'Delete Import' : 'Remove Group',
        isImport
            ? `Delete "${group.name}" and all ${count} layer${count !== 1 ? 's' : ''} from this import?`
            : `Remove "${group.name}" and all ${count} layer${count !== 1 ? 's' : ''} inside it?`
    );
    if (!ok) return;
    await removeLayers(group.childLayerIds);
}

export async function groupSelectedLayers(layerIds, name) {
    const group = createManualGroupFromLayerIds(layerIds, getLayers(), name);
    if (!group) {
        showToast('Select at least 2 layers to group', 'warning');
        return false;
    }
    mapService.syncLayerOrder(getMapLayerOrderIds());
    refreshUI();
    return true;
}

export async function exportLayerGroup(groupId, format = 'kmz') {
    const group = getLayerGroups().find((g) => g.id === groupId);
    if (!group) return;
    const layers = getGroupChildLayers(groupId, getLayers()).filter((l) => l.type === 'spatial');
    if (!layers.length) return showToast('No spatial layers in this group', 'warning');

    try {
        const layerData = layers.map((ds) => ({
            dataset: ds,
            style: mapService.getLayerStyle(ds.id) || {}
        }));
        const fname = group.name.replace(/\.[^.]+$/, '').slice(0, 60);
        const parentFolder = group.name;
        if (format === 'kml') {
            await exportMultiLayerKMLFile(layerData, { filename: fname, parentFolder });
            showToast(`Exported ${layers.length} layers as KML`, 'success');
        } else {
            await exportMultiLayerKMZFile(layerData, { filename: fname, parentFolder });
            showToast(`Exported ${layers.length} layers as KMZ`, 'success');
        }
    } catch (e) {
        showErrorToast(handleError(e, 'Export', 'group-kml-kmz'));
    }
}

export function setActiveLayerAndRefresh(id) {
    setActiveLayer(id);
    refreshUI();
}

let _lastDisplayModeToastLayerId = null;

/**
 * Toast once per active-layer change when the layer uses workspace display modes.
 * Persistent TILED / VIEWPORT badge on the layer row holds the deep explanation.
 */
function notifyActiveLayerDisplayMode(layer) {
    if (!layer?.id) {
        _lastDisplayModeToastLayerId = null;
        return;
    }
    if (_lastDisplayModeToastLayerId === layer.id) return;
    _lastDisplayModeToastLayerId = layer.id;
    const mapEntry = mapService.getLayerRecord?.(layer.id) || null;
    const display = resolveLayerDisplayMode(layer, mapEntry);
    if (!display) return;
    showToast(display.toastMessage, 'info');
}

function escapeDisplayModeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Expandable details for the layer-list TILED / VIEWPORT badge. */
export function openLayerDisplayModeInfo(layerId) {
    const layer = getLayers().find((item) => item.id === layerId);
    if (!layer) return;
    const mapEntry = mapService.getLayerRecord?.(layerId) || null;
    const display = resolveLayerDisplayMode(layer, mapEntry);
    if (!display) return;
    const details = (display.details || [])
        .map((line) => `<li>${escapeDisplayModeHtml(line)}</li>`)
        .join('');
    showModal(
        display.title,
        `<p>${escapeDisplayModeHtml(display.summary)}</p>`
        + (details
            ? `<ul style="margin:12px 0 0;padding-left:1.2em;line-height:1.45;">${details}</ul>`
            : ''),
        { width: '480px' }
    );
}

export function toggleLayerVisibilityAndRender(id) {
    toggleLayerVisibility(id);
    mapService.toggleLayer(id, getLayers().find(l => l.id === id)?.visible);
    refreshUI();
}

export function toggleLayerLockAndRender(id) {
    toggleLayerLock(id);
    mapService.applyLayerLock(id);
    mapService.syncLayerOrder(getMapLayerOrderIds());
    refreshUI();
}

export function zoomToLayer(id) {
    const layer = mapService.getLayerRecord(id);
    if (layer && layer.geojson) {
        try {
            const bb = turf.bbox(layer.geojson);
            mapService.getMap()?.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 30 });
        } catch (_) {}
    }
}

export async function removeLayerWithConfirm(id) {
    const removed = await removeLayersWithConfirm([id]);
    return removed;
}

export async function removeLayers(ids) {
    const layers = getLayers();
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    const expandedIds = expandLayerIdsForRemoval(uniqueIds, layers);
    if (!expandedIds.length) return false;
    const opfsKeys = new Set();
    for (const id of expandedIds) {
        const layer = layers.find((l) => l.id === id);
        if (layer) {
            revokeKmzBlobUrls(layer);
            if (layer.source?.opfsKey) opfsKeys.add(layer.source.opfsKey);
            if (isWorkspaceLayer(layer)) {
                await removeWorkspaceLayer(layer.workspaceLayerId || id);
            }
        }
        mapService.removeLayer(id);
        removeLayer(id);
        onLayerRemoved(id, getLayers());
    }
    for (const key of opfsKeys) {
        await removeSourceFileIfUnreferenced(key, getLayers());
    }
    refreshUI();
    return true;
}

export async function removeLayersWithConfirm(ids) {
    const layers = getLayers();
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    const expandedIds = expandLayerIdsForRemoval(uniqueIds, layers);
    if (!expandedIds.length) return false;
    const message = expandedIds.length === 1
        ? 'Remove this layer?'
        : `Remove ${expandedIds.length} selected layers?`;
    const ok = await confirm('Remove Layers', message);
    if (!ok) return false;
    return removeLayers(expandedIds);
}

// ============================
// Field List (left panel)
// ============================


// ============================
// Output Panel (right panel)
// ============================


// ============================
// Layer Styling Panel
// ============================







// ============================
// Layer Data Tools Panel (left panel section)
// ============================


// ============================
// Coordinate Search ??? add point from search marker
// ============================
function _coordSearchAddNew(searchInfo) {
    const info = searchInfo || mapService.getSearchLatLng();
    if (!info) return showToast('No search marker active', 'warning');

    const feature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [info.lng, info.lat] },
        properties: {
            name: 'Search Point',
            latitude: info.lat.toFixed(6),
            longitude: info.lng.toFixed(6),
            source: info.inputText || ''
        }
    };

    const ds = createSpatialDataset('Search Point', { type: 'FeatureCollection', features: [feature] });
    addLayer(ds);
    setActiveLayer(ds.id);
    mapService.addLayer(ds, getLayers().indexOf(ds), { fit: false });
    refreshUI();
    _clearCoordSearchMarker();
}

function _coordSearchAddToExisting(searchInfo) {
    const info = searchInfo || mapService.getSearchLatLng();
    if (!info) return showToast('No search marker active', 'warning');

    const layers = getLayers().filter(l => l.type === 'spatial');
    if (layers.length === 0) {
        // No layers ??? fall back to creating new
        _coordSearchAddNew();
        return;
    }

    // Show a picker if multiple layers, or use the single / active one
    const active = getActiveLayer();
    if (layers.length === 1) {
        _addSearchPointToLayer(layers[0], info);
        return;
    }

    // Build a picker modal
    const listHtml = layers.map(l => {
        const isActive = active && l.id === active.id;
        const count = l.geojson?.features?.length || 0;
        return `<button class="coord-layer-pick-btn" data-id="${l.id}" style="
            display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:1px solid var(--border);
            border-radius:6px;background:${isActive ? 'rgba(37,99,235,0.12)' : 'var(--bg-surface)'};cursor:pointer;
            color:var(--text);font-size:13px;text-align:left;
        ">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.name}</span>
            <span style="font-size:10px;color:var(--text-muted);">${count} features</span>
            ${isActive ? '<span style="font-size:9px;color:var(--primary);">active</span>' : ''}
        </button>`;
    }).join('');

    const html = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">
        Select a layer to add the search point to:
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;max-height:300px;overflow-y:auto;">${listHtml}</div>`;

    showModal('Add to Layer', html, {
        width: '360px',
        footer: '<button class="btn btn-secondary cancel-btn">Cancel</button>',
        onMount: (overlay, close) => {
            overlay.querySelector('.cancel-btn')?.addEventListener('click', () => close());
            overlay.querySelectorAll('.coord-layer-pick-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const layer = getLayers().find(l => l.id === btn.dataset.id);
                    if (layer) _addSearchPointToLayer(layer, info);
                    close();
                });
            });
        }
    });
}

function _addSearchPointToLayer(layer, info) {
    const feature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [info.lng, info.lat] },
        properties: {
            name: `Search Point ${(layer.geojson?.features?.length || 0) + 1}`,
            latitude: info.lat.toFixed(6),
            longitude: info.lng.toFixed(6),
            source: info.inputText || ''
        }
    };

    saveSnapshot(layer.id, 'Add search point', layer.geojson);
    layer.geojson.features.push(feature);

    layer.schema = analyzeSchema(layer.geojson);
    bus.emit('layer:updated', layer);
    bus.emit('layers:changed', getLayers());
    mapService.addLayer(layer, getLayers().indexOf(layer));
    refreshUI();

    _clearCoordSearchMarker();
}

function _coordSearchClear() {
    _clearCoordSearchMarker();
}

function _clearCoordSearchMarker() {
    mapService.clearSearchMarker();
    if (dualScreenCoordinator.isActive) {
        dualScreenCoordinator.broadcastDrawCmd({ action: 'clearSearchMarker' });
    }
}

// ============================
// Data Prep tool modals
// ============================

function getFeatures() {
    const layer = getActiveLayer();
    if (!layer) return [];
    if (layer.type === 'spatial') return layer.geojson?.features || [];
    return (layer.rows || []).map(r => ({ type: 'Feature', geometry: null, properties: r }));
}

function getFieldNames() {
    const layer = getActiveLayer();
    return (layer?.schema?.fields || []).map(f => f.name);
}

function applyTransform(name, newFeatures) {
    const layer = getActiveLayer();
    if (!layer) return;
    // Save snapshot before transform
    if (layer.type === 'spatial') {
        saveSnapshot(layer.id, name, layer.geojson);
        layer.geojson = { type: 'FeatureCollection', features: newFeatures };
        layer.schema = analyzeSchema(layer.geojson);
        bus.emit('layer:updated', layer);
        bus.emit('layers:changed', getLayers());
        mapService.addLayer(layer, getLayers().indexOf(layer));
        refreshUI();
    } else if (layer.type === 'table') {
        saveSnapshot(layer.id, name, layer.rows);
        layer.rows = newFeatures.map(f => f.properties ? { ...f.properties } : f);
        layer.schema = analyzeTableSchema(layer.rows, Object.keys(layer.rows[0] || {}));
        bus.emit('layer:updated', layer);
        bus.emit('layers:changed', getLayers());
        refreshUI();
    }
}

// Split Column
async function openSplitColumn() {
    const fields = getFieldNames();
    if (fields.length === 0) return showToast('No fields available', 'warning');

    
        const rootId = `split-column-react-${Date.now()}`;
        showModal('Split Column', `<div id="${rootId}"></div>`, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;
                const { mountSplitColumnDialog } = await import('../../react/tools/mountSplitColumnDialog.jsx');
                const mounted = mountSplitColumnDialog(root, {
                    fields,
                    onCancel: () => close(),
                    onApply: ({ field, delimiter, customDelimiter, trim, maxParts }) => {
                        let delim = delimiter;
                        if (delim === 'custom') delim = customDelimiter || ',';
                        const result = transforms.splitColumn(getFeatures(), field, {
                            delimiter: delim,
                            trim,
                            maxParts: parseInt(maxParts) || 0
                        });
                        applyTransform(`Split: ${field}`, result);
                        close();
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// Combine Columns
async function openCombineColumns() {
    const fields = getFieldNames();
    if (fields.length < 2) return showToast('Need at least 2 fields', 'warning');

    
        const rootId = `combine-columns-react-${Date.now()}`;
        showModal('Combine Columns', `<div id="${rootId}"></div>`, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;
                const { mountCombineColumnsDialog } = await import('../../react/tools/mountCombineColumnsDialog.jsx');
                const mounted = mountCombineColumnsDialog(root, {
                    fields,
                    onCancel: () => close(),
                    onApply: ({ selectedFields, delimiter, outputField, skipBlanks }) => {
                        if (selectedFields.length === 0) return showToast('Select at least one field', 'warning');
                        const result = transforms.combineColumns(getFeatures(), selectedFields, {
                            delimiter,
                            outputField: outputField || 'combined',
                            skipBlanks
                        });
                        applyTransform('Combine columns', result);
                        close();
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// Template Builder
async function openTemplateBuilder() {
    const fields = getFieldNames();
    if (fields.length === 0) return showToast('No fields available', 'warning');
    const features = getFeatures();

    const rootId = `template-builder-react-${Date.now()}`;
    showModal('Template Builder', `<div id="${rootId}"></div>`, {
        width: '650px',
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountTemplateBuilderDialog } = await import('../../react/tools/mountTemplateBuilderDialog.jsx');
            const mounted = mountTemplateBuilderDialog(root, {
                fields,
                features,
                onCancel: () => close(),
                onApply: ({ template, outputField, trimWhitespace, collapseSpaces, removeEmptyWrappers, removeDanglingSeparators, collapseSeparators }) => {
                    if (!template) return showToast('Enter a template', 'warning');
                    const opts = { trimWhitespace, collapseSpaces, removeEmptyWrappers, removeDanglingSeparators, collapseSeparators };
                    const result = applyTemplate(features, template, outputField || 'template_result', opts);
                    applyTransform(`Template: ${outputField || 'template_result'}`, result);
                    close();
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

// Replace/Clean
async function openReplaceClean() {
    const fields = getFieldNames();
    if (fields.length === 0) return showToast('No fields available', 'warning');

    
        const rootId = `replace-clean-react-${Date.now()}`;
        showModal('Replace / Clean Text', `<div id="${rootId}"></div>`, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;
                const { mountReplaceCleanDialog } = await import('../../react/tools/mountReplaceCleanDialog.jsx');
                const mounted = mountReplaceCleanDialog(root, {
                    fields,
                    onCancel: () => close(),
                    onApply: ({ field, find, replace, trimWhitespace, collapseSpaces, caseTransform }) => {
                        const result = transforms.replaceText(getFeatures(), field, {
                            find,
                            replace,
                            trimWhitespace,
                            collapseSpaces,
                            caseTransform: caseTransform || null
                        });
                        applyTransform('Replace/Clean', result);
                        close();
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// Type Convert
async function openTypeConvert() {
    const fields = getFieldNames();

    
        const rootId = `type-convert-react-${Date.now()}`;
        showModal('Type Convert', `<div id="${rootId}"></div>`, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;
                const { mountTypeConvertDialog } = await import('../../react/tools/mountTypeConvertDialog.jsx');
                const mounted = mountTypeConvertDialog(root, {
                    fields,
                    onCancel: () => close(),
                    onApply: ({ field, type }) => {
                        const { features: result, failures } = transforms.typeConvert(
                            getFeatures(),
                            field,
                            type
                        );
                        applyTransform('Type Convert', result);
                        if (failures > 0) showToast(`${failures} values could not be converted`, 'warning');
                        close();
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// Filter Builder
export async function openFilterBuilder(targetLayerId) {
    if (targetLayerId) {
        setActiveLayer(targetLayerId);
        refreshUI();
    }
    const layer = getActiveLayer();
    if (!layer) return showToast('No active layer', 'warning');
    const fields = getFieldNames();
    const existing = layer._activeFilter || null;

    const rootId = `filter-builder-react-${Date.now()}`;
    showModal(existing ? 'Edit Filter' : 'Filter Builder', `<div id="${rootId}"></div>`, {
        width: '650px',
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountFilterBuilderDialog } = await import('../../react/tools/mountFilterBuilderDialog.jsx');
            const mounted = mountFilterBuilderDialog(root, {
                fields,
                operators: transforms.FILTER_OPERATORS,
                existing,
                onCancel: () => close(),
                onRemoveFilter: () => {
                    if (layer._preFilterSnapshot) {
                        saveSnapshot(layer.id, 'Remove Filter', layer.geojson);
                        layer.geojson = JSON.parse(JSON.stringify(layer._preFilterSnapshot));
                        delete layer._activeFilter;
                        delete layer._preFilterSnapshot;
                        layer.schema = analyzeSchema(layer.geojson);
                        bus.emit('layer:updated', layer);
                        bus.emit('layers:changed', getLayers());
                        mapService.addLayer(layer, getLayers().indexOf(layer));
                        refreshUI();
                    } else {
                        showToast('No snapshot ? use Undo to revert', 'info');
                    }
                    close();
                },
                onApply: async ({ rules, logic }) => {
                    const sourceFeatures = layer._preFilterSnapshot
                        ? JSON.parse(JSON.stringify(layer._preFilterSnapshot)).features
                        : getFeatures();
                    if (!layer._preFilterSnapshot) {
                        layer._preFilterSnapshot = JSON.parse(JSON.stringify(layer.geojson));
                    }
                    let result;
                    if (sourceFeatures.length >= transforms.DATAPREP_CHUNK_THRESHOLD) {
                        close();
                        const filtered = await runWithTaskProgress('Filter', async () => {
                            const { TaskRunner } = await import('../core/task-runner.js');
                            const task = new TaskRunner('Filter', 'DataPrep');
                            return task.run((t) => transforms.applyFiltersAsync(sourceFeatures, rules, logic, t));
                        });
                        if (filtered === null) return;
                        result = filtered;
                    } else {
                        result = transforms.applyFilters(sourceFeatures, rules, logic);
                        close();
                    }
                    layer._activeFilter = { rules, logic };
                    applyTransform(`Filter (${result.length} results)`, result);
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

// Deduplicate
async function openDeduplicate() {
    const fields = getFieldNames();

    
        const rootId = `deduplicate-react-${Date.now()}`;
        showModal('Deduplicate', `<div id="${rootId}"></div>`, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;
                const { mountDeduplicateDialog } = await import('../../react/tools/mountDeduplicateDialog.jsx');
                const mounted = mountDeduplicateDialog(root, {
                    fields,
                    onCancel: () => close(),
                    onApply: ({ keyFields, keep }) => {
                        if (keyFields.length === 0) return showToast('Select at least one key field', 'warning');
                        const { features: result, removed } = transforms.deduplicate(
                            getFeatures(),
                            keyFields,
                            keep
                        );
                        applyTransform(`Deduplicate (${removed} removed)`, result);
                        close();
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// Join Tool
async function openJoinTool() {
    const fields = getFieldNames();
    let joinRows = [];

    const rootId = `join-tool-react-${Date.now()}`;
    showModal('Join Tool', `<div id="${rootId}"></div>`, {
        width: '600px',
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountJoinToolDialog } = await import('../../react/tools/mountJoinToolDialog.jsx');
            const mounted = mountJoinToolDialog(root, {
                fields,
                onCancel: () => close(),
                onFileLoad: async (file) => {
                    try {
                        const ds = await importFile(file);
                        joinRows = ds.type === 'spatial'
                            ? ds.geojson.features.map((f) => f.properties)
                            : ds.rows || [];
                        const joinFields = joinRows.length > 0 ? Object.keys(joinRows[0]) : [];
                        showToast(`Loaded ${joinRows.length} rows from ${file.name}`, 'success');
                        return { joinFields, rowCount: joinRows.length };
                    } catch (err) {
                        showToast(`Failed to load join file: ${err.message}`, 'error');
                        return null;
                    }
                },
                onApply: async ({ leftKey, rightKey, fieldsToJoin }) => {
                    const sourceFeatures = getFeatures();
                    let joinResult;
                    if (sourceFeatures.length >= transforms.DATAPREP_CHUNK_THRESHOLD) {
                        close();
                        joinResult = await runWithTaskProgress('Join', async () => {
                            const { TaskRunner } = await import('../core/task-runner.js');
                            const task = new TaskRunner('Join', 'DataPrep');
                            return task.run((t) =>
                                transforms.joinDataAsync(sourceFeatures, joinRows, leftKey, rightKey, fieldsToJoin, t)
                            );
                        });
                        if (joinResult === null) return;
                    } else {
                        joinResult = transforms.joinData(sourceFeatures, joinRows, leftKey, rightKey, fieldsToJoin);
                        close();
                    }
                    const { features: result, matched, unmatched } = joinResult;
                    applyTransform(`Join (${matched} matched, ${unmatched} unmatched)`, result);
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

// Validation
async function openValidation() {
    const fields = getFieldNames();
    const rootId = `validation-react-${Date.now()}`;
    showModal('Validation Rules', `<div id="${rootId}"></div>`, {
        width: '600px',
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountValidationDialog } = await import('../../react/tools/mountValidationDialog.jsx');
            const mounted = mountValidationDialog(root, {
                fields,
                onCancel: () => close(),
                onApply: (rules) => {
                    const errors = transforms.validate(getFeatures(), rules);
                    showToast(`Validation complete: ${errors.length} errors found`, errors.length > 0 ? 'warning' : 'success');
                    if (errors.length > 0) {
                        const detail = errors.slice(0, 20).map((e) => `Row ${e.featureIndex}: ${e.message}`).join('\n');
                        showToast(`First errors:\n${detail}`, 'warning', { duration: 10000 });
                    }
                    close();
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

// Add UID
function addUID() {
    const layer = getActiveLayer();
    if (!layer) return showToast('No active layer', 'warning');
    const result = transforms.addUniqueId(getFeatures(), 'uid', 'uuid');
    applyTransform('Add UID', result);
}

// ============================
// GIS Tool modals
// ============================
async function openBuffer() {
    const layer = await requireSpatialLayer(null, 'buffer');
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    
        const rootId = `buffer-tool-react-${Date.now()}`;
        openToolDialog('Buffer', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountBufferToolDialog } = await import('../../react/tools/mountBufferToolDialog.jsx');
                const mounted = mountBufferToolDialog(root, {
                    selectionCount: mapService.getSelectionCount(layer.id),
                    totalCount: work.totalCount,
                    layerName: layer.name,
                    showLargeDatasetWarning: work.totalCount > 5000,
                    onCancel: () => close(),
                    onApply: async ({ dist, units, applyTo }) => {
                        close();
                        try {
                            const working = await prepareWorkingDataset(layer, applyTo, 'buffer');
                            const result = await runWithTaskProgress('Buffer', () =>
                                gisTools.bufferFeatures(working, dist, units)
                            );
                            if (!result) return;
                            addLayer(result);
                            mapService.addLayer(result, getLayers().indexOf(result), { fit: true });
                            showToast(`Buffer complete ??? new layer "${result.name}" created`, 'success');
                            refreshUI();
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'Buffer'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });

}

async function openReproject() {
    const layer = await requireSpatialLayer();
    if (!layer) return;

    const displayReady = isLayerDisplayReady(layer);
    const crsWarning = displayReady ? '' : layerCrsWarning(layer);

    let sourceCrs = getLayerCrs(layer);
    let sourceCrsError = '';
    try {
        sourceCrs = resolveReprojectFromCrs(layer, layer.geojson);
    } catch (err) {
        sourceCrsError = err?.message || 'Could not determine the layer coordinate system.';
    }

    const rootId = `reproject-tool-react-${Date.now()}`;
    openToolDialog(displayReady ? 'Reproject Layer' : 'Fix Map Display', rootId, {
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;

            const { mountReprojectDialog } = await import('../../react/tools/mountReprojectDialog.jsx');
            const mounted = mountReprojectDialog(root, {
                layerName: layer.name,
                sourceCrs,
                displayReady,
                crsWarning,
                sourceCrsError,
                onCancel: () => close(),
                onApply: async ({ fromCrs, toCrs, name }) => {
                    close();
                    try {
                        const { reprojectLayer } = await import('./reproject.js');
                        const result = await runWithTaskProgress('Reproject', () =>
                            reprojectLayer(layer, { fromCrs, toCrs, name })
                        );
                        if (!result) return;
                        addLayer(result);
                        mapService.addLayer(result, getLayers().indexOf(result), { fit: true });
                        showToast(`Reproject complete — new layer "${result.name}" created`, 'success');
                        refreshUI();
                    } catch (e) {
                        showErrorToast(handleError(e, 'GISTools', 'Reproject'));
                    }
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

async function openSimplify() {
    const layer = await requireSpatialLayer();
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    
        const rootId = `simplify-tool-react-${Date.now()}`;
        openToolDialog('Simplify Geometries', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountSimplifyToolDialog } = await import('../../react/tools/mountSimplifyToolDialog.jsx');
                const mounted = mountSimplifyToolDialog(root, {
                    selectionCount: mapService.getSelectionCount(layer.id),
                    totalCount: work.totalCount,
                    layerName: layer.name,
                    onCancel: () => close(),
                    onApply: async ({ tol, applyTo }) => {
                        close();
                        try {
                            const simplified = await runWithTaskProgress('Simplify', () =>
                                gisTools.simplifyFeatures(getWorkingDataset(layer, applyTo), tol)
                            );
                            if (!simplified) return;
                            const { dataset, stats } = simplified;
                            addLayer(dataset);
                            mapService.addLayer(dataset, getLayers().indexOf(dataset), { fit: true });
                            refreshUI();
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'Simplify'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });

}

async function openClip() {
    const layer = await requireSpatialLayer();
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    
        const rootId = `clip-extent-react-${Date.now()}`;
        openToolDialog('Clip to Current Map Extent', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountClipExtentDialog } = await import('../../react/tools/mountClipExtentDialog.jsx');
                const mounted = mountClipExtentDialog(root, {
                    selectionCount: mapService.getSelectionCount(layer.id),
                    totalCount: work.totalCount,
                    layerName: layer.name,
                    onCancel: () => close(),
                    onApply: async ({ applyTo }) => {
                        close();
                        const bounds = mapService.getBounds();
                        if (!bounds) return showToast('Map bounds not available', 'warning');
                        const bbox = turf.bboxPolygon([
                            bounds.getWest(), bounds.getSouth(),
                            bounds.getEast(), bounds.getNorth()
                        ]);
                        try {
                            const result = await runWithTaskProgress('Clip', () =>
                                gisTools.clipFeatures(getWorkingDataset(layer, applyTo), bbox.geometry)
                            );
                            if (!result) return;
                            addLayer(result);
                            mapService.addLayer(result, getLayers().indexOf(result), { fit: true });
                            refreshUI();
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'Clip'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// ============================
// New Turf.js Geoprocessing Tools
// ============================

const GIS_MAP_API = {
    getSelectionCount: (layerId) => mapService.getSelectionCount(layerId),
    getSelectedIndices: (layerId) => mapService.getSelectedIndices(layerId),
    getSelectedFeatures: (layerId, geojson) => mapService.getSelectedFeatures(layerId, geojson)
};

// Helper: require spatial / live-vector layer (materializes working set for tools)
async function requireSpatialLayer(geomTypes = null, operation = 'generic') {
    const raw = getActiveLayer();
    if (!raw || !isAnalyzableLayer(raw)) {
        showToast('Need a spatial layer', 'warning');
        return null;
    }
    if (typeof turf === 'undefined') {
        showToast('Turf.js not loaded yet', 'warning');
        return null;
    }

    let layer;
    try {
        layer = await materializeForOperation(raw, {
            operation,
            applyTo: 'auto',
            mapApi: GIS_MAP_API,
            projectLayers: getLayers()
        });
    } catch (e) {
        showErrorToast(handleError(e, 'GISTools', 'Load layer'));
        return null;
    }
    if (!layer) {
        showToast('Need a spatial layer', 'warning');
        return null;
    }
    if (isLiveVectorLayer(raw) && !(layer.geojson?.features?.length)) {
        showToast('No live features in the current viewport. Pan/zoom to load data first.', 'warning');
        return null;
    }

    if (geomTypes) {
        const types = Array.isArray(geomTypes) ? geomTypes : [geomTypes];
        const work = getWorkingFeatures(layer);
        const features = work?.geojson?.features || [];
        const has = features.some(f => f.geometry && types.includes(f.geometry.type));
        if (!has) {
            const scope = work?.isSelection ? 'selection' : (work?.isViewport ? 'viewport' : 'layer');
            showToast(`Need ${types.join(' or ')} features in ${scope}`, 'warning');
            return null;
        }
    }
    return layer;
}

function getWorkingFeatures(layer, applyTo = 'auto') {
    return getWorkingFeaturesFromLayer(layer, applyTo, GIS_MAP_API);
}

function getWorkingDataset(layer, applyTo = 'auto') {
    return getWorkingDatasetFromLayer(layer, applyTo, GIS_MAP_API);
}

/**
 * Re-resolve and materialize the working set at apply time (selection / viewport / layer).
 * @param {object} layerHint
 * @param {'auto'|'layer'|'selection'|'viewport'} applyTo
 * @param {string} operation
 */
async function prepareWorkingDataset(layerHint, applyTo = 'auto', operation = 'generic') {
    const raw = getLayers().find((l) => l.id === layerHint?.id) || layerHint;
    const materialized = await materializeForOperation(raw, {
        operation,
        applyTo,
        mapApi: GIS_MAP_API,
        projectLayers: getLayers()
    });
    return getWorkingDatasetFromLayer(materialized, applyTo, GIS_MAP_API);
}

/** @deprecated Selection is always on; clears current selection */
export function toggleSelectionMode() {
    clearSelection();
}

export function clearSelection() {
    mapService.clearSelection();
}

export function selectAllFeatures() {
    const layer = getActiveLayer();
    if (!layer || !isAnalyzableLayer(layer) || !layer.geojson) return;
    mapService.selectAll(layer.id, layer.geojson);
}

/**
 * Menu items for the post box-select actions popup.
 * @param {{ layerId?: string, count?: number, bbox?: number[] }} payload
 */
export function buildSelectionActionMenuItems(payload = {}) {
    const layerId = payload.layerId || getActiveLayer()?.id;
    const layer = layerId ? getLayers().find((l) => l.id === layerId) : getActiveLayer();
    const count = layer ? (mapService.getSelectionCount(layer.id) || payload.count || 0) : 0;
    const handlers = createSelectionActionHandlers({
        getActiveLayer,
        getLayers,
        addLayer,
        mapService,
        refreshUI,
        showToast,
        showErrorToast: (err) => showErrorToast(handleError(err, 'Selection', 'action')),
        confirm,
        clearSelection,
        deleteSelectedFeatures,
        invokeAppAction,
        pickExportCrsModal: async (opts) => {
            const { pickExportCrsModal } = await import('../../react/tools/mountExportCrsDialog.jsx');
            return pickExportCrsModal(opts);
        }
    });

    return buildSelectionActionItems({
        layer,
        count,
        bbox: payload.bbox || mapService.getLastSelectionBbox?.(),
        formats: handlers.getExportFormats(layer),
        targetLayers: getLayers().filter((l) => l.type === 'spatial'),
        attributeFields: layer
            ? attributeFieldsFromSelection(layer, mapService.getSelectedIndices(layer.id) || [])
            : [],
        onInvert: () => handlers.invert(),
        onDelete: () => { void handlers.delete(); },
        onNewLayer: () => handlers.newLayerFromSelected(),
        onClip: () => { void handlers.clipSelectedToBox(); },
        onBulkEdit: () => handlers.bulkEdit(),
        onExport: (format) => { void handlers.exportSelected(format); },
        onCopyAttribute: (fieldName) => { void handlers.copyAttributeToClipboard(fieldName); },
        onCopyToLayer: (id) => handlers.copyToLayer(id),
        onMoveToLayer: (id) => handlers.moveToLayer(id),
        onClear: () => handlers.clear()
    });
}

export function invertSelection() {
    const layer = getActiveLayer();
    if (!layer || !isAnalyzableLayer(layer) || !layer.geojson) return;
    mapService.invertSelection(layer.id, layer.geojson);
}

export async function deleteSelectedFeatures() {
    const layer = getActiveLayer();
    if (!layer || layer.type !== 'spatial') return;
    const indices = mapService.getSelectedIndices(layer.id);
    if (indices.length === 0) return showToast('No features selected', 'warning');
    const ok = await confirm('Delete Features', `Delete ${indices.length} selected feature(s)? This can be undone.`);
    if (!ok) return;

    const selectedSet = new Set(indices);
    const remaining = layer.geojson.features.filter((_, i) => !selectedSet.has(i));
    saveSnapshot(layer.id, `Delete ${indices.length} feature(s)`, layer.geojson);
    layer.geojson = { type: 'FeatureCollection', features: remaining };

    layer.schema = analyzeSchema(layer.geojson);
    bus.emit('layer:updated', layer);
    bus.emit('layers:changed', getLayers());
    mapService.clearSelection(layer.id);
    mapService.addLayer(layer, getLayers().indexOf(layer));
    refreshUI();
    showToast(`Deleted ${indices.length} feature(s)`, 'success');
}

export async function deleteFeatureAt(layerId, featureIndex) {
    const layer = getLayers().find((l) => l.id === layerId);
    if (!layer || !isLayerFeatureDeletable(layer)) return;
    if (featureIndex == null || featureIndex < 0 || featureIndex >= (layer.geojson?.features?.length ?? 0)) {
        return showToast('Feature not found', 'warning');
    }

    const ok = await confirm('Delete Feature', 'Delete this feature? This can be undone.');
    if (!ok) return;

    saveSnapshot(layer.id, 'Delete feature', layer.geojson);
    const remaining = layer.geojson.features.filter((_, i) => i !== featureIndex);
    layer.geojson = { type: 'FeatureCollection', features: remaining };
    layer.schema = analyzeSchema(layer.geojson);
    bus.emit('layer:updated', layer);
    bus.emit('layers:changed', getLayers());
    mapService.clearSelection(layer.id);
    mapService.addLayer(layer, getLayers().indexOf(layer));
    refreshUI();
    showToast('Feature deleted', 'success');
}

function addResultLayer(dataset) {
    addLayer(dataset);
    mapService.addLayer(dataset, getLayers().indexOf(dataset), { fit: true });
    refreshUI();
}

// Helper: convert kilometers to the user-selected unit
function convertKm(km, toUnit) {
    switch (toUnit) {
        case 'feet':  return km * 3280.84;
        case 'meters': return km * 1000;
        case 'miles':  return km * 0.621371;
        default:       return km;
    }
}

// Standard unit select options HTML (feet default)
const UNIT_OPTIONS_HTML = '<option value="feet" selected>Feet</option><option value="meters">Meters</option><option value="miles">Miles</option><option value="kilometers">Kilometers</option>';

function watchOverlayUnmount(overlay, onUnmount) {
    const observer = new MutationObserver(() => {
        if (!document.body.contains(overlay)) {
            try {
                onUnmount?.();
            } finally {
                observer.disconnect();
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// --- Distance ---
async function openDistanceTool() {
    if (typeof turf === 'undefined') return showToast('Turf.js not loaded yet', 'warning');
    
        const rootId = `distance-tool-react-${Date.now()}`;
        openToolDialog('Measure Distance', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountDistanceToolDialog } = await import('../../react/tools/mountDistanceToolDialog.jsx');
                const mounted = mountDistanceToolDialog(root, {
                    onCancel: () => close(),
                    onPick: async (units) => {
                        close();
                        const pts = await mapService.startTwoPointPick('Click the first point', 'Click the second point');
                        if (!pts) return;
                        const d = gisTools.distance(turf.point(pts[0]), turf.point(pts[1]), units);
                        const line = turf.lineString([pts[0], pts[1]]);
                        mapService.showTempFeature(line, 15000);
                        showToast(`Distance: ${d.toFixed(4)} ${units}`, 'success', { duration: 10000 });
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Bearing ---
async function openBearingTool() {
    if (typeof turf === 'undefined') return showToast('Turf.js not loaded yet', 'warning');
    
        const rootId = `bearing-tool-react-${Date.now()}`;
        openToolDialog('Measure Bearing', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountBearingToolDialog } = await import('../../react/tools/mountBearingToolDialog.jsx');
                const mounted = mountBearingToolDialog(root, {
                    onCancel: () => close(),
                    onPick: async () => {
                        close();
                        const pts = await mapService.startTwoPointPick('Click the origin point', 'Click the target point');
                        if (!pts) return;
                        const b = gisTools.bearing(turf.point(pts[0]), turf.point(pts[1]));
                        const line = turf.lineString([pts[0], pts[1]]);
                        mapService.showTempFeature(line, 15000);
                        const cardinal = bearingToCardinal(b);
                        showToast(`Bearing: ${b.toFixed(2)}? (${cardinal})`, 'success', { duration: 10000 });
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

function bearingToCardinal(b) {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    const norm = ((b % 360) + 360) % 360;
    return dirs[Math.round(norm / 22.5) % 16];
}

// --- Destination ---
async function openDestinationTool() {
    if (typeof turf === 'undefined') return showToast('Turf.js not loaded yet', 'warning');
    
        const rootId = `destination-tool-react-${Date.now()}`;
        openToolDialog('Find Destination Point', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountDestinationToolDialog } = await import('../../react/tools/mountDestinationToolDialog.jsx');
                const mounted = mountDestinationToolDialog(root, {
                    onCancel: () => close(),
                    onPick: async ({ dist, brng, units }) => {
                        close();
                        const origin = await mapService.startPointPick('Click the starting point');
                        if (!origin) return;
                        const dest = gisTools.destination(turf.point(origin), dist, brng, units);
                        const line = turf.lineString([origin, dest.geometry.coordinates]);
                        mapService.showTempFeature({ type: 'FeatureCollection', features: [dest, line] }, 15000);
                        showToast(`Destination: [${dest.geometry.coordinates[1].toFixed(6)}, ${dest.geometry.coordinates[0].toFixed(6)}]`, 'success', { duration: 10000 });
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Along ---
async function openAlongTool() {
    const layer = await requireSpatialLayer(['LineString', 'MultiLineString']);
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    
        const rootId = `along-tool-react-${Date.now()}`;
        openToolDialog('Point Along Line', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountAlongToolDialog } = await import('../../react/tools/mountAlongToolDialog.jsx');
                const mounted = mountAlongToolDialog(root, {
                    selectionCount: mapService.getSelectionCount(layer.id),
                    totalCount: work.totalCount,
                    layerName: layer.name,
                    onCancel: () => close(),
                    onPick: ({ dist, units, applyTo }) => {
                        close();
                        const line = findFirstLineStringFeature(getWorkingFeatures(layer, applyTo).geojson);
                        if (!line) return showToast('No LineString or MultiLineString found', 'warning');
                        try {
                            const pt = gisTools.pointAlong(line, dist, units);
                            mapService.showTempFeature(pt, 15000);
                            showToast(`Point at ${dist} ${units}: [${pt.geometry.coordinates[1].toFixed(6)}, ${pt.geometry.coordinates[0].toFixed(6)}]`, 'success', { duration: 8000 });
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'Along'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });

}

// --- Point to Line Distance ---
async function openPointToLineDistanceTool() {
    if (typeof turf === 'undefined') return showToast('Turf.js not loaded yet', 'warning');
    const lineLayerDefs = getLayers()
        .filter((layer) =>
            layer.type === 'spatial'
            && layer.geojson.features.some((f) => f.geometry
                && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')))
        .map((layer) => ({
            id: layer.id,
            name: layer.name,
            count: layer.geojson.features.length
        }));
    if (lineLayerDefs.length === 0) return showToast('Need a line layer loaded', 'warning');

    
        const rootId = `ptl-distance-react-${Date.now()}`;
        openToolDialog('Point to Line Distance', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountPointToLineDistanceDialog } = await import('../../react/tools/mountPointToLineDistanceDialog.jsx');
                const mounted = mountPointToLineDistanceDialog(root, {
                    layers: lineLayerDefs,
                    onCancel: () => close(),
                    onPick: async ({ layerId, units }) => {
                        const lineLayer = getLayers().find((layer) => layer.id === layerId);
                        close();
                        if (!lineLayer) return showToast('Line layer not found', 'warning');
                        const pt = await mapService.startPointPick('Click a point to measure from');
                        if (!pt) return;
                        const lineWhole = lineLayer.geojson.features.find((f) =>
                            f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString'));
                        if (!lineWhole) return showToast('No LineString or MultiLineString found', 'warning');
                        try {
                            const d = gisTools.pointToLineDistance(turf.point(pt), lineWhole, units);
                            const snap = gisTools.nearestPointOnLine(lineWhole, turf.point(pt), units);
                            const connector = turf.lineString([pt, snap.geometry.coordinates]);
                            mapService.showTempFeature({ type: 'FeatureCollection', features: [turf.point(pt), snap, connector] }, 15000);
                            showToast(`Distance to line: ${d.toFixed(4)} ${units}`, 'success', { duration: 10000 });
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'PointToLineDistance'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- BBox Clip (draw rectangle) ---
async function openBboxClip() {
    const layer = await requireSpatialLayer();
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    
        const rootId = `bbox-clip-react-${Date.now()}`;
        openToolDialog('BBox Clip', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountBboxClipDialog } = await import('../../react/tools/mountBboxClipDialog.jsx');
                const mounted = mountBboxClipDialog(root, {
                    selectionCount: mapService.getSelectionCount(layer.id),
                    totalCount: work.totalCount,
                    layerName: layer.name,
                    onCancel: () => close(),
                    onDraw: async ({ applyTo }) => {
                        close();
                        const bbox = await mapService.startRectangleDraw('Click and drag to draw a clip rectangle');
                        if (!bbox) return;
                        try {
                            const result = await runWithTaskProgress('BBox Clip', () =>
                                gisTools.bboxClipFeatures(getWorkingDataset(layer, applyTo), bbox)
                            );
                            if (!result) return;
                            addResultLayer(result);
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'BBoxClip'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Bezier Spline ---
async function openBezierSpline() {
    const layer = await requireSpatialLayer(['LineString', 'MultiLineString']);
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    
        const rootId = `bezier-spline-react-${Date.now()}`;
        openToolDialog('Bezier Spline', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountBezierSplineDialog } = await import('../../react/tools/mountBezierSplineDialog.jsx');
                const mounted = mountBezierSplineDialog(root, {
                    selectionCount: mapService.getSelectionCount(layer.id),
                    totalCount: work.totalCount,
                    layerName: layer.name,
                    onCancel: () => close(),
                    onApply: async ({ res, sharp, applyTo }) => {
                        close();
                        try {
                            const result = await gisTools.bezierSplineFeatures(getWorkingDataset(layer, applyTo), res, sharp);
                            addResultLayer(result);
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'BezierSpline'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });

}

// --- Polygon Smooth ---
async function openPolygonSmooth() {
    const layer = await requireSpatialLayer(['Polygon', 'MultiPolygon']);
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    
        const rootId = `polygon-smooth-react-${Date.now()}`;
        openToolDialog('Polygon Smooth', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountPolygonSmoothDialog } = await import('../../react/tools/mountPolygonSmoothDialog.jsx');
                const mounted = mountPolygonSmoothDialog(root, {
                    selectionCount: mapService.getSelectionCount(layer.id),
                    totalCount: work.totalCount,
                    layerName: layer.name,
                    onCancel: () => close(),
                    onApply: async ({ iter, applyTo }) => {
                        close();
                        try {
                            const result = await runWithTaskProgress('Polygon Smooth', () =>
                                gisTools.polygonSmoothFeatures(getWorkingDataset(layer, applyTo), iter)
                            );
                            if (!result) return;
                            addResultLayer(result);
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'PolygonSmooth'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });

}

// --- Line Offset ---
async function openLineOffset() {
    const layer = await requireSpatialLayer(['LineString', 'MultiLineString']);
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    
        const rootId = `line-offset-react-${Date.now()}`;
        openToolDialog('Line Offset', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountLineOffsetDialog } = await import('../../react/tools/mountLineOffsetDialog.jsx');
                const mounted = mountLineOffsetDialog(root, {
                    selectionCount: mapService.getSelectionCount(layer.id),
                    totalCount: work.totalCount,
                    layerName: layer.name,
                    onCancel: () => close(),
                    onApply: async ({ dist, units, applyTo }) => {
                        close();
                        try {
                            const result = await gisTools.lineOffsetFeatures(getWorkingDataset(layer, applyTo), dist, units);
                            addResultLayer(result);
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'LineOffset'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });

}

// --- Line Slice Along ---
async function openLineSliceAlong() {
    const layer = await requireSpatialLayer(['LineString', 'MultiLineString']);
    if (!layer) return;

    
        const rootId = `line-slice-along-react-${Date.now()}`;
        openToolDialog('Line Slice Along', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountLineSliceAlongDialog } = await import('../../react/tools/mountLineSliceAlongDialog.jsx');
                const mounted = mountLineSliceAlongDialog(root, {
                    onCancel: () => close(),
                    onSlice: ({ start, stop, units }) => {
                        close();
                        const work = getWorkingFeatures(layer);
                        const line = findFirstLineStringFeature(work.geojson);
                        if (!line) return showToast('No LineString or MultiLineString found', 'warning');
                        try {
                            const sliced = gisTools.lineSliceAlong(line, start, stop, units);
                            sliced.properties = { ...line.properties, _sliceStart: start, _sliceStop: stop };
                            const fc = { type: 'FeatureCollection', features: [sliced] };
                            const result = createSpatialDataset(`${layer.name}_slice`, fc, { format: 'derived' });
                            addResultLayer(result);
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'LineSliceAlong'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Line Slice (between two map-clicked points) ---
async function openLineSlice() {
    const layer = await requireSpatialLayer(['LineString', 'MultiLineString']);
    if (!layer) return;

    
        const rootId = `line-slice-react-${Date.now()}`;
        openToolDialog('Line Slice Between Points', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountLineSliceDialog } = await import('../../react/tools/mountLineSliceDialog.jsx');
                const mounted = mountLineSliceDialog(root, {
                    onCancel: () => close(),
                    onPick: async () => {
                        close();
                        const pts = await mapService.startTwoPointPick('Click the start point along the line', 'Click the end point along the line');
                        if (!pts) return;
                        const work = getWorkingFeatures(layer);
                        const line = findFirstLineStringFeature(work.geojson);
                        if (!line) return showToast('No LineString or MultiLineString found', 'warning');
                        try {
                            const sliced = gisTools.lineSlice(turf.point(pts[0]), turf.point(pts[1]), line);
                            sliced.properties = { ...line.properties };
                            const fc = { type: 'FeatureCollection', features: [sliced] };
                            const result = createSpatialDataset(`${layer.name}_sliced`, fc, { format: 'derived' });
                            addResultLayer(result);
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'LineSlice'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Line Intersect ---
async function openLineIntersect() {
    if (typeof turf === 'undefined') return showToast('Turf.js not loaded yet', 'warning');
    const lineLayerDefs = getLayers()
        .filter((layer) =>
            layer.type === 'spatial'
            && layer.geojson.features.some((f) => f.geometry
                && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')))
        .map((layer) => ({
            id: layer.id,
            name: layer.name,
            count: layer.geojson.features.length
        }));
    if (lineLayerDefs.length === 0) return showToast('Need line layers loaded', 'warning');

    
        const rootId = `line-intersect-react-${Date.now()}`;
        openToolDialog('Line Intersect', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountLineIntersectDialog } = await import('../../react/tools/mountLineIntersectDialog.jsx');
                const mounted = mountLineIntersectDialog(root, {
                    layers: lineLayerDefs,
                    onCancel: () => close(),
                    onFind: ({ layerId1, layerId2 }) => {
                        const l1 = getLayers().find((layer) => layer.id === layerId1);
                        const l2 = getLayers().find((layer) => layer.id === layerId2);
                        close();
                        if (!l1 || !l2) return showToast('Select two layers', 'warning');
                        try {
                            const allPts = [];
                            const lines1 = listLineStringFeatures(l1.geojson);
                            const lines2 = listLineStringFeatures(l2.geojson);
                            for (const a of lines1) {
                                for (const b of lines2) {
                                    const pts = gisTools.lineIntersect(a, b);
                                    if (pts?.features) allPts.push(...pts.features);
                                }
                            }
                            const fc = { type: 'FeatureCollection', features: allPts };
                            const result = createSpatialDataset(`intersections_${l1.name}_${l2.name}`, fc, { format: 'derived' });
                            addResultLayer(result);
                            showToast(`Found ${allPts.length} intersection point(s)`, 'success');
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'LineIntersect'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Kinks (self-intersections) ---
async function openKinks() {
    const layer = await requireSpatialLayer();
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    
        const rootId = `kinks-react-${Date.now()}`;
        openToolDialog('Find Kinks (Self-Intersections)', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountKinksDialog } = await import('../../react/tools/mountKinksDialog.jsx');
                const mounted = mountKinksDialog(root, {
                    selectionCount: mapService.getSelectionCount(layer.id),
                    totalCount: work.totalCount,
                    layerName: layer.name,
                    onCancel: () => close(),
                    onFind: async ({ applyTo }) => {
                        close();
                        try {
                            const result = await gisTools.findKinks(getWorkingDataset(layer, applyTo));
                            addResultLayer(result);
                            showToast(`Found ${result.geojson.features.length} kink(s)`, result.geojson.features.length > 0 ? 'warning' : 'success');
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'Kinks'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Combine ---
async function openCombine() {
    const layer = await requireSpatialLayer();
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    
        const rootId = `combine-features-react-${Date.now()}`;
        openToolDialog('Combine Features', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountCombineFeaturesDialog } = await import('../../react/tools/mountCombineFeaturesDialog.jsx');
                const mounted = mountCombineFeaturesDialog(root, {
                    selectionCount: mapService.getSelectionCount(layer.id),
                    totalCount: work.totalCount,
                    layerName: layer.name,
                    onCancel: () => close(),
                    onCombine: ({ applyTo }) => {
                        close();
                        try {
                            const result = gisTools.combineFeatures(getWorkingDataset(layer, applyTo));
                            addResultLayer(result);
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'Combine'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Union ---
async function openUnion() {
    const layer = await requireSpatialLayer(['Polygon', 'MultiPolygon'], 'union');
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    const polyCount = work.geojson.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')).length;
    
        const rootId = `union-polygons-react-${Date.now()}`;
        openToolDialog('Union Polygons', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountUnionPolygonsDialog } = await import('../../react/tools/mountUnionPolygonsDialog.jsx');
                const mounted = mountUnionPolygonsDialog(root, {
                    polygonCount: polyCount,
                    isSelection: work.isSelection,
                    showLargeWarning: polyCount > 500,
                    onCancel: () => close(),
                    onUnion: async () => {
                        close();
                        try {
                            const working = await prepareWorkingDataset(
                                layer,
                                work.isSelection ? 'selection' : 'auto',
                                'union'
                            );
                            const result = await gisTools.unionFeatures(working);
                            addResultLayer(result);
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'Union'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Sample ---
async function openSample() {
    const layer = await requireSpatialLayer();
    if (!layer) return;

    const work = getWorkingFeatures(layer);

    const rootId = `sample-react-${Date.now()}`;
    openToolDialog('Random Sample', rootId, {
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;

            const { mountSampleDialog } = await import('../../react/tools/mountSampleDialog.jsx');
            const mounted = mountSampleDialog(root, {
                selectionCount: mapService.getSelectionCount(layer.id),
                totalCount: work.totalCount,
                layerName: layer.name,
                onCancel: () => close(),
                onApply: async ({ num, applyTo }) => {
                    close();
                    try {
                        const result = await gisTools.sampleFeatures(getWorkingDataset(layer, applyTo), num);
                        addResultLayer(result);
                        showToast(`Sampled ${result.geojson.features.length} feature(s)`, 'success');
                    } catch (e) {
                        showErrorToast(handleError(e, 'GISTools', 'Sample'));
                    }
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

// --- Explode ---
async function openExplode() {
    const layer = await requireSpatialLayer();
    if (!layer) return;

    const work = getWorkingFeatures(layer);

    const rootId = `explode-react-${Date.now()}`;
    openToolDialog('Explode Vertices', rootId, {
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;

            const { mountExplodeDialog } = await import('../../react/tools/mountExplodeDialog.jsx');
            const mounted = mountExplodeDialog(root, {
                selectionCount: mapService.getSelectionCount(layer.id),
                totalCount: work.totalCount,
                layerName: layer.name,
                onCancel: () => close(),
                onApply: async ({ applyTo }) => {
                    close();
                    try {
                        const result = await runWithTaskProgress('Explode', () =>
                            gisTools.explodeFeatures(getWorkingDataset(layer, applyTo))
                        );
                        addResultLayer(result);
                        showToast(`Extracted ${result.geojson.features.length} point(s)`, 'success');
                    } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'Explode'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

const GEOM_FAMILIES = {
    Point: ['Point', 'MultiPoint'],
    LineString: ['LineString', 'MultiLineString'],
    Polygon: ['Polygon', 'MultiPolygon']
};

function listSpatialLayerDefs(geomTypes, excludeId = null) {
    const allowed = new Set();
    for (const type of geomTypes || []) {
        (GEOM_FAMILIES[type] || [type]).forEach((item) => allowed.add(item));
    }
    return getLayers()
        .filter((layer) => {
            if (excludeId && layer.id === excludeId) return false;
            if (layer.type !== 'spatial' || !layer.geojson?.features) return false;
            return layer.geojson.features.some((f) => f.geometry && allowed.has(f.geometry.type));
        })
        .map((layer) => ({
            id: layer.id,
            name: layer.name,
            count: layer.geojson.features.length
        }));
}

async function openPolygonToLine() {
    const layer = await requireSpatialLayer(['Polygon', 'MultiPolygon'], 'polygon-to-line');
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    const rootId = `polygon-to-line-react-${Date.now()}`;
    openToolDialog('Polygon to Line', rootId, {
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountApplyToolDialog } = await import('../../react/tools/mountApplyToolDialog.jsx');
            const mounted = mountApplyToolDialog(root, {
                selectionCount: mapService.getSelectionCount(layer.id),
                totalCount: work.totalCount,
                layerName: layer.name,
                runLabel: 'Convert',
                hint: 'Creates a new line layer from polygon boundaries (outer rings and holes).',
                onCancel: () => close(),
                onApply: async ({ applyTo }) => {
                    close();
                    try {
                        const result = await runWithTaskProgress('Polygon to Line', () =>
                            gisTools.polygonToLineFeatures(getWorkingDataset(layer, applyTo))
                        );
                        if (!result) return;
                        addResultLayer(result);
                        showToast(`Created ${result.geojson.features.length} line(s)`, 'success');
                    } catch (e) {
                        showErrorToast(handleError(e, 'GISTools', 'PolygonToLine'));
                    }
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

async function openFillHoles() {
    const layer = await requireSpatialLayer(['Polygon', 'MultiPolygon'], 'fill-holes');
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    const rootId = `fill-holes-react-${Date.now()}`;
    openToolDialog('Fill Holes', rootId, {
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountApplyToolDialog } = await import('../../react/tools/mountApplyToolDialog.jsx');
            const mounted = mountApplyToolDialog(root, {
                selectionCount: mapService.getSelectionCount(layer.id),
                totalCount: work.totalCount,
                layerName: layer.name,
                runLabel: 'Fill Holes',
                hint: 'Removes interior rings so donut polygons become solid. Creates a new layer.',
                onCancel: () => close(),
                onApply: async ({ applyTo }) => {
                    close();
                    try {
                        const result = await runWithTaskProgress('Fill Holes', () =>
                            gisTools.fillHolesFeatures(getWorkingDataset(layer, applyTo))
                        );
                        if (!result) return;
                        const holesRemoved = result.source?.holesRemoved || 0;
                        if (!holesRemoved) {
                            showToast('No holes found in the selected polygons', 'warning');
                            return;
                        }
                        addResultLayer(result);
                        showToast(`Removed ${holesRemoved} hole${holesRemoved === 1 ? '' : 's'}`, 'success');
                    } catch (e) {
                        showErrorToast(handleError(e, 'GISTools', 'FillHoles'));
                    }
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

async function openSplitPolygonByLine() {
    const layer = await requireSpatialLayer(['Polygon', 'MultiPolygon'], 'split-by-line');
    if (!layer) return;

    const cutterLayers = listSpatialLayerDefs(['LineString'], layer.id);
    if (!cutterLayers.length) return showToast('Need a line layer to cut with', 'warning');

    const work = getWorkingFeatures(layer);
    const rootId = `split-by-line-react-${Date.now()}`;
    openToolDialog('Split Polygon by Line', rootId, {
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountSplitPolygonDialog } = await import('../../react/tools/mountSplitPolygonDialog.jsx');
            const mounted = mountSplitPolygonDialog(root, {
                selectionCount: mapService.getSelectionCount(layer.id),
                totalCount: work.totalCount,
                layerName: layer.name,
                cutterLabel: 'Line layer',
                cutterLayers,
                runLabel: 'Split',
                hint: 'Cuts the active polygon layer wherever the chosen line crosses it. Creates a new layer.',
                onCancel: () => close(),
                onApply: async ({ applyTo, cutterId }) => {
                    close();
                    const cutter = getLayers().find((item) => item.id === cutterId);
                    if (!cutter) return showToast('Select a line layer', 'warning');
                    try {
                        const working = await prepareWorkingDataset(layer, applyTo, 'split-by-line');
                        const cutterWorking = await prepareWorkingDataset(cutter, 'layer', 'split-by-line');
                        const result = await runWithTaskProgress('Split by Line', () =>
                            gisTools.splitPolygonsByLine(working, cutterWorking)
                        );
                        if (!result) return;
                        addResultLayer(result);
                        showToast(`Split into ${result.geojson.features.length} polygon(s)`, 'success');
                    } catch (e) {
                        showErrorToast(handleError(e, 'GISTools', 'SplitByLine'));
                    }
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

async function openSplitPolygonByPolygon() {
    const layer = await requireSpatialLayer(['Polygon', 'MultiPolygon'], 'split-by-polygon');
    if (!layer) return;

    const cutterLayers = listSpatialLayerDefs(['Polygon'], layer.id);
    if (!cutterLayers.length) return showToast('Need another polygon layer to cut with', 'warning');

    const work = getWorkingFeatures(layer);
    const rootId = `split-by-polygon-react-${Date.now()}`;
    openToolDialog('Split Polygon by Polygon', rootId, {
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountSplitPolygonDialog } = await import('../../react/tools/mountSplitPolygonDialog.jsx');
            const mounted = mountSplitPolygonDialog(root, {
                selectionCount: mapService.getSelectionCount(layer.id),
                totalCount: work.totalCount,
                layerName: layer.name,
                cutterLabel: 'Splitter polygon layer',
                cutterLayers,
                runLabel: 'Split',
                hint: 'Cuts the active polygons into overlap and remainder pieces using the splitter layer.',
                onCancel: () => close(),
                onApply: async ({ applyTo, cutterId }) => {
                    close();
                    const cutter = getLayers().find((item) => item.id === cutterId);
                    if (!cutter) return showToast('Select a splitter layer', 'warning');
                    try {
                        const working = await prepareWorkingDataset(layer, applyTo, 'split-by-polygon');
                        const cutterWorking = await prepareWorkingDataset(cutter, 'layer', 'split-by-polygon');
                        const result = await runWithTaskProgress('Split by Polygon', () =>
                            gisTools.splitPolygonsByPolygon(working, cutterWorking)
                        );
                        if (!result) return;
                        addResultLayer(result);
                        showToast(`Split into ${result.geojson.features.length} polygon(s)`, 'success');
                    } catch (e) {
                        showErrorToast(handleError(e, 'GISTools', 'SplitByPolygon'));
                    }
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

async function openVertexReshape() {
    const layer = getActiveLayer();
    if (!layer || !isAnalyzableLayer(layer)) return showToast('Need a spatial layer', 'warning');
    if (isWorkspaceLayer(layer) || isLiveVectorLayer(layer)) {
        return showToast('Vertex reshape needs an in-memory layer. Copy this layer first.', 'warning');
    }
    const hasEditable = layer.geojson?.features?.some((f) => (
        f.geometry && ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(f.geometry.type)
    ));
    if (!hasEditable) return showToast('Need a polygon or line layer', 'warning');

    const rootId = `vertex-reshape-react-${Date.now()}`;
    openToolDialog('Vertex Reshape', rootId, {
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountVertexReshapeDialog } = await import('../../react/tools/mountVertexReshapeDialog.jsx');
            const mounted = mountVertexReshapeDialog(root, {
                layerName: layer.name,
                onCancel: () => close(),
                onStart: () => {
                    close();
                    setActiveLayer(layer.id);
                    refreshUI();
                    _openDrawToolbarOnMap(layer.id, layer.name, 'select');
                    showToast('Click a feature, then drag vertices. Close Draw when done.', 'info');
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

// --- Dissolve ---
async function openDissolve() {
    const layer = await requireSpatialLayer(['Polygon', 'MultiPolygon'], 'dissolve');
    if (!layer) return;

    const work = getWorkingFeatures(layer);
    
        const rootId = `dissolve-react-${Date.now()}`;
        openToolDialog('Dissolve', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountDissolveDialog } = await import('../../react/tools/mountDissolveDialog.jsx');
                const mounted = mountDissolveDialog(root, {
                    fields: layer.schema?.fields || [],
                    selectionCount: mapService.getSelectionCount(layer.id),
                    totalCount: work.totalCount,
                    layerName: layer.name,
                    onCancel: () => close(),
                    onDissolve: async ({ field, applyTo }) => {
                        close();
                        try {
                            const working = await prepareWorkingDataset(layer, applyTo, 'dissolve');
                            const result = await runWithTaskProgress('Dissolve', () =>
                                gisTools.dissolveFeatures(working, field)
                            );
                            if (!result) return;
                            addResultLayer(result);
                            refreshUI();
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'Dissolve'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Sector ---
async function openSector() {
    if (typeof turf === 'undefined') return showToast('Turf.js not loaded yet', 'warning');
    
        const rootId = `sector-react-${Date.now()}`;
        openToolDialog('Create Sector', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountSectorDialog } = await import('../../react/tools/mountSectorDialog.jsx');
                const mounted = mountSectorDialog(root, {
                    onCancel: () => close(),
                    onPickCenter: async ({ radius, b1, b2, units }) => {
                        close();
                        const center = await mapService.startPointPick('Click the center point for the sector');
                        if (!center) return;
                        try {
                            const sector = gisTools.createSector(turf.point(center), radius, b1, b2, units);
                            sector.properties = { radius, bearing1: b1, bearing2: b2, units };
                            const fc = { type: 'FeatureCollection', features: [sector] };
                            const result = createSpatialDataset(`sector_${b1}-${b2}`, fc, { format: 'derived' });
                            addResultLayer(result);
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'Sector'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Nearest Point ---
async function openNearestPoint() {
    if (typeof turf === 'undefined') return showToast('Turf.js not loaded yet', 'warning');
    const pointLayerDefs = getLayers()
        .filter((layer) =>
            layer.type === 'spatial'
            && layer.geojson.features.some((f) => f.geometry && f.geometry.type === 'Point'))
        .map((layer) => ({
            id: layer.id,
            name: layer.name,
            count: layer.geojson.features.length
        }));
    if (pointLayerDefs.length === 0) return showToast('Need a point layer loaded', 'warning');

    
        const rootId = `nearest-point-react-${Date.now()}`;
        openToolDialog('Nearest Point', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountNearestPointDialog } = await import('../../react/tools/mountNearestPointDialog.jsx');
                const mounted = mountNearestPointDialog(root, {
                    layers: pointLayerDefs,
                    onCancel: () => close(),
                    onPickLocation: async ({ layerId, units }) => {
                        const ptLayer = getLayers().find((layer) => layer.id === layerId);
                        close();
                        if (!ptLayer) return;
                        const target = await mapService.startPointPick('Click the map to find the nearest point');
                        if (!target) return;
                        try {
                            const nearest = gisTools.nearestPoint(turf.point(target), ptLayer);
                            const line = turf.lineString([target, nearest.geometry.coordinates]);
                            mapService.showTempFeature({ type: 'FeatureCollection', features: [nearest, line] }, 15000);
                            const distKm = nearest.properties.distanceToPoint;
                            const dist = convertKm(distKm, units);
                            const name = nearest.properties.name || nearest.properties.NAME || `Feature ${nearest.properties.featureIndex}`;
                            showToast(`Nearest: "${name}" (${dist?.toFixed(2) || '?'} ${units} away)`, 'success', { duration: 10000 });
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'NearestPoint'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Nearest Point on Line ---
async function openNearestPointOnLine() {
    if (typeof turf === 'undefined') return showToast('Turf.js not loaded yet', 'warning');
    const lineLayerDefs = getLayers()
        .filter((layer) =>
            layer.type === 'spatial'
            && layer.geojson.features.some((f) => f.geometry
                && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')))
        .map((layer) => ({
            id: layer.id,
            name: layer.name,
            count: layer.geojson.features.length
        }));
    if (lineLayerDefs.length === 0) return showToast('Need a line layer loaded', 'warning');

    
        const rootId = `nearest-point-on-line-react-${Date.now()}`;
        openToolDialog('Nearest Point on Line', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountNearestPointOnLineDialog } = await import('../../react/tools/mountNearestPointOnLineDialog.jsx');
                const mounted = mountNearestPointOnLineDialog(root, {
                    layers: lineLayerDefs,
                    onCancel: () => close(),
                    onPickPoint: async ({ layerId, units }) => {
                        const lineLayer = getLayers().find((layer) => layer.id === layerId);
                        close();
                        if (!lineLayer) return;
                        const pt = await mapService.startPointPick('Click the map to snap to the nearest line');
                        if (!pt) return;
                        const lineWhole = lineLayer.geojson.features.find((f) =>
                            f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString'));
                        if (!lineWhole) return showToast('No LineString or MultiLineString found', 'warning');
                        try {
                            const snap = gisTools.nearestPointOnLine(lineWhole, turf.point(pt), 'kilometers');
                            const connector = turf.lineString([pt, snap.geometry.coordinates]);
                            mapService.showTempFeature({ type: 'FeatureCollection', features: [snap, connector] }, 15000);
                            const distKm = snap.properties.dist;
                            const dist = convertKm(distKm, units);
                            showToast(`Snapped to line at ${dist?.toFixed(2) || '?'} ${units}`, 'success', { duration: 10000 });
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'NearestPointOnLine'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Nearest Point to Line ---
async function openNearestPointToLine() {
    if (typeof turf === 'undefined') return showToast('Turf.js not loaded yet', 'warning');
    const pointLayerDefs = getLayers()
        .filter((layer) =>
            layer.type === 'spatial'
            && layer.geojson.features.some((f) => f.geometry && f.geometry.type === 'Point'))
        .map((layer) => ({
            id: layer.id,
            name: layer.name,
            count: layer.geojson.features.length
        }));
    const lineLayerDefs = getLayers()
        .filter((layer) =>
            layer.type === 'spatial'
            && layer.geojson.features.some((f) => f.geometry
                && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')))
        .map((layer) => ({
            id: layer.id,
            name: layer.name,
            count: layer.geojson.features.length
        }));
    if (pointLayerDefs.length === 0 || lineLayerDefs.length === 0) return showToast('Need a point layer and a line layer', 'warning');

    
        const rootId = `nearest-point-to-line-react-${Date.now()}`;
        openToolDialog('Nearest Point to Line', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountNearestPointToLineDialog } = await import('../../react/tools/mountNearestPointToLineDialog.jsx');
                const mounted = mountNearestPointToLineDialog(root, {
                    pointLayers: pointLayerDefs,
                    lineLayers: lineLayerDefs,
                    onCancel: () => close(),
                    onFind: ({ pointLayerId, lineLayerId, units }) => {
                        const ptsLayer = getLayers().find((layer) => layer.id === pointLayerId);
                        const lineLayer = getLayers().find((layer) => layer.id === lineLayerId);
                        close();
                        if (!ptsLayer || !lineLayer) return;
                        const lineWhole = lineLayer.geojson.features.find((f) =>
                            f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString'));
                        if (!lineWhole) return showToast('No LineString or MultiLineString found', 'warning');
                        try {
                            const nearest = gisTools.nearestPointToLine(ptsLayer.geojson, lineWhole);
                            mapService.showTempFeature(nearest, 15000);
                            const name = nearest.properties?.name || nearest.properties?.NAME || 'Unnamed';
                            const distKm = nearest.properties?.dist;
                            const dist = convertKm(distKm, units);
                            showToast(`Nearest to line: "${name}" (${dist?.toFixed(2) || '?'} ${units})`, 'success', { duration: 10000 });
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'NearestPointToLine'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// --- Nearest Neighbor Analysis ---
async function openNearestNeighborAnalysis() {
    const layer = await requireSpatialLayer(['Point']);
    if (!layer) return;

    
        const rootId = `nearest-neighbor-react-${Date.now()}`;
        openToolDialog('Nearest Neighbor Analysis', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountNearestNeighborAnalysisDialog } = await import('../../react/tools/mountNearestNeighborAnalysisDialog.jsx');
                const mounted = mountNearestNeighborAnalysisDialog(root, {
                    onCancel: () => close(),
                    onRun: async () => {
                        close();
                        try {
                            const result = gisTools.nearestNeighborAnalysis(layer);
                            const p = result.properties || result;
                            const pattern = p.zscore < -1.65 ? 'Clustered' : (p.zscore > 1.65 ? 'Dispersed' : 'Random');
                            const featureCount = p.numberOfPoints || layer.geojson.features.filter((f) => f.geometry?.type === 'Point').length;
                            const resultsRootId = `nearest-neighbor-results-react-${Date.now()}`;
                            openToolDialog('Nearest Neighbor Analysis — Results', resultsRootId, {
                                width: '450px',
                                onMount: async (resultsOverlay, close) => {
                                    const resultsRoot = resultsOverlay.querySelector(`#${resultsRootId}`);
                                    if (!resultsRoot) return;
                                    const { mountNearestNeighborResultsDialog } = await import('../../react/tools/mountNearestNeighborResultsDialog.jsx');
                                    const resultsMounted = mountNearestNeighborResultsDialog(resultsRoot, {
                                        pattern,
                                        p,
                                        featureCount,
                                        onCancel: () => close()
                                    });
                                    watchOverlayUnmount(resultsOverlay, () => resultsMounted.unmount?.());
                                }
                            });
                        } catch (e) {
                            showErrorToast(handleError(e, 'GISTools', 'NearestNeighborAnalysis'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// ============================
// Coordinate Converter
// ============================
async function openCoordConverter() {
    const layer = getActiveLayer();
    if (!layer) return showToast('No active layer', 'warning');

    const isSpatial = layer.type === 'spatial';
    const fields = getFieldNames();

    const formats = [
        { id: 'dd', label: 'Decimal Degrees (DD)' },
        { id: 'dms', label: 'Degrees Minutes Seconds (DMS)' },
        { id: 'ddm', label: 'Degrees Decimal Minutes (DDM)' },
        { id: 'utm', label: 'UTM' }
    ];

    const fromFmtOpts = formats.filter(f => f.id !== 'utm')
        .map(f => `<option value="${f.id}">${f.label}</option>`).join('');
    const toFmtOpts = formats.map(f => `<option value="${f.id}" ${f.id === 'dms' ? 'selected' : ''}>${f.label}</option>`).join('');
    const fieldOpts = fields.map(f => `<option value="${f}">${f}</option>`).join('');

    // Auto-detect lat/lon or northing/easting fields
    const { latField: latGuess, lonField: lonGuess } = guessCoordinateFields(fields);

    
        const rootId = `coord-converter-react-${Date.now()}`;
        openToolDialog('Coordinate Converter', rootId, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountCoordConverterDialog } = await import('../../react/tools/mountCoordConverterDialog.jsx');
                const mounted = mountCoordConverterDialog(root, {
                    isSpatial,
                    fields,
                    latGuess,
                    lonGuess,
                    onCancel: () => close(),
                    onConvert: async ({ source, toFormat, prefix, fromFormat, latField, lonField }) => {
                        close();
                        try {
                            const features = getFeatures();

                            const opts = {
                                toFormat,
                                useGeometry: source === 'geometry',
                                fromFormat: source === 'geometry' ? 'dd' : fromFormat,
                                latField: source === 'fields' ? latField : null,
                                lonField: source === 'fields' ? lonField : null,
                                outputPrefix: prefix?.trim() || undefined
                            };

                            const { features: converted, converted: count, failed } = convertFeatureCoords(features, opts);
                            applyTransform('Coordinate Convert', converted);
                            const msg = `Converted ${count} coordinates to ${toFormat.toUpperCase()}`;
                            showToast(failed > 0 ? `${msg} (${failed} failed)` : msg, failed > 0 ? 'warning' : 'success');
                        } catch (e) {
                            showErrorToast(handleError(e, 'Coordinates', 'Convert'));
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// ============================
// Photo Mapper modal
// ============================
export async function openPhotoMapper() {
    
        const rootId = `photo-mapper-react-${Date.now()}`;
        showModal('Photo Mapper', `<div id="${rootId}"></div>`, {
            width: '700px',
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const { mountPhotoMapperDialog } = await import('../../react/tools/mountPhotoMapperDialog.jsx');
                const mounted = mountPhotoMapperDialog(root, {
                    onCancel: () => close(),
                    onProcessFiles: async (files) => processPhotoFilesForReact(files),
                    onConfirm: ({ useFullSize }) => {
                        photoMapper._useFullSize = !!useFullSize;
                        close();
                        showToast('Photos added to map. Use Export to save in any format.', 'success');
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

async function processPhotoFilesCore(files) {
    // Broad filter ??? iOS may report no type for some images
    const imageFiles = files.filter(f =>
        f.type.startsWith('image/') ||
        /\.(jpe?g|png|heic|heif|tiff?|webp|bmp|gif)$/i.test(f.name) ||
        (!f.type && f.size > 0) // iOS sometimes gives no MIME type ??? let it through
    );
    if (imageFiles.length === 0) {
        showToast('No image files found', 'warning');
        return null;
    }

    logger.info('PhotoMapper', 'processPhotoFiles called', {
        count: imageFiles.length,
        names: imageFiles.map(f => f.name).join(', '),
        types: imageFiles.map(f => f.type || 'none').join(', ')
    });

    const progress = showProgressModal('Processing Photos');
    const onPhotoProgress = (data) => progress.update(data.percent, data.step);
    bus.on('task:progress', onPhotoProgress);
    progress.onCancel(() => {
        getActiveTask()?.cancel();
        progress.close();
        bus.off('task:progress', onPhotoProgress);
        showToast('Photo processing cancelled', 'warning');
    });

    try {
        const result = await photoMapper.processPhotos(imageFiles);
        if (!result) return null;

        // Add photos as a layer on the map
        if (result.dataset) {
            addLayer(result.dataset, { activate: true });
            mapService.addLayer(result.dataset, getLayers().indexOf(result.dataset), { fit: true });
            refreshUI();
        }

        if (result.withoutGPS > 0) {
            showToast(`${result.withoutGPS} photo(s) have no GPS data. They won't appear on the map.`, 'warning');
        }

        return result;
    } catch (e) {
        showErrorToast(handleError(e, 'PhotoMapper', 'Process photos'));
        return null;
    } finally {
        progress.close();
        bus.off('task:progress', onPhotoProgress);
    }
}

async function processPhotoFilesForReact(files) {
    return processPhotoFilesCore(files);
}

async function processPhotoFiles(files, modalOverlay) {
    try {
        const result = await processPhotoFilesCore(files);
        if (!result) return null;

        // Show results
        const resultsEl = modalOverlay.querySelector('#photo-results');
        const statsEl = modalOverlay.querySelector('#photo-stats');
        const gridEl = modalOverlay.querySelector('#photo-grid');

        if (resultsEl) resultsEl.classList.remove('hidden');

        statsEl.innerHTML = `
            <span class="badge badge-success">??? ${result.withGPS} with GPS</span>
            <span class="badge badge-warning">???? ${result.withoutGPS} without GPS</span>
            <span class="badge badge-info">${result.photos.length} total</span>`;

        gridEl.innerHTML = result.photos.map(p => `
            <div class="photo-card ${p.hasGPS ? '' : 'no-gps'}" style="position:relative">
                ${p.thumbnailUrl ? `<img src="${p.thumbnailUrl}" alt="${p.filename}">` : '<div style="height:100px;background:#eee;"></div>'}
                <div class="photo-info">${p.filename}</div>
                ${!p.hasGPS ? '<div style="position:absolute;top:4px;right:4px;background:#d97706;color:white;font-size:9px;padding:1px 4px;border-radius:3px;">No GPS</div>' : ''}
            </div>
        `).join('');
        return result;
    } catch (e) {
        showErrorToast(handleError(e, 'PhotoMapper', 'Process photos'));
        return null;
    }
}

// ============================
// GIS Widgets
// ============================
export function getWidgetContext() {
    const { platform, services } = getPlatformBundle({ showToast });
    return createWidgetContext({
        getLayers,
        getLayerById: (id) => getLayers().find((layer) => layer.id === id),
        getActiveLayer,
        mapService,
        addLayer,
        createSpatialDataset,
        refreshUI,
        showToast,
        setActiveLayer: setActiveLayerAndRefresh,
        analyzeSchema,
        turf: globalThis.turf,
        platform,
        services,
        removeLayers: removeLayersWithConfirm,
        openStorageManager
    });
}

/**
 * Browse / remove OPFS preserved import sources and show storage quota.
 */
export async function openStorageManager() {
    const { showModal } = await import('../ui/modals.js');
    const rootId = `storage-manager-${Date.now()}`;
    showModal('Storage', `<div id="${rootId}"></div>`, {
        width: '520px',
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountStorageManagerDialog } = await import('../../react/tools/mountStorageManagerDialog.jsx');
            const {
                getStorageQuotaSummary,
                listPreservedSourcesWithRefs,
                removePreservedSource,
                removeUnreferencedSources,
                formatBytes
            } = await import('../workspace/storage-summary.js');

            const mounted = mountStorageManagerDialog(root, {
                formatBytes,
                onClose: () => close(),
                onLoad: async () => ({
                    quota: await getStorageQuotaSummary(),
                    sources: await listPreservedSourcesWithRefs(getLayers())
                }),
                onRemove: async (key, { referenced } = {}) => {
                    if (referenced) {
                        const ok = await confirm(
                            'Force remove source?',
                            'One or more layers still reference this file. Remove the OPFS copy anyway? Layers stay on the map.',
                            { layer: 'deferred' }
                        );
                        if (!ok) throw new Error('Cancelled');
                        const result = await removePreservedSource(key, getLayers(), { force: true });
                        if (!result.ok) throw new Error(result.reason || 'Remove failed');
                        return;
                    }
                    const result = await removePreservedSource(key, getLayers(), { force: false });
                    if (!result.ok) throw new Error(result.reason || 'Remove failed');
                },
                onRemoveUnreferenced: async () => {
                    const n = await removeUnreferencedSources(getLayers());
                    showToast(
                        n ? `Removed ${n} unreferenced source file${n === 1 ? '' : 's'}` : 'No unreferenced sources',
                        n ? 'success' : 'info'
                    );
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

export function openPresentationLinkBuilderWidget() {
    return openPresentationLinkBuilder(getWidgetContext());
}

export function bootstrapAppFromUrl() {
    bootstrapAppUrl({ mapService, setPanelCollapsed });
    // Phase 5: offer to resume crash/tab-close interrupted stream imports.
    void import('./stream-import-flow.js').then(({ promptInterruptedImports }) => (
        promptInterruptedImports({ refreshUI: () => bus.emit('layers:changed', getLayers()) })
    )).catch(() => { /* non-fatal */ });
}

export async function materializeServiceLayerWithConfirm(layerId) {
    const layer = getLayers().find((entry) => entry.id === layerId);
    if (!layer || !isServiceLayer(layer)) return;
    try {
        const dataset = mapService.materializeServiceLayer(layer);
        addLayer(dataset, { activate: true });
        const layerIdx = getLayers().indexOf(dataset);
        mapService.addLayer(dataset, layerIdx, { fit: true });
        refreshUI();
        showToast(`Materialized ${dataset.geojson.features.length} features to a new layer`, 'success');
    } catch (error) {
        showToast(error?.message || 'Could not materialize layer', 'warning');
    }
}

// ============================
// Import Fence
// ============================
let _fenceBbox = null; // [west, south, east, north] when fence is active
/** @type {null | (() => void)} restore importer after fence draw (dual-screen async) */
let _afterFenceRestore = null;

function hasActiveImportFence() {
    return !!_fenceBbox || mapService.hasImportFence();
}

function clearAfterFenceRestore() {
    _afterFenceRestore = null;
}

function scheduleAfterFenceRestore(restoreFn) {
    _afterFenceRestore = typeof restoreFn === 'function' ? restoreFn : null;
}

function runAfterFenceRestore() {
    const fn = _afterFenceRestore;
    _afterFenceRestore = null;
    if (typeof fn !== 'function') return;
    try {
        fn();
    } catch (e) {
        logger.warn('Import', 'Fence restore failed', { error: e?.message });
    }
}

function maybeReopenImportAfterFence() {
    runAfterFenceRestore();
}

function clearImportFenceState() {
    mapService.clearImportFence();
    _fenceBbox = null;
    updateFenceButtonState();
    if (dualScreenCoordinator.isActive) {
        dualScreenCoordinator.setFenceBbox(null);
        dualScreenCoordinator.broadcastDrawCmd({ action: 'clearFence' });
    }
}

function defaultFenceRestore() {
    _openImportFlowModal();
}

/**
 * Hide importer → draw fence → restore via callback (also on cancel).
 * @param {null | (() => void)} [restore]
 */
export async function startImportFence(restore = null) {
    const restoreFn = typeof restore === 'function' ? restore : defaultFenceRestore;

    if (dualScreenCoordinator.isActive) {
        if (hasActiveImportFence()) {
            const rootId = `import-fence-react-${Date.now()}`;
            showModal('Import Fence', `<div id="${rootId}"></div>`, {
                width: '400px',
                onMount: async (overlay, close) => {
                    const root = overlay.querySelector(`#${rootId}`);
                    if (!root) return;
                    const { mountImportFenceOptionsDialog } = await import('../../react/tools/mountImportFenceOptionsDialog.jsx');
                    const mounted = mountImportFenceOptionsDialog(root, {
                        message: 'An import fence is currently active. All imports are filtered to this area.',
                        onPlaceNewFence: () => {
                            close();
                            scheduleAfterFenceRestore(restoreFn);
                            dualScreenCoordinator.broadcastDrawCmd({ action: 'startFence' });
                            dualScreenCoordinator.focusMapWindow();
                            showToast('Draw the fence on the Dual Screen map window', 'info');
                        },
                        onRemoveFence: () => {
                            clearImportFenceState();
                            close();
                            restoreFn();
                        }
                    });
                    watchOverlayUnmount(overlay, () => mounted.unmount?.());
                }
            });
            return;
        }
        scheduleAfterFenceRestore(restoreFn);
        dualScreenCoordinator.broadcastDrawCmd({ action: 'startFence' });
        dualScreenCoordinator.focusMapWindow();
        showToast('Draw the import fence on the Dual Screen map window', 'info');
        return;
    }

    if (mapService.hasImportFence()) {
        const rootId = `import-fence-react-${Date.now()}`;
        showModal('Import Fence', `<div id="${rootId}"></div>`, {
            width: '400px',
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;
                const { mountImportFenceOptionsDialog } = await import('../../react/tools/mountImportFenceOptionsDialog.jsx');
                const mounted = mountImportFenceOptionsDialog(root, {
                    message: 'An import fence is currently active on the map. All imports (files and ArcGIS) are filtered to this area.',
                    placeNewDescription: 'Remove current fence and draw a new one',
                    clearDescription: 'Clear fence from map — imports will no longer be filtered',
                    onPlaceNewFence: async () => {
                        close();
                        await drawNewFence({ after: restoreFn });
                    },
                    onRemoveFence: () => {
                        clearImportFenceState();
                        close();
                        restoreFn();
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
        return;
    }

    await drawNewFence({ after: restoreFn });
}

/**
 * @param {{ after?: null | (() => void) }} [options]
 */
async function drawNewFence({ after = null } = {}) {
    const bbox = await mapService.startImportFenceDraw();
    if (!bbox) {
        showToast('Fence cancelled', 'info');
        if (typeof after === 'function') after();
        return null;
    }
    _fenceBbox = bbox;
    updateFenceButtonState();
    showToast('Import fence placed — all imports will be filtered to this area', 'success');
    if (typeof after === 'function') after();
    return bbox;
}

export function updateFenceButtonState() {
    const btn = document.getElementById('btn-fence');
    if (!btn) return;
    if (hasActiveImportFence()) {
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-primary');
        btn.innerHTML = '<span class="btn-icon-text">⛶</span><span>Import Fence (active)</span>';
    } else {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        btn.innerHTML = '<span class="btn-icon-text">⛶</span><span>Import Fence</span>';
    }
}

// ============================
// ArcGIS REST Importer modal
// ============================
export async function openArcGISImporter() {
    const spatialFilter = mapService.getImportFenceEsriEnvelope();
    const fenceBadge = spatialFilter ? '<div class="success-box text-xs mb-8" style="padding:6px 10px;">⛶ <strong>Import Fence active</strong> — only features inside the fence will be downloaded from the server.</div>' : '';

    
        const rootId = `arcgis-import-react-${Date.now()}`;
        showModal('ArcGIS REST Import', `<div id="${rootId}"></div>`, {
            width: '600px',
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;

                const startImportLayer = ({ url, name, mode, onProgress, onComplete, onCancelled, onError }) => {
                    if (!url) {
                        showToast('Enter a URL', 'warning');
                        onError?.();
                        return null;
                    }
                    const applyUdotFiberStyle = mode === 'custom';

                    let arcgisTask = null;
                    let onArcgisProgress = null;
                    let arcgisShellClosed = false;
                    let finished = false;

                    const finishOnce = (cb) => {
                        if (finished) return;
                        finished = true;
                        cb?.();
                    };

                    const cleanup = () => {
                        if (onArcgisProgress) {
                            bus.off('task:progress', onArcgisProgress);
                            onArcgisProgress = null;
                        }
                    };

                    const dismissArcgisShell = () => {
                        if (arcgisShellClosed) return;
                        arcgisShellClosed = true;
                        close();
                    };

                    const run = async () => {
                        try {
                            onProgress?.({ percent: 0, step: `Connecting to ${name || 'layer'}...` });
                            const { TaskRunner } = await import('../core/task-runner.js');
                            arcgisTask = new TaskRunner(`Import ${name || 'layer'}`, 'ArcGIS');

                            const bindProgress = (progressUi = null) => {
                                if (onArcgisProgress) {
                                    bus.off('task:progress', onArcgisProgress);
                                }
                                onArcgisProgress = (data) => {
                                    const pct = data?.percent || 0;
                                    const step = data?.step || '';
                                    onProgress?.({ percent: pct, step });
                                    progressUi?.onProgress?.({
                                        percent: pct,
                                        step,
                                        fileName: data?.fileName
                                    });
                                };
                                bus.on('task:progress', onArcgisProgress);
                            };

                            bindProgress();

                            sessionStore.pauseSessionSave();
                            try {
                                await arcgisImporter.fetchMetadata(url);
                                const meta = arcgisImporter.getMetadata();
                                const allFieldNames = (meta.fields || []).map((f) => f.name);

                                const queryOpts = {
                                    outFields: '*',
                                    where: '1=1',
                                    returnGeometry: true,
                                    useWorkspace: arcgisShouldUseWorkspace(meta.totalCount, { spatialFilter }),
                                    displayFields: requiredStyleFieldsFromDrawingInfo(meta.drawingInfo)
                                };
                                if (spatialFilter) queryOpts.spatialFilter = spatialFilter;

                                const applyFieldSelection = (picked) => {
                                    const allSelected = picked.length >= allFieldNames.length
                                        && allFieldNames.every((n) => picked.includes(n));
                                    let selected = allSelected ? null : picked;
                                    selected = mergeArcgisStyleFields(selected, meta.drawingInfo, allFieldNames);
                                    if (applyUdotFiberStyle) {
                                        selected = mergeUdotFiberStyleFields(selected, url, allFieldNames);
                                    }
                                    queryOpts.selectedFields = selected;
                                    queryOpts.outFields = selected
                                        ? arcgisOutFieldsParam(selected, meta.objectIdField)
                                        : '*';
                                    const extra = applyUdotFiberStyle
                                        ? requiredStyleFieldsForUdotFiberLayer(matchUdotFiberLayerUrl(url)?.key)
                                        : [];
                                    const display = [
                                        ...requiredStyleFieldsFromDrawingInfo(meta.drawingInfo),
                                        ...extra
                                    ].filter((name, i, arr) => name && arr.indexOf(name) === i)
                                        .filter((name) => !allFieldNames.length || allFieldNames.includes(name));
                                    queryOpts.displayFields = display.length ? display : null;
                                };

                                const runDownload = async (progressUi = null) => {
                                    bindProgress(progressUi);

                                    if (arcgisNeedsLargeDownloadConfirm(meta, queryOpts)) {
                                        const total = meta.totalCount;
                                        const largeImport = await confirmArcgisLargeImport(
                                            total,
                                            `Import ${name || 'layer'}`
                                        );
                                        if (!largeImport.proceed) {
                                            throw Object.assign(new Error('Cancelled'), { cancelled: true });
                                        }
                                        largeImport.close?.();
                                        queryOpts.allowLargeDownload = true;
                                    }

                                    onProgress?.({ percent: 0, step: 'Starting download...' });
                                    progressUi?.onProgress?.({ percent: 0, step: 'Starting download...' });

                                    const dataset = await arcgisImporter.downloadFeatures(queryOpts, arcgisTask);
                                    if (!dataset || arcgisTask.cancelled) {
                                        throw Object.assign(new Error('Cancelled'), { cancelled: true });
                                    }
                                    if (applyUdotFiberStyle) {
                                        markDatasetForUdotFiberStyle(dataset, url);
                                    }

                                    onProgress?.({ percent: 98, step: 'Adding layer to map...' });
                                    progressUi?.onProgress?.({ percent: 98, step: 'Adding layer to map...' });

                                    const { ids } = await _addImportedDatasets([dataset], { useWorkspace: false });
                                    await mapService.scheduleFitToLayers(ids, { allowZoomOut: false });
                                    const count = isWorkspaceLayer(dataset)
                                        ? (dataset.schema?.featureCount || 0)
                                        : dataset.type === 'spatial'
                                            ? (dataset.geojson?.features?.length || 0)
                                            : (dataset.rows?.length || 0);
                                    showToast(`Imported ${count.toLocaleString()} features: ${dataset.name}`, 'success');
                                    refreshUI();
                                    return { dataset, count };
                                };

                                if (allFieldNames.length > 0) {
                                    dismissArcgisShell();
                                    const { pickImportFieldsModal } = await import('../../react/tools/mountImportFieldPickerDialog.jsx');
                                    const picked = await pickImportFieldsModal({
                                        title: 'ArcGIS attributes',
                                        fields: allFieldNames,
                                        onImport: async (fields, ui) => {
                                            applyFieldSelection(fields);
                                            ui.onCancelReady?.(() => {
                                                arcgisTask?.cancel();
                                                arcgisImporter.cancel();
                                            });
                                            const { dataset, count } = await runDownload(ui);
                                            dismissArcgisShell();
                                            finishOnce(() => onComplete?.({ datasetName: dataset.name, count }));
                                            ui.close?.();
                                        }
                                    });
                                    if (picked === null) {
                                        finishOnce(onCancelled);
                                    }
                                    return;
                                }

                                const { dataset, count } = await runDownload();
                                dismissArcgisShell();
                                finishOnce(() => onComplete?.({ datasetName: dataset.name, count }));
                            } finally {
                                sessionStore.resumeSessionSave(true);
                            }
                        } catch (e) {
                            if (e?.cancelled || arcgisTask?.cancelled) {
                                finishOnce(onCancelled);
                                return;
                            }
                            const classified = handleError(e, 'ArcGIS', 'Import');
                            showErrorToast(classified);
                            finishOnce(() => onError?.(classified));
                        } finally {
                            cleanup();
                        }
                    };

                    void run();
                    return () => {
                        arcgisTask?.cancel();
                        arcgisImporter.cancel();
                        cleanup();
                        finishOnce(onCancelled);
                    };
                };

                const { mountArcGISImporterDialog } = await import('../../react/tools/mountArcGISImporterDialog.jsx');
                const mounted = mountArcGISImporterDialog(root, {
                    endpoints: ARCGIS_ENDPOINTS,
                    hasImportFence: !!spatialFilter,
                    onCancel: () => close(),
                    onImport: startImportLayer
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

function _escapeHtmlModal(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * After importing KML with NetworkLink but no features, offer best-effort fetch of http(s) links.
 */
async function _promptNetworkLinkAfterImport(dataset) {
    const hrefs = dataset._networkLinkHrefs || [];
    if (!hrefs.length) return;

    
        const rootId = `network-links-react-${Date.now()}`;
        await showModal('Network links in KML', `<div id="${rootId}"></div>`, {
            width: '520px',
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;
                const { mountNetworkLinksDialog } = await import('../../react/tools/mountNetworkLinksDialog.jsx');
                const mounted = mountNetworkLinksDialog(root, {
                    hrefs,
                    onDismiss: () => close(),
                    onFetch: async () => {
                        try {
                            const { mergeNetworkLinksIntoDataset } = await import('../import/kml-networklink.js');
                            const { TaskRunner } = await import('../core/task-runner.js');
                            const task = new TaskRunner('Network links', 'Import');
                            const { failures, skippedRelative, addedFeatures, totalFeatures } =
                                await mergeNetworkLinksIntoDataset(dataset, hrefs, task);

                            const layerIdx = getLayers().indexOf(dataset);
                            mapService.removeLayer(dataset.id);
                            mapService.addLayer(dataset, Math.max(0, layerIdx), { fit: totalFeatures > 0 });
                            refreshUI();

                            let msg = `Merged network links: ${addedFeatures} new feature(s); ${totalFeatures} total in layer.`;
                            if (skippedRelative.length) {
                                msg += ` Skipped ${skippedRelative.length} relative URL(s).`;
                            }
                            if (failures.length) {
                                showToast(`${msg} ${failures.length} link(s) failed (see log).`, 'warning');
                                failures.forEach(f => logger.warn('Import', 'NetworkLink fetch failed', { href: f.href, reason: f.reason }));
                            } else if (skippedRelative.length) {
                                showToast(msg, 'warning');
                            } else {
                                showToast(msg, 'success');
                            }
                        } catch (e) {
                            showErrorToast(handleError(e, 'Import', 'networklink'));
                        } finally {
                            close();
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });

    const list = hrefs.map(h =>
        `<li style="word-break:break-all;font-size:11px;">${_escapeHtmlModal(h)}</li>`
    ).join('');
}

// ============================
// Export handler
// ============================
export async function doExport(format) {
    const layer = getActiveLayer();
    if (!layer) return showToast('No active layer', 'warning');

    // KML/KMZ with 2+ layers: offer multi-layer export
    const allLayers = getLayers().filter(l => l.type === 'spatial');
    if ((format === 'kmz' || format === 'kml') && allLayers.length >= 2) {
        const choice = await _showKmzExportPicker(allLayers, layer, format);
        if (choice === null) return; // cancelled
        if (choice === 'active') {
            // fall through to single-layer export below
        } else if (Array.isArray(choice)) {
            // Multi-layer export ??? honor chosen format (KML vs KMZ)
            try {
                const layerData = choice.map(ds => ({
                    dataset: ds,
                    style: mapService.getLayerStyle(ds.id) || {}
                }));
                const fname = choice.length === allLayers.length ? 'All_Layers' : choice.map(l => l.name).join('_').slice(0, 60);
                if (format === 'kml') {
                    await exportMultiLayerKMLFile(layerData, { filename: fname });
                    showToast(`Exported ${choice.length} layers as KML`, 'success');
                } else {
                    await exportMultiLayerKMZFile(layerData, { filename: fname });
                    showToast(`Exported ${choice.length} layers as KMZ`, 'success');
                }
            } catch (e) {
                showErrorToast(handleError(e, 'Export', 'multi-kml-kmz'));
            }
            return;
        }
    }

    const state = getState();
    let ds = layer;

    if (state.agolCompatMode) {
        const { nameMapping } = checkAGOLCompatibility(layer);
        ds = applyAGOLFixes(layer, nameMapping);
    }

    try {
        const layerStyle = mapService.getLayerStyle(layer.id);
        if (layerStyle && isSmartStyleActive(layerStyle) && ['shapefile', 'csv', 'xlsx', 'gpx'].includes(format)) {
            showToast('Smart styling is not included in this format. Use KML, KMZ, or GeoJSON for styled output.', 'info');
        }

        let exportOptions = {};
        if (format === 'shapefile') {
            const { pickExportCrsModal } = await import('../../react/tools/mountExportCrsDialog.jsx');
            const picked = await pickExportCrsModal({
                layerName: ds.name,
                defaultCrs: ds.schema?.crs || 'EPSG:4326'
            });
            if (!picked) return;
            exportOptions = { targetCrs: picked.targetCrs, sourceCrs: ds.schema?.crs };
        }

        let exportFormat = format;
        if (isCoverageRasterLayer(ds) && format === 'kmz') {
            exportFormat = 'coverage-kmz';
            showToast('Exporting coverage as KMZ image overlay.', 'info');
        }

        await exportDataset(ds, exportFormat, exportOptions);
    } catch (e) {
        showErrorToast(handleError(e, 'Export', format));
    }
}

/**
 * Show KMZ/KML export picker: active layer only, or select multiple layers for folders.
 * Returns 'active', array of selected datasets, or null (cancelled).
 */
async function _showKmzExportPicker(allLayers, activeLayer, format) {
    const fmtLabel = format.toUpperCase();
    const ext = format === 'kml' ? 'kml' : 'kmz';

    
        const rootId = `kml-export-picker-react-${Date.now()}`;
        const layers = allLayers.map((layer) => ({
            id: layer.id,
            name: layer.name,
            featureCount: layer.geojson?.features?.length || 0
        }));
        return showModal(`Export ${fmtLabel}`, `<div id="${rootId}"></div>`, {
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;
                const { mountKmlExportPickerDialog } = await import('../../react/tools/mountKmlExportPickerDialog.jsx');
                const mounted = mountKmlExportPickerDialog(root, {
                    layers,
                    activeLayerId: activeLayer.id,
                    activeLayerName: activeLayer.name,
                    ext,
                    onCancel: () => close(null),
                    onActiveOnly: () => close('active'),
                    onWarnNoSelection: () => showToast('Select at least 1 layer', 'warning'),
                    onExportSelected: (selectedLayerIds) => {
                        const selected = allLayers.filter((layer) => selectedLayerIds.includes(layer.id));
                        close(selected);
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

// ============================
// Other handlers
// ============================

// ????????? Draw Layer ?????????
export function createDrawLayer() {
    const activeLayer = getActiveLayer();
    const hasActiveSpatial = activeLayer && activeLayer.type === 'spatial';

    const items = [
        { icon: '????', label: 'New draw layer', desc: 'Create an empty layer and start drawing', action: 'new' },
    ];
    if (hasActiveSpatial) {
        items.push({ icon: '????', label: `Draw on "${activeLayer.name}"`, desc: 'Add features to the active layer', action: 'active' });
    }

    // If no active spatial layer, just create a new one directly
    if (!hasActiveSpatial) {
        _doCreateDrawLayer();
        return;
    }

    
        const rootId = `draw-layer-chooser-react-${Date.now()}`;
        showModal('Draw Features', `<div id="${rootId}"></div>`, {
            width: '380px',
            onMount: async (overlay, close) => {
                const root = overlay.querySelector(`#${rootId}`);
                if (!root) return;
                const { mountDrawLayerChooserDialog } = await import('../../react/tools/mountDrawLayerChooserDialog.jsx');
                const mounted = mountDrawLayerChooserDialog(root, {
                    options: items,
                    onChoose: (action) => {
                        close();
                        if (action === 'new') {
                            _doCreateDrawLayer();
                        } else {
                            openDrawTools(activeLayer.id);
                        }
                    }
                });
                watchOverlayUnmount(overlay, () => mounted.unmount?.());
            }
        });
}

function _doCreateDrawLayer() {
    const geojson = { type: 'FeatureCollection', features: [] };
    const dataset = createSpatialDataset('Draw Layer', geojson, { format: 'draw' });
    dataset._isDrawLayer = true;
    addLayer(dataset);
    setActiveLayer(dataset.id);
    mapService.addLayer(dataset, getLayers().indexOf(dataset), { fit: false });
    refreshUI();
    _openDrawToolbarOnMap(dataset.id, dataset.name);
}

export function startQuickDraw() {
    let layer = findQuickDrawLayer();
    if (!layer) {
        layer = createQuickDrawLayer();
        addLayer(layer);
        mapService.addLayer(layer, getLayers().indexOf(layer), { fit: false });
    }
    setActiveLayer(layer.id);
    refreshUI();
    _openDrawToolbarOnMap(layer.id, layer.name, 'point');
}

function openDrawTools(layerId) {
    const layer = getLayers().find(l => l.id === layerId);
    if (!layer || !isSpatialLayer(layer)) return showToast('Need a spatial layer', 'warning');
    setActiveLayer(layerId);
    refreshUI();
    _openDrawToolbarOnMap(layerId, layer.name);
}

function _openDrawToolbarOnMap(layerId, layerName, startTool = null) {
    if (dualScreenCoordinator.isActive) {
        dualScreenCoordinator.broadcastDrawCmd({ action: 'showToolbar', layerId, layerName, startTool });
        dualScreenCoordinator.focusMapWindow();
        dualScreenCoordinator.broadcastToast(`Draw on: ${layerName}`, 'info');
        return;
    }
    drawManager.showToolbar(layerId, layerName);
    if (startTool) drawManager.startTool(startTool);
}

export async function handleMergeLayers() {
    const layers = getLayers();
    if (layers.length < 2) return showToast('Need at least 2 layers to merge', 'warning');

    const rootId = `merge-layers-react-${Date.now()}`;
    const mergeLayers = layers.map((layer, index) => ({
        index,
        name: layer.name,
        featureCount: layer.type === 'spatial' ? (layer.geojson?.features?.length || 0) : (layer.rows?.length || 0)
    }));
    const result = await showModal('Merge Layers', `<div id="${rootId}"></div>`, {
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountMergeLayersDialog } = await import('../../react/tools/mountMergeLayersDialog.jsx');
            const mounted = mountMergeLayersDialog(root, {
                layers: mergeLayers,
                onCancel: () => close(null),
                onMerge: (selectedIndices) => close(selectedIndices)
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });

    if (!result || result.length < 2) {
        if (result && result.length === 1) showToast('Select at least 2 layers to merge', 'warning');
        return;
    }

    const selected = result.map(i => layers[i]);
    const merged = mergeDatasets(selected);
    addLayer(merged);
    mapService.addLayer(merged, getLayers().indexOf(merged), { fit: true });
    showToast(`Merged ${selected.length} layers ? ${merged.geojson.features.length} features`, 'success');
    refreshUI();
}

export function handleUndo() {
    const entry = undoHistory();
    if (entry) {
        const layer = getLayers().find(l => l.id === entry.layerId);
        if (layer && layer.type === 'spatial') {
            layer.geojson = JSON.parse(JSON.stringify(entry.snapshot));
            layer.schema = analyzeSchema(layer.geojson);
            mapService.addLayer(layer, getLayers().indexOf(layer));
            refreshUI();
            showToast('Undo', 'info', { duration: 1500 });
        } else if (layer && layer.type === 'table') {
            layer.rows = JSON.parse(JSON.stringify(entry.snapshot));
            layer.schema = analyzeTableSchema(layer.rows, Object.keys(layer.rows[0] || {}));
            refreshUI();
            showToast('Undo', 'info', { duration: 1500 });
        }
    }
}

export function handleRedo() {
    const entry = redoHistory();
    if (entry) {
        const layer = getLayers().find(l => l.id === entry.layerId);
        if (layer && layer.type === 'spatial') {
            layer.geojson = JSON.parse(JSON.stringify(entry.snapshot));
            layer.schema = analyzeSchema(layer.geojson);
            mapService.addLayer(layer, getLayers().indexOf(layer));
            refreshUI();
            showToast('Redo', 'info', { duration: 1500 });
        } else if (layer && layer.type === 'table') {
            layer.rows = JSON.parse(JSON.stringify(entry.snapshot));
            layer.schema = analyzeTableSchema(layer.rows, Object.keys(layer.rows[0] || {}));
            refreshUI();
            showToast('Redo', 'info', { duration: 1500 });
        }
    }
}

// ============================
// Feature Editor ? edit a single feature's attributes from popup
// ============================
function _coerceEditedFieldValue(oldVal, newVal) {
    if (oldVal === null || oldVal === undefined) {
        return newVal === '' ? null : newVal;
    }
    if (typeof oldVal === 'number') {
        return newVal === '' ? null : (Number.isNaN(Number(newVal)) ? newVal : Number(newVal));
    }
    if (typeof oldVal === 'boolean') {
        return newVal === 'true' || newVal === '1';
    }
    return newVal;
}

export function openFeatureEditor(layerId, featureIndex) {
    const layers = getLayers();
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return showToast('Layer not found', 'warning');

    if (isWorkspaceLayer(layer)) {
        void openWorkspaceFeatureEditor(layer, featureIndex);
        return;
    }

    if (layer.type !== 'spatial') return showToast('Layer not found', 'warning');

    const feature = layer.geojson?.features?.[featureIndex]
        || layer.geojson?.features?.find((f) => Number(f.properties?._featureIndex) === Number(featureIndex));
    if (!feature) return showToast('Feature not found', 'warning');

    const props = feature.properties || {};
    const fields = Object.keys(props).filter((k) => !k.startsWith('_'));
    const schemaFields = layer.schema?.fields || [];
    const getFieldType = (name) => schemaFields.find((f) => f.name === name)?.type || 'string';
    const geomType = feature.geometry?.type || 'Unknown';

    const rootId = `feature-editor-react-${Date.now()}`;
    showModal('Edit Feature', `<div id="${rootId}"></div>`, {
        width: '420px',
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountFeatureEditorDialog } = await import('../../react/tools/mountFeatureEditorDialog.jsx');
            const mounted = mountFeatureEditorDialog(root, {
                layerName: layer.name,
                featureIndex,
                geomType,
                fields,
                getFieldType,
                getFieldValue: (name) => props[name],
                onError: (msg) => showToast(msg, 'warning'),
                onCancel: () => close(),
                onSave: ({ textValues, attachmentUpdates }) => {
                    saveSnapshot(layer.id, 'Edit Feature', layer.geojson);
                    for (const [field, newVal] of Object.entries(textValues || {})) {
                        props[field] = _coerceEditedFieldValue(props[field], newVal);
                    }
                    for (const [field, data] of Object.entries(attachmentUpdates || {})) {
                        props[field] = data;
                    }
                    layer.schema = analyzeSchema(layer.geojson);
                    bus.emit('layer:updated', layer);
                    bus.emit('layers:changed', getLayers());
                    mapService.addLayer(layer, getLayers().indexOf(layer));
                    refreshUI();
                    close();
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

async function openWorkspaceFeatureEditor(layer, featureIndex) {
    const wsId = layer.workspaceLayerId || layer.id;
    const { getWorkspaceFeatureAttributes } = await import('../workspace/workspace-store.js');
    const props = await getWorkspaceFeatureAttributes(wsId, featureIndex);
    if (!props) return showToast('Feature not found', 'warning');

    const fields = Object.keys(props).filter((k) => !k.startsWith('_'));
    const schemaFields = layer.schema?.fields || [];
    const getFieldType = (name) => schemaFields.find((f) => f.name === name)?.type || 'string';
    const geomType = layer.schema?.geometryType || 'Unknown';
    const idx = Number(featureIndex);

    const rootId = `feature-editor-react-${Date.now()}`;
    showModal('Edit Feature', `<div id="${rootId}"></div>`, {
        width: '420px',
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountFeatureEditorDialog } = await import('../../react/tools/mountFeatureEditorDialog.jsx');
            const mounted = mountFeatureEditorDialog(root, {
                layerName: layer.name,
                featureIndex: idx,
                geomType,
                fields,
                getFieldType,
                getFieldValue: (name) => props[name],
                onError: (msg) => showToast(msg, 'warning'),
                onCancel: () => close(),
                onSave: async ({ textValues, attachmentUpdates }) => {
                    try {
                        const next = { ...props };
                        for (const [field, newVal] of Object.entries(textValues || {})) {
                            next[field] = _coerceEditedFieldValue(next[field], newVal);
                        }
                        for (const [field, data] of Object.entries(attachmentUpdates || {})) {
                            next[field] = data;
                        }
                        await commitWorkspaceFeatureEdit(wsId, idx, next);
                        if (typeof mapService.refreshWorkspaceLayerViewport === 'function') {
                            await mapService.refreshWorkspaceLayerViewport(layer.id);
                        }
                        mapService.refreshLayerData(layer);
                        bus.emit('layer:updated', layer);
                        bus.emit('layers:changed', getLayers());
                        refreshUI();
                        showToast('Feature updated', 'success');
                        close();
                    } catch (e) {
                        showErrorToast(handleError(e, 'Edit Feature', 'workspace'));
                    }
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

/**
 * Move unchecked schema fields from hot → cold storage for a workspace layer.
 * Export still joins cold fields; map/identify keep the slim hot set.
 */
export async function detachUnselectedFieldsForExport() {
    const layer = getActiveLayer();
    if (!layer || !isWorkspaceLayer(layer)) {
        return showToast('Detach for export is only available on workspace layers', 'warning');
    }
    const fields = (layer.schema?.fields || [])
        .filter((f) => f.selected === false && !f.cold)
        .map((f) => f.name);
    if (!fields.length) {
        return showToast('Uncheck fields you want to detach, then try again', 'info');
    }

    const wsId = layer.workspaceLayerId || layer.id;
    const task = new TaskRunner('Detach for export', 'Workspace');
    try {
        const result = await task.run(async (t) => {
            t.updateProgress(5, `Detaching ${fields.length} field(s)…`);
            return detachFieldsForExport(wsId, fields, {
                onProgress: (done, total) => {
                    const pct = total ? Math.round((done / total) * 90) : 50;
                    t.updateProgress(5 + pct, `Detaching… ${done.toLocaleString()}/${total.toLocaleString()}`);
                }
            });
        });
        const { getWorkspaceLayer } = await import('../workspace/workspace-store.js');
        const meta = await getWorkspaceLayer(wsId);
        if (meta?.schema) {
            layer.schema = meta.schema;
            layer.coldFields = meta.coldFields || meta.schema.coldFields;
        }
        bus.emit('layer:updated', layer);
        bus.emit('layers:changed', getLayers());
        refreshUI();
        showToast(
            `Detached ${result.movedFields.length} field(s) for export (${result.featureCount.toLocaleString()} features)`,
            'success'
        );
    } catch (e) {
        showErrorToast(handleError(e, 'Detach for export', wsId));
    }
}

export function showDataTable() {
    const layer = getActiveLayer();
    if (!layer) return;

    if (isWorkspaceLayer(layer)) {
        void showWorkspaceDataTable(layer);
        return;
    }

    const isSpatial = layer.type === 'spatial';
    const features = isSpatial ? (layer.geojson?.features || []) : [];
    const totalCount = isSpatial ? features.length : (layer.rows || []).length;
    const displayRows = isSpatial
        ? features.slice(0, 500)
        : (layer.rows || []).slice(0, 500);

    if (displayRows.length === 0) return showToast('No data to show', 'warning');

    const firstProps = isSpatial ? (displayRows[0]?.properties || {}) : (displayRows[0] || {});
    const fields = Object.keys(firstProps).filter((k) => !k.startsWith('_') && k !== '__lgid');
    const tableRows = displayRows.map((item, index) => {
        if (!isSpatial) return item;
        const props = { ...(item.properties || {}) };
        if (props._featureIndex == null) props._featureIndex = index;
        return props;
    });

    const rootId = `data-table-react-${Date.now()}`;
    showModal(`Data: ${layer.name}`, `<div id="${rootId}"></div>`, {
        width: '90vw',
        onMount: async (overlay, close) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountDataTableDialog } = await import('../../react/tools/mountDataTableDialog.jsx');
            const mounted = mountDataTableDialog(root, {
                layerName: layer.name,
                fields,
                rows: tableRows,
                totalCount,
                filterFields: fields,
                isSpatial,
                onFocusRow: isSpatial
                    ? async ({ featureIndex }) => {
                        mapService.setActiveLayerId?.(layer.id);
                        setActiveLayerAndRefresh(layer.id);
                        const feature = features.find(
                            (f) => Number(f.properties?._featureIndex) === Number(featureIndex)
                        ) || features[featureIndex];
                        if (!feature?.geometry) {
                            throw new Error('Feature geometry not available in memory.');
                        }
                        mapService.focusFeatures?.([feature], { layerId: layer.id, fit: true });
                        if (!mapService.focusFeatures) {
                            mapService.highlightFeature?.(layer.id, featureIndex);
                            mapService.fitToFeatureIndices?.(layer.id, [featureIndex], { mode: 'first' });
                        }
                    }
                    : null,
                onCellEdit: (rowIndex, field, coerced, isFirstEdit, row) => {
                    let target = null;
                    if (isSpatial) {
                        const idx = Number(row?._featureIndex);
                        const feature = Number.isFinite(idx)
                            ? features.find((f) => Number(f.properties?._featureIndex) === idx)
                            : features[rowIndex];
                        target = feature?.properties || null;
                    } else {
                        target = (layer.rows || [])[rowIndex];
                    }
                    if (!target) return;
                    if (isFirstEdit && isSpatial) saveSnapshot(layer.id, 'Edit field data', layer.geojson);
                    target[field] = coerced;
                },
                onClose: ({ dirty: wasDirty }) => {
                    if (wasDirty && isSpatial) {
                        layer.schema = analyzeSchema(layer.geojson);
                        bus.emit('layer:updated', layer);
                        bus.emit('layers:changed', getLayers());
                        mapService.addLayer(layer, getLayers().indexOf(layer));
                        refreshUI();
                    }
                }
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

/**
 * Paged, attributes-only browser for IndexedDB workspace layers.
 * Shows stored rows (incl. cold/detached fields) even when map display is thinned.
 */
async function showWorkspaceDataTable(layer) {
    const workspaceLayerId = layer.workspaceLayerId || layer.id;
    const totalHint = layer.schema?.featureCount
        ?? layer.source?.fullFeatureCount
        ?? null;
    if (totalHint === 0) {
        showToast('No data to show', 'warning');
        return;
    }

    const {
        ATTRIBUTE_TABLE_PAGE_SIZE,
        resolveAttributeTableFields
    } = await import('../workspace/attribute-table.js');
    const {
        loadWorkspaceAttributeTablePage,
        scanWorkspaceAttributeMatches,
        getWorkspaceFeaturesByIndices
    } = await import('../workspace/workspace-store.js');

    const schemaFieldNames = (layer.schema?.fields || [])
        .map((f) => f?.name)
        .filter(Boolean);
    const withSchemaFields = (page) => {
        if (!schemaFieldNames.length || !page) return page;
        page.fields = resolveAttributeTableFields({
            schemaFieldNames,
            coldFields: page.coldFields,
            sampleRows: page.rows,
            includeIdentity: true
        });
        return page;
    };

    const rootId = `data-table-react-${Date.now()}`;
    showModal(`Data: ${layer.name}`, `<div id="${rootId}"></div>`, {
        width: '90vw',
        onMount: async (overlay) => {
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountDataTableDialog } = await import('../../react/tools/mountDataTableDialog.jsx');
            const mounted = mountDataTableDialog(root, {
                layerName: layer.name,
                isSpatial: true,
                readOnly: true,
                includeColdDefault: true,
                pageSize: ATTRIBUTE_TABLE_PAGE_SIZE,
                filterFields: schemaFieldNames,
                statusNote: 'Stored workspace attributes — includes features not currently drawn on the map. Search scans IndexedDB; Zoom loads geometry even when the feature is not currently drawn.',
                onLoadPage: async ({
                    offset,
                    limit,
                    includeCold,
                    matchIndices,
                    sortField,
                    sortDir
                }) => {
                    const page = await loadWorkspaceAttributeTablePage(workspaceLayerId, {
                        offset,
                        limit: limit ?? ATTRIBUTE_TABLE_PAGE_SIZE,
                        includeCold,
                        matchIndices,
                        sortField,
                        sortDir
                    });
                    if (!page.totalCount && !matchIndices) {
                        showToast('No data to show', 'warning');
                    }
                    return withSchemaFields(page);
                },
                onScanMatches: async ({
                    text,
                    field,
                    fieldValue,
                    fieldOp,
                    includeCold,
                    signal,
                    onProgress
                }) => scanWorkspaceAttributeMatches(workspaceLayerId, {
                    text,
                    field,
                    fieldValue,
                    fieldOp
                }, {
                    includeCold,
                    signal,
                    onProgress
                }),
                onFocusRow: async ({ featureIndex }) => {
                    mapService.setActiveLayerId?.(layer.id);
                    setActiveLayerAndRefresh(layer.id);
                    const features = await getWorkspaceFeaturesByIndices(
                        workspaceLayerId,
                        [featureIndex],
                        { includeCold: true }
                    );
                    if (!features.length) {
                        throw new Error('Could not load feature geometry from workspace storage.');
                    }
                    if (typeof mapService.focusFeatures === 'function') {
                        mapService.focusFeatures(features, { layerId: layer.id, fit: true });
                    } else {
                        mapService.showQueryResults?.(layer.id, [featureIndex]);
                        mapService.fitToFeatureIndices?.(layer.id, [featureIndex], { mode: 'first' });
                    }
                },
                onClose: () => {}
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}

// ============================
// Field management
// ============================
export function toggleField(fieldName, selected) {
    const layer = getActiveLayer();
    if (!layer) return;
    const field = layer.schema?.fields?.find(f => f.name === fieldName);
    if (field) {
        field.selected = selected;
        refreshUI();
    }
}

export function selectAllFields(selected) {
    const layer = getActiveLayer();
    if (!layer) return;
    for (const f of (layer.schema?.fields || [])) f.selected = selected;
    refreshUI();
    refreshUI();
}

function filterFields(query) {
    const items = document.querySelectorAll('.field-list-items .field-item');
    const q = query.toLowerCase();
    items.forEach(el => {
        const name = el.dataset.field?.toLowerCase() || '';
        el.style.display = name.includes(q) ? '' : 'none';
    });
}

export function fixAGOL() {
    const layer = getActiveLayer();
    if (!layer) return;
    const { nameMapping } = checkAGOLCompatibility(layer);
    const fixed = applyAGOLFixes(layer, nameMapping);
    Object.assign(layer, fixed);
    layer.schema = analyzeSchema(layer.geojson);
    refreshUI();
    showToast('AGOL fixes applied', 'success');
}

// ============================
// Rename Layer
// ============================
export function renameLayer(layerId, el) {
    const layer = getLayers().find(l => l.id === layerId);
    if (!layer) return;

    // If inline element passed, do inline editing
    if (el && el.nodeType) {
        startInlineEdit(el, layer.name, (newName) => {
            newName = newName.trim();
            if (newName && newName !== layer.name) {
                if (layer._isQuickDrawLayer) clearQuickDrawLayerFlag(layer);
                layer.name = newName;
                refreshUI();
                refreshUI();
            }
        });
        return;
    }

    // Fallback: prompt
    const newName = prompt('Rename layer:', layer.name);
    if (newName && newName.trim() && newName.trim() !== layer.name) {
        if (layer._isQuickDrawLayer) clearQuickDrawLayerFlag(layer);
        layer.name = newName.trim();
        refreshUI();
        refreshUI();
    }
}

// ============================
// Rename Field
// ============================
export function renameField(fieldName, el) {
    const layer = getActiveLayer();
    if (!layer) return;
    const field = layer.schema?.fields?.find(f => f.name === fieldName);
    if (!field) return;

    const currentName = field.outputName || field.name;

    if (el && el.nodeType) {
        startInlineEdit(el, currentName, (newName) => {
            newName = newName.trim();
            if (newName && newName !== currentName) {
                field.outputName = newName;
                refreshUI();
                refreshUI();
            }
        });
        return;
    }

    const newName = prompt('Rename field output name:', currentName);
    if (newName && newName.trim() && newName.trim() !== currentName) {
        field.outputName = newName.trim();
        refreshUI();
        refreshUI();
    }
}

// ============================
// Add New Field
// ============================
export function addField() {
    const layer = getActiveLayer();
    if (!layer) return showToast('No layer selected', 'warning');

    const existingNames = new Set((layer.schema?.fields || []).map(f => f.name));

    const html = `
        <div class="form-group"><label>Field Name</label>
            <input type="text" id="af-name" placeholder="new_field" autofocus></div>
        <div class="form-group"><label>Field Type</label>
            <select id="af-type">
                <option value="string" selected>Text (string)</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="date">Date</option>
                <option value="attachment">Attach Photo (KML/KMZ export only)</option>
            </select></div>
        <div class="form-group" id="af-default-group"><label>Default Value <span class="text-muted text-xs">(optional)</span></label>
            <input type="text" id="af-default" placeholder="Leave blank for empty"></div>
        <div id="af-error" class="text-xs" style="color:var(--error);min-height:18px;"></div>`;

    showModal('Add New Field', html, {
        footer: '<button class="btn btn-secondary cancel-btn">Cancel</button><button class="btn btn-primary apply-btn">Add Field</button>',
        onMount: (overlay, close) => {
            const nameInput = overlay.querySelector('#af-name');
            const typeSelect = overlay.querySelector('#af-type');
            const defaultInput = overlay.querySelector('#af-default');
            const defaultGroup = overlay.querySelector('#af-default-group');
            const errorEl = overlay.querySelector('#af-error');

            // Hide default value for attachment type
            typeSelect.addEventListener('change', () => {
                defaultGroup.style.display = typeSelect.value === 'attachment' ? 'none' : '';
                if (typeSelect.value === 'attachment') defaultInput.value = '';
            });

            overlay.querySelector('.cancel-btn')?.addEventListener('click', () => close());
            overlay.querySelector('.apply-btn')?.addEventListener('click', () => {
                const name = nameInput.value.trim();
                if (!name) { errorEl.textContent = 'Field name is required'; nameInput.focus(); return; }
                if (existingNames.has(name)) { errorEl.textContent = `Field "${name}" already exists`; nameInput.focus(); return; }
                if (/[.\[\]]/.test(name)) { errorEl.textContent = 'Field name cannot contain . [ or ]'; nameInput.focus(); return; }

                const type = typeSelect.value;
                const rawDefault = defaultInput.value;

                // Coerce default value to selected type
                let defaultValue = rawDefault === '' ? null : rawDefault;
                if (type === 'attachment') {
                    defaultValue = null; // Attachments have no default
                } else if (defaultValue !== null) {
                    if (type === 'number') {
                        defaultValue = Number(rawDefault);
                        if (isNaN(defaultValue)) { errorEl.textContent = 'Default value is not a valid number'; defaultInput.focus(); return; }
                    } else if (type === 'boolean') {
                        defaultValue = ['true', '1', 'yes'].includes(rawDefault.toLowerCase());
                    }
                }

                // Add field to schema
                const maxOrder = (layer.schema?.fields || []).reduce((m, f) => Math.max(m, f.order || 0), -1);
                const newField = {
                    name,
                    type,
                    nullCount: defaultValue === null ? (layer.schema?.featureCount || 0) : 0,
                    uniqueCount: defaultValue === null ? 0 : 1,
                    sampleValues: defaultValue !== null ? [defaultValue] : [],
                    min: type === 'number' && defaultValue !== null ? defaultValue : null,
                    max: type === 'number' && defaultValue !== null ? defaultValue : null,
                    selected: true,
                    outputName: name,
                    order: maxOrder + 1
                };
                if (!layer.schema) layer.schema = { fields: [], geometryType: null, featureCount: 0, crs: 'EPSG:4326' };
                layer.schema.fields.push(newField);

                // Populate data in every feature / row
                if (layer.type === 'spatial' && layer.geojson?.features) {
                    for (const feat of layer.geojson.features) {
                        if (!feat.properties) feat.properties = {};
                        feat.properties[name] = defaultValue;
                    }
                } else if (layer.rows) {
                    for (const row of layer.rows) {
                        row[name] = defaultValue;
                    }
                }

                refreshUI();
                refreshUI();
                mapService.refreshLayerData(layer);
                close();
            });

            // Enter key to submit
            const handleEnter = (e) => { if (e.key === 'Enter') overlay.querySelector('.apply-btn').click(); };
            nameInput.addEventListener('keydown', handleEnter);
            defaultInput.addEventListener('keydown', handleEnter);
        }
    });
}

/**
 * Inline editing helper ??? replaces element text with an input
 */
function startInlineEdit(el, currentValue, onSave) {
    if (el.querySelector('input')) return; // already editing

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue;
    input.className = 'inline-rename-input';
    input.style.cssText = 'width:100%;padding:1px 4px;font-size:inherit;font-weight:inherit;border:1px solid var(--primary);border-radius:3px;background:var(--bg-surface);color:var(--text);outline:none;';

    const originalText = el.textContent;
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    const finish = () => {
        const val = input.value;
        el.textContent = val || originalText;
        onSave(val);
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(); }
        if (e.key === 'Escape') { el.textContent = originalText; }
    });
    input.addEventListener('blur', finish, { once: true });
}

// ============================
// Tool Info / Help Guide
// ============================
async function lookupRouteAndMilepostAt(latlng) {
    const { runReverseMilepostLookup } = await import('../ugrc/lookup.js');
    const deps = { showToast };
    return runReverseMilepostLookup(latlng, deps);
}

export function showToolInfo() {
    const rootId = `tool-guide-react-${Date.now()}`;
    return showModal('', `<div id="${rootId}"></div>`, {
        width: '720px',
        layer: 'splash',
        onMount: async (overlay, close) => {
            overlay.querySelector('.modal')?.classList.add('modal--splash');
            const root = overlay.querySelector(`#${rootId}`);
            if (!root) return;
            const { mountToolGuideDialog } = await import('../../react/tools/mountToolGuideDialog.jsx');
            const mounted = mountToolGuideDialog(root, {
                showTitle: true
            });
            watchOverlayUnmount(overlay, () => mounted.unmount?.());
        }
    });
}


export function getAppActions() {
    return APP_ACTIONS;
}

export function invokeAppAction(action, arg) {
    if (!action) return;
    const fn = APP_ACTIONS[action];
    if (typeof fn !== 'function') return;
    if (arg == null) { fn(); return; }
    if (arg === 'true') { fn(true); return; }
    if (arg === 'false') { fn(false); return; }
    fn(arg);
}

const APP_ACTIONS = {
    setActiveLayer: setActiveLayerAndRefresh,
    toggleVisibility: toggleLayerVisibilityAndRender,
    toggleLock: toggleLayerLockAndRender,
    zoomToLayer,
    removeLayer: removeLayerWithConfirm,
    removeLayers: removeLayersWithConfirm,
    moveLayerUp,
    moveLayerDown,
    moveLayerToIndex,
    toggleField, selectAllFields, filterFields,
    renameLayer, renameField,
    addField,
    detachUnselectedFieldsForExport,
    doExport,
    exportProjectKit,
    importProjectKit,
    fixAGOL,
    showDataTable,
    openSplitColumn,
    openCombineColumns,
    openTemplateBuilder,
    openReplaceClean,
    openTypeConvert,
    openFilterBuilder,
    openLayerDisplayModeInfo,
    openDeduplicate,
    openJoinTool,
    openValidation,
    addUID,
    openBuffer,
    openReproject,
    openSimplify,
    openClip,
    openDistanceTool,
    openBearingTool,
    openDestinationTool,
    openAlongTool,
    openPointToLineDistanceTool,
    openBboxClip,
    openBezierSpline,
    openPolygonSmooth,
    openLineOffset,
    openLineSliceAlong,
    openLineSlice,
    openLineIntersect,
    openKinks,
    openCombine,
    openUnion,
    openSample,
    openExplode,
    openPolygonToLine,
    openFillHoles,
    openSplitPolygonByLine,
    openSplitPolygonByPolygon,
    openVertexReshape,
    openDissolve,
    openSector,
    openNearestPoint,
    openNearestPointOnLine,
    openNearestPointToLine,
    openNearestNeighborAnalysis,
    openPhotoMapper: openPhotoMapper,
    openArcGISImporter: openArcGISImporter,
    materializeServiceLayer: materializeServiceLayerWithConfirm,
    startImportFence,
    ...buildWidgetActions(getWidgetContext),
    openPresentationLinkBuilder: openPresentationLinkBuilderWidget,
    openCoordConverter,
    mergeLayers: handleMergeLayers,
    showToolInfo,
    openStorageManager,
    // Selection
    toggleSelectionMode,
    clearSelection,
    selectAllFeatures,
    invertSelection,
    deleteSelectedFeatures,
    deleteFeatureAt,
    openFeatureEditor,
    openDrawTools,
    startQuickDraw,
    createDrawLayer,
    _coordSearchAddNew,
    _coordSearchAddToExisting,
    _coordSearchClear
};

// Floating tooltip portal for geo tool buttons
export function setupTooltipPortal() {
    const portal = document.createElement('div');
    portal.className = 'geo-tip-portal';
    const arrow = document.createElement('div');
    arrow.className = 'tip-arrow';
    portal.appendChild(arrow);
    document.body.appendChild(portal);
    let hideTimeout = null;
    let activeBtn = null;

    function show(btn) {
        const tip = btn.querySelector('.geo-tip');
        if (!tip) return;
        clearTimeout(hideTimeout);
        activeBtn = btn;

        // Set text (keep arrow element)
        // Clear text nodes only, preserve arrow child
        Array.from(portal.childNodes).forEach(n => {
            if (n !== arrow) portal.removeChild(n);
        });
        portal.insertBefore(document.createTextNode(tip.textContent), arrow);

        // Make visible but off-screen for measurement
        portal.style.left = '-9999px';
        portal.style.top = '0px';
        portal.classList.add('visible');

        const rect = btn.getBoundingClientRect();
        const pw = 240;
        const ph = portal.offsetHeight;
        const btnCenterX = rect.left + rect.width / 2;

        // Horizontal: try to center on button, clamp to viewport
        let left = btnCenterX - pw / 2;
        if (left < 8) left = 8;
        if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;

        // Arrow: point at button center relative to tooltip left
        let arrowLeft = btnCenterX - left;
        arrowLeft = Math.max(12, Math.min(pw - 12, arrowLeft));
        arrow.style.left = arrowLeft + 'px';

        portal.style.left = left + 'px';
        portal.style.width = pw + 'px';

        // Vertical: prefer above, fall back to below
        let top = rect.top - ph - 10;
        if (top < 4) {
            top = rect.bottom + 10;
            portal.classList.add('below');
        } else {
            portal.classList.remove('below');
        }
        portal.style.top = top + 'px';
    }

    function hideImmediate() {
        clearTimeout(hideTimeout);
        portal.classList.remove('visible');
        activeBtn = null;
    }

    function hide() {
        hideTimeout = setTimeout(hideImmediate, 100);
    }

    document.addEventListener('pointerenter', (e) => {
        const btn = closestFromEvent(e, '.geo-tool-btn');
        if (btn) {
            show(btn);
        } else if (activeBtn) {
            hideImmediate();
        }
    }, true);
    document.addEventListener('pointerleave', (e) => {
        const btn = closestFromEvent(e, '.geo-tool-btn');
        if (btn && btn === activeBtn) hide();
    }, true);
    document.addEventListener('pointerdown', (e) => {
        const btn = closestFromEvent(e, '.geo-tool-btn');
        if (btn && btn === activeBtn) hideImmediate();
    }, true);
}
