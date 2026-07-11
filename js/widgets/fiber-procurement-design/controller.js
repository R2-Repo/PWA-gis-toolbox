/**
 * Fiber Procurement Design controller.
 */

import { openReactIsland } from '../../ui/open-react-island.js';
import { createCenterlineDrawHandlers } from '../map-draw-helpers.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { isProjectStationingCenterline } from '../project-stationing/route-profile.js';
import { markWidgetClosed, upsertWidgetState } from '../widget-state-store.js';
import {
    WIDGET_ID,
    createFiberDesignSession,
    selectStationingSource,
    loadProcurementCatalog,
    addPlanningAlignment,
    placeStructure,
    configureConduitSegment,
    addFiberRoute,
    addPointAsset,
    buildSessionExport,
    serializeDesignSession,
    restoreDesignSession,
    applyStationingToDesign,
    validateDesignSession,
    getActiveAlignment,
    STRUCTURE_TYPES
} from './engine.js';
import { buildAlignmentGeoJson, buildConduitGeoJson, buildFiberGeoJson, buildPointAssetGeoJson } from './export-builder.js';

const PREVIEW_LAYER_PREFIX = 'fiber_design_preview_';
const NEAR_LINE_FT = 50;

function persistSession(session, open = true) {
    upsertWidgetState(WIDGET_ID, {
        open,
        state: serializeDesignSession(session)
    });
}

function clearPreviewLayers(ctx, session) {
    const mapService = ctx.mapService;
    for (const key of ['alignment', 'conduit', 'fiber', 'points']) {
        mapService.removeTempLayer?.(`${PREVIEW_LAYER_PREFIX}${key}`);
    }
}

function renderDesignPreview(ctx, session) {
    clearPreviewLayers(ctx, session);
    const mapService = ctx.mapService;
    const design = session.design || {};

    const layers = [
        { key: 'alignment', data: buildAlignmentGeoJson(design) },
        { key: 'conduit', data: buildConduitGeoJson(design) },
        { key: 'fiber', data: buildFiberGeoJson(design) },
        { key: 'points', data: buildPointAssetGeoJson(design) }
    ];

    for (const layer of layers) {
        if (!layer.data?.features?.length) continue;
        mapService.showTempFeature?.(layer.data, 0, `${PREVIEW_LAYER_PREFIX}${layer.key}`);
    }
}

function syncDesignLayers(ctx, session) {
    const design = session.design || {};
    const exportPackage = buildSessionExport(session);
    const layerDefs = [
        { name: `${session.project.projectName}_Alignments`, data: exportPackage.geojson.alignments },
        { name: `${session.project.projectName}_Conduit`, data: exportPackage.geojson.conduit },
        { name: `${session.project.projectName}_Fiber`, data: exportPackage.geojson.fiber },
        { name: `${session.project.projectName}_Structures`, data: exportPackage.geojson.points }
    ];

    const created = [];
    for (const def of layerDefs) {
        if (!def.data?.features?.length) continue;
        const dataset = ctx.createSpatialDataset(def.name, def.data, { format: 'derived' });
        dataset._fiberDesignProjectId = session.project.projectId;
        ctx.addLayer(dataset);
        ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset));
        created.push(dataset);
    }

    if (created.length) {
        ctx.refreshUI();
        ctx.showToast(`Added ${created.length} design layer(s)`, 'success');
    }

    renderDesignPreview(ctx, session);
    return created;
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

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {{ restoreState?: object }} [options]
 */
