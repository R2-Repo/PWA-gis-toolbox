import mapManager from './map-manager.js';

const METERS_TO_FEET = 3.28084;

export function formatElevationLabel(meters) {
    const m = Math.round(meters);
    const ft = Math.round(meters * METERS_TO_FEET);
    return `${m.toLocaleString()} m (${ft.toLocaleString()} ft)`;
}

export function createMapService({ mapAdapter = mapManager } = {}) {
    return {
        get map() {
            return mapAdapter.map;
        },
        get dataLayers() {
            return mapAdapter.dataLayers;
        },
        init(container) {
            if (!container) {
                throw new Error('MapService.init requires a container element or id');
            }
            return mapAdapter.init(container);
        },
        destroy() {
            return mapAdapter.destroy();
        },
        getMap() {
            return mapAdapter.getMap();
        },
        resize() {
            return mapAdapter.resize();
        },
        addLayer(dataset, colorIndex = 0, options = {}) {
            return mapAdapter.addLayer(dataset, colorIndex, options);
        },
        addLayerIncremental(dataset, colorIndex = 0, options = {}) {
            return mapAdapter.addLayerIncremental(dataset, colorIndex, options);
        },
        addWorkspaceLayer(dataset, colorIndex = 0, options = {}) {
            return mapAdapter.addWorkspaceLayer(dataset, colorIndex, options);
        },
        addServiceLayer(dataset, colorIndex = 0, options = {}) {
            return mapAdapter.addServiceLayer(dataset, colorIndex, options);
        },
        removeServiceLayer(layerId) {
            return mapAdapter.removeServiceLayer(layerId);
        },
        refreshServiceLayer(layerId) {
            return mapAdapter.refreshServiceLayer(layerId);
        },
        materializeServiceLayer(dataset) {
            return mapAdapter.materializeServiceLayer(dataset);
        },
        refreshWorkspaceLayerViewport(layerId) {
            return mapAdapter.refreshWorkspaceLayerViewport(layerId);
        },
        appendFeaturesToLayer(layerId, dataset, rawFeatures, startIndex) {
            return mapAdapter.appendFeaturesToLayer(layerId, dataset, rawFeatures, startIndex);
        },
        removeLayer(layerId) {
            return mapAdapter.removeLayer(layerId);
        },
        toggleLayer(layerId, visible) {
            return mapAdapter.toggleLayer(layerId, visible);
        },
        setLayerScaleRange(layerId, range, latitude) {
            return mapAdapter.setLayerScaleRange(layerId, range, latitude);
        },
        restyleLayer(layerId, dataset, style) {
            return mapAdapter.restyleLayer(layerId, dataset, style);
        },
        refreshLayerData(dataset) {
            return mapAdapter.refreshLayerData(dataset);
        },
        getLayerStyle(layerId) {
            return mapAdapter.getLayerStyle(layerId);
        },
        getLayerDefaultColor(layerId) {
            return mapAdapter.getLayerDefaultColor(layerId);
        },
        setLayerStyle(layerId, style) {
            return mapAdapter.setLayerStyle(layerId, style);
        },
        applyLayerLock(layerId) {
            return mapAdapter.applyLayerLock?.(layerId);
        },
        syncLayerOrder(orderedIds) {
            return mapAdapter.syncLayerOrder(orderedIds);
        },
        getCurrentBasemap() {
            return mapAdapter.currentBasemap;
        },
        setCurrentBasemap(key) {
            mapAdapter.currentBasemap = key;
            return mapAdapter.currentBasemap;
        },
        setBasemap(key) {
            return mapAdapter.setBasemap(key);
        },
        getBasemapTone() {
            return mapAdapter.getBasemapTone?.() ?? { tint: 'default', opacity: 1 };
        },
        setBasemapTone(tone, options) {
            return mapAdapter.setBasemapTone?.(tone, options);
        },
        is3DEnabled() {
            return !!mapAdapter._3dEnabled;
        },
        set3DEnabled(enabled) {
            mapAdapter._3dEnabled = !!enabled;
            if (mapAdapter.map?.loaded?.()) {
                mapAdapter.reconcile3DState({ emitEvent: false });
            }
            return !!mapAdapter._3dEnabled;
        },
        getLayerStyles() {
            return mapAdapter._layerStyles;
        },
        getLayerStylesRecord() {
            const map = mapAdapter._layerStyles;
            if (!map) return {};
            return Object.fromEntries(map.entries());
        },
        setLayerStylesRecord(record = {}) {
            if (!mapAdapter._layerStyles) return;
            mapAdapter._layerStyles.clear();
            for (const [id, style] of Object.entries(record)) {
                mapAdapter._layerStyles.set(id, style);
            }
        },
        enable3D(options = {}) {
            return mapAdapter.enable3D(options);
        },
        stopMapCamera() {
            const map = mapAdapter.getMap?.();
            if (!map) return;
            try {
                map.stop();
            } catch {
                // ignore
            }
        },
        disable3D(options = {}) {
            return mapAdapter.disable3D(options);
        },
        reconcile3DState(options) {
            return mapAdapter.reconcile3DState(options);
        },
        fitToAll() {
            return mapAdapter.fitToAll();
        },
        fitToLayers(layerIds) {
            return mapAdapter.fitToLayers(layerIds);
        },
        scheduleMapFit(request) {
            return mapAdapter.scheduleMapFit(request);
        },
        scheduleFitToLayers(layerIds, options) {
            return mapAdapter.scheduleFitToLayers(layerIds, options);
        },
        fitBounds(bounds, options = {}) {
            const map = mapAdapter.getMap();
            if (!map) return;
            return map.fitBounds(bounds, options);
        },
        getBounds() {
            return mapAdapter.getBounds();
        },
        hasImportFence() {
            return !!mapAdapter.hasImportFence;
        },
        clearImportFence() {
            return mapAdapter.clearImportFence();
        },
        startImportFenceDraw() {
            return mapAdapter.startImportFenceDraw();
        },
        setImportFenceFromBbox(bbox) {
            return mapAdapter.setImportFenceFromBbox(bbox);
        },
        getImportFenceEsriEnvelope() {
            return mapAdapter.getImportFenceEsriEnvelope();
        },
        getSearchLatLng() {
            return mapAdapter.getSearchLatLng();
        },
        clearSearchMarker() {
            return mapAdapter._clearSearchMarker();
        },
        getLayerRecord(layerId) {
            return mapAdapter.dataLayers?.get?.(layerId) ?? null;
        },
        syncAnnotationSources(layerId, geojson) {
            return mapAdapter.syncAnnotationSources?.(layerId, geojson);
        },
        compositeAnnotationOverlay(ctx, pixelScale) {
            return mapAdapter.compositeAnnotationOverlay?.(ctx, pixelScale);
        },
        getLayerIds() {
            return [...(mapAdapter.dataLayers?.keys?.() ?? [])];
        },
        isSelectionMode() {
            return mapAdapter.isSelectionMode();
        },
        setActiveLayerId(layerId) {
            return mapAdapter.setActiveLayerId?.(layerId);
        },
        enablePresentationMultiSelect() {
            return mapAdapter.enablePresentationMultiSelect?.();
        },
        disablePresentationMultiSelect() {
            return mapAdapter.disablePresentationMultiSelect?.();
        },
        isPresentationMultiSelect() {
            return !!mapAdapter.isPresentationMultiSelect?.();
        },
        getActiveLayerId() {
            return mapAdapter._activeLayerId ?? null;
        },
        getTotalSelectionCount() {
            return mapAdapter.getTotalSelectionCount?.() ?? 0;
        },
        selectFeatures(layerId, indices) {
            return mapAdapter.selectFeatures?.(layerId, indices);
        },
        blockSelection() {
            return mapAdapter.blockSelection?.();
        },
        unblockSelection() {
            return mapAdapter.unblockSelection?.();
        },
        isSelectionBlocked() {
            return !mapAdapter.isSelectionMode?.();
        },
        getSelectedIndices(layerId) {
            return mapAdapter.getSelectedIndices(layerId);
        },
        getSelectedFeatures(layerId, geojson) {
            return mapAdapter.getSelectedFeatures(layerId, geojson);
        },
        getSelectionCount(layerId) {
            return mapAdapter.getSelectionCount(layerId);
        },
        getLastSelectionBbox() {
            return mapAdapter.getLastSelectionBbox?.() ?? null;
        },
        clearSelectionBoxOutline() {
            return mapAdapter.clearSelectionBoxOutline?.();
        },
        enterSelectionMode() {
            return mapAdapter.enterSelectionMode();
        },
        exitSelectionMode() {
            return mapAdapter.exitSelectionMode();
        },
        clearSelection(layerId = null) {
            return mapAdapter.clearSelection(layerId);
        },
        selectAll(layerId, geojson) {
            return mapAdapter.selectAll(layerId, geojson);
        },
        invertSelection(layerId, geojson) {
            return mapAdapter.invertSelection(layerId, geojson);
        },
        startPointPick(prompt) {
            return mapAdapter.startPointPick(prompt);
        },
        startContinuousPointPick(prompt, onPoint) {
            return mapAdapter.startContinuousPointPick?.(prompt, onPoint);
        },
        startTwoPointPick(prompt1, prompt2) {
            return mapAdapter.startTwoPointPick(prompt1, prompt2);
        },
        startRouteTwoPointPick(routeLine, prompt1, prompt2, options) {
            return mapAdapter.startRouteTwoPointPick(routeLine, prompt1, prompt2, options);
        },
        startRectangleDraw(prompt) {
            return mapAdapter.startRectangleDraw(prompt);
        },
        startSketchPolygon(options = {}) {
            return mapAdapter.startSketchPolygon(options);
        },
        startSketchPolyline(options = {}) {
            return mapAdapter.startSketchPolyline(options);
        },
        startSketchCirclePolygon(options = {}) {
            return mapAdapter.startSketchCirclePolygon(options);
        },
        showInteractionBanner(text, onCancel) {
            return mapAdapter.showInteractionBanner?.(text, onCancel);
        },
        cancelInteraction() {
            return mapAdapter.cancelInteraction?.();
        },
        highlightFeature(layerId, featureIndex, originalColor) {
            return mapAdapter.highlightFeature?.(layerId, featureIndex, originalColor);
        },
        clearHighlight() {
            return mapAdapter.clearHighlight?.();
        },
        getHighlightedFeature() {
            return mapAdapter.getHighlightedFeature?.();
        },
        getPresentationAnchor() {
            return mapAdapter.getPresentationAnchor?.();
        },
        getPresentationSourceFeatures() {
            return mapAdapter.getPresentationSourceFeatures?.();
        },
        resolveFeaturesByIndices(layerId, indices) {
            return mapAdapter.resolveFeaturesByIndices?.(layerId, indices);
        },
        startPresentationFeaturePick(prompt, options) {
            return mapAdapter.startPresentationFeaturePick?.(prompt, options);
        },
        getActivePopupHit() {
            return mapAdapter.getActivePopupHit?.();
        },
        showTempFeature(geojson, duration, options) {
            return mapAdapter.showTempFeature(geojson, duration, options);
        },
        showQueryResults(layerId, indices) {
            return mapAdapter.showQueryResults?.(layerId, indices);
        },
        clearQueryResults() {
            return mapAdapter.clearQueryResults?.();
        },
        pulseQueryResults(options) {
            return mapAdapter.pulseQueryResults?.(options);
        },
        fitToFeatureIndices(layerId, indices, options) {
            return mapAdapter.fitToFeatureIndices?.(layerId, indices, options);
        },
        showRouteMilepostPreview(geojson, duration) {
            return mapAdapter.showRouteMilepostPreview?.(geojson, duration);
        },
        showWirelessPlanningPreview(geojson, options) {
            return mapAdapter.showWirelessPlanningPreview?.(geojson, options);
        },
        addCoverageHeatmapLayer(dataset, colorIndex, options) {
            return mapAdapter.addCoverageHeatmapLayer?.(dataset, colorIndex, options);
        },
        showProjectStationingPreview(geojson, duration) {
            return mapAdapter.showProjectStationingPreview?.(geojson, duration);
        },
        removeTempFeature(entry) {
            return mapAdapter.removeTempFeature?.(entry);
        },
        clearTempFeatures() {
            return mapAdapter.clearTempFeatures?.();
        },
        hasPopupHits() {
            return Array.isArray(mapAdapter._popupHits) && mapAdapter._popupHits.length > 0;
        },
        cyclePopup(dir = 1) {
            if (!Array.isArray(mapAdapter._popupHits) || mapAdapter._popupHits.length === 0) return;
            const len = mapAdapter._popupHits.length;
            mapAdapter._popupIndex = (mapAdapter._popupIndex + dir + len) % len;
            return mapAdapter._renderCyclePopup?.(mapAdapter._popupRenderOptions || {});
        },
        getPopupMode() {
            return mapAdapter.getPopupMode?.() ?? 'full';
        },
        setPopupMode(mode) {
            return mapAdapter.setPopupMode?.(mode);
        },
        getActivePopupHit() {
            const hits = mapAdapter._popupHits;
            const idx = mapAdapter._popupIndex;
            return hits?.[idx] ?? null;
        },
        closePopup() {
            return mapAdapter._closePopup?.();
        },
        findFeaturesNearClick(latlng, clickedLayerId, clickedFeatureIndex) {
            return mapAdapter._findFeaturesNearClick(latlng, clickedLayerId, clickedFeatureIndex);
        },
        queryFeaturesAtPoint(point, layerIds = null, bufferPx) {
            return mapAdapter._queryFeaturesAtPoint(point, layerIds, bufferPx);
        },
        showMultiPopup(hits, latlng, options = {}) {
            return mapAdapter._showMultiPopup(hits, latlng, options);
        },
        showPopup(feature, layer, latlng, options = {}) {
            return mapAdapter.showPopup(feature, layer, latlng, options);
        },
        isOrbiting() {
            return !!mapAdapter.isOrbiting;
        },
        startCameraOrbit(center) {
            return mapAdapter.startCameraOrbit(center);
        },
        stopCameraOrbit() {
            return mapAdapter.stopCameraOrbit();
        },
        prepareOrbitView(center, options) {
            return mapAdapter.prepareOrbitView(center, options);
        },
        queryElevationAt(lat, lng) {
            return mapAdapter.queryElevationAt?.(lat, lng) ?? null;
        },
        startMeasureFrom(latlng) {
            return mapAdapter.startMeasureFromLatLng?.(latlng);
        },
    };
}

export const mapService = createMapService();
export default mapService;