export async function openFiberProcurementDesign(ctx, { restoreState = null } = {}) {
    let session = restoreState
        ? restoreDesignSession(restoreState)
        : createFiberDesignSession();

    const centerlineHandlers = createCenterlineDrawHandlers(ctx);
    let placementMode = null;
    let placementResolver = null;

    const cleanupMapModes = () => {
        placementMode = null;
        placementResolver = null;
        ctx.mapService.cancelInteraction?.();
        clearPreviewLayers(ctx, session);
    };

    const waitForMapClick = (mode) => new Promise((resolve, reject) => {
        placementMode = mode;
        placementResolver = resolve;
        const rejectRef = reject;

        const handler = async (event) => {
            try {
                const coordinate = event?.lngLat
                    ? [event.lngLat.lng, event.lngLat.lat]
                    : event?.coordinate;
                if (!coordinate) return;
                ctx.mapService.cancelInteraction?.();
                placementMode = null;
                placementResolver = null;
                resolve(coordinate);
            } catch (err) {
                rejectRef(err);
            }
        };

        ctx.mapService.startMapClick?.({
            bannerText: mode === 'structure'
                ? 'Click on or near the planning alignment to place a structure.'
                : 'Click on the map to place a point asset.',
            onClick: handler
        }) || ctx.mapService.once?.('click', handler);
    });

    await openReactIsland({
        title: 'Fiber Procurement Design',
        width: '620px',
        mountPath: '../../../react/widgets/mountFiberProcurementDesignDialog.jsx',
        mountExport: 'mountFiberProcurementDesignDialog',
        onClose: () => {
            cleanupMapModes();
            markWidgetClosed(WIDGET_ID);
        },
        getProps: (close) => ({
            stationingLayers: getSpatialLayerOptions(ctx).filter((layer) => {
                const full = ctx.getLayerById?.(layer.id) || ctx.getLayers().find((entry) => entry.id === layer.id);
                return isProjectStationingCenterline(full);
            }),
            initialSession: session,
            onCancel: () => {
                cleanupMapModes();
                markWidgetClosed(WIDGET_ID);
                close();
            },
            onCreateProject: (input) => {
                session = createFiberDesignSession(input);
                persistSession(session);
                return session;
            },
            onSelectStationing: (layerId) => {
                session = selectStationingSource(session, ctx.getLayers(), layerId);
                session = applyStationingToDesign(session);
                persistSession(session);
                renderDesignPreview(ctx, session);
                return session;
            },
            onLoadCatalog: () => {
                session = loadProcurementCatalog(session);
                persistSession(session);
                return session;
            },
            onDrawAlignment: async (meta) => {
                const feature = await centerlineHandlers.drawCenterline();
                if (!feature?.geometry) return session;
                session = addPlanningAlignment(session, feature.geometry, meta);
                session = applyStationingToDesign(session);
                persistSession(session);
                renderDesignPreview(ctx, session);
                return session;
            },
            onPlaceStructure: async (assetType) => {
                const coordinate = await waitForMapClick('structure');
                const alignment = getActiveAlignment(session);
                if (!alignment?.geometry) {
                    throw new Error('Draw a planning alignment before placing structures.');
                }
                const lineFeature = ctx.turf.feature(alignment.geometry);
                const point = ctx.turf.point(coordinate);
                const distance = ctx.turf.pointToLineDistance(point, lineFeature, { units: 'feet' });
                if (distance > NEAR_LINE_FT) {
                    throw new Error(`Click within ${NEAR_LINE_FT} ft of the planning alignment.`);
                }
                session = placeStructure(session, assetType, coordinate);
                persistSession(session);
                renderDesignPreview(ctx, session);
                return session;
            },
            onConfigureSegment: (segmentId, patch) => {
                session = configureConduitSegment(session, segmentId, patch);
                persistSession(session);
                renderDesignPreview(ctx, session);
                return session;
            },
            onGenerateFiber: (input) => {
                session = addFiberRoute(session, input);
                persistSession(session);
                renderDesignPreview(ctx, session);
                return session;
            },
            onPlacePointAsset: async (assetName) => {
                const coordinate = await waitForMapClick('point');
                session = addPointAsset(session, {
                    itemId: `asset_${Date.now()}`,
                    assetName,
                    geometry: { type: 'Point', coordinates: coordinate }
                });
                persistSession(session);
                renderDesignPreview(ctx, session);
                return session;
            },
            onExportPackage: () => {
                const exportPackage = buildSessionExport(session);
                const bundle = serializeDesignSession(session);
                downloadTextFile(
                    `${session.project.projectName.replace(/\s+/g, '_')}_project.json`,
                    JSON.stringify(bundle, null, 2),
                    'application/json'
                );
                downloadTextFile(
                    `${session.project.projectName.replace(/\s+/g, '_')}_quantities.csv`,
                    exportPackage.quantitySummaryCsv,
                    'text/csv'
                );
                syncDesignLayers(ctx, session);
                return exportPackage;
            },
            onAddDesignLayers: () => syncDesignLayers(ctx, session),
            onValidate: () => validateDesignSession(session),
            onSaveSession: () => {
                persistSession(session);
                ctx.showToast('Design session saved', 'success');
                return serializeDesignSession(session);
            },
            onRestoreSession: (bundle) => {
                session = restoreDesignSession(bundle);
                persistSession(session);
                renderDesignPreview(ctx, session);
                return session;
            },
            structureTypes: [
                { value: STRUCTURE_TYPES.JUNCTION_BOX, label: 'Junction box' },
                { value: STRUCTURE_TYPES.VAULT, label: 'Vault' }
            ]
        })
    });
}
