/**
 * Dual Screen Mode — MapService decorator.
 * Intercepts map operations while dual-screen is active and relays them to the
 * secondary window protocol, while preserving single-window behavior by default.
 */
import bus from '../core/event-bus.js';

function buildFenceEnvelope(bbox) {
    const [west, south, east, north] = bbox;
    return {
        xmin: west,
        ymin: south,
        xmax: east,
        ymax: north,
        spatialReference: { wkid: 4326 }
    };
}

const ASYNC_MAP_RPC_METHODS = [
    'startPointPick',
    'startTwoPointPick',
    'startRouteTwoPointPick',
    'startRectangleDraw',
    'startSketchPolygon',
    'startSketchPolyline',
    'startSketchCirclePolygon'
];

function cloneJson(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
}

/**
 * @param {object} mapApi - mapService-shaped API object.
 * @param {object} coordinator - dualScreenCoordinator-shaped object.
 * @returns {() => void} uninstall function restoring original methods.
 */
export function installDualScreenMapServiceDecorator(mapApi, coordinator) {
    if (!mapApi || typeof mapApi !== 'object') {
        throw new Error('installDualScreenMapServiceDecorator requires a map API object');
    }
    if (!coordinator || typeof coordinator !== 'object') {
        throw new Error('installDualScreenMapServiceDecorator requires a coordinator object');
    }

    const originals = {
        addLayer: mapApi.addLayer?.bind(mapApi),
        removeLayer: mapApi.removeLayer?.bind(mapApi),
        toggleLayer: mapApi.toggleLayer?.bind(mapApi),
        syncLayerOrder: mapApi.syncLayerOrder?.bind(mapApi),
        refreshLayerData: mapApi.refreshLayerData?.bind(mapApi),
        setLayerStyle: mapApi.setLayerStyle?.bind(mapApi),
        restyleLayer: mapApi.restyleLayer?.bind(mapApi),
        setLayerScaleRange: mapApi.setLayerScaleRange?.bind(mapApi),
        fitToAll: mapApi.fitToAll?.bind(mapApi),
        fitToLayers: mapApi.fitToLayers?.bind(mapApi),
        fitBounds: mapApi.fitBounds?.bind(mapApi),
        setBasemap: mapApi.setBasemap?.bind(mapApi),
        setBasemapTone: mapApi.setBasemapTone?.bind(mapApi),
        enable3D: mapApi.enable3D?.bind(mapApi),
        disable3D: mapApi.disable3D?.bind(mapApi),
        getBounds: mapApi.getBounds?.bind(mapApi),
        resize: mapApi.resize?.bind(mapApi),
        getMap: mapApi.getMap?.bind(mapApi),
        getImportFenceEsriEnvelope: mapApi.getImportFenceEsriEnvelope?.bind(mapApi),
        showTempFeature: mapApi.showTempFeature?.bind(mapApi),
        showRouteMilepostPreview: mapApi.showRouteMilepostPreview?.bind(mapApi),
        showWirelessPlanningPreview: mapApi.showWirelessPlanningPreview?.bind(mapApi),
        showProjectStationingPreview: mapApi.showProjectStationingPreview?.bind(mapApi),
        removeTempFeature: mapApi.removeTempFeature?.bind(mapApi),
        clearTempFeatures: mapApi.clearTempFeatures?.bind(mapApi),
        cancelInteraction: mapApi.cancelInteraction?.bind(mapApi),
        addWorkspaceLayer: mapApi.addWorkspaceLayer?.bind(mapApi),
        addLayerIncremental: mapApi.addLayerIncremental?.bind(mapApi)
    };

    const relayLayerAdd = (dataset, colorIndex = 0, options = {}) => {
        if (options.style) originals.setLayerStyle?.(dataset.id, options.style);
        // fit is carried on LAYER_ADD — do not also broadcastFit (that caused a second jump).
        coordinator.broadcastLayerAdd(dataset, colorIndex, options);
    };

    ASYNC_MAP_RPC_METHODS.forEach((method) => {
        const original = originals[method] ?? mapApi[method]?.bind(mapApi);
        originals[method] = original;
        mapApi[method] = function dualScreenMapRpc(...args) {
            if (!coordinator.isActive) return original?.(...args);
            return coordinator.invokeMapRpc(method, args);
        };
    });

    mapApi.addLayer = function addLayer(dataset, colorIndex = 0, options = {}) {
        if (!coordinator.isActive) return originals.addLayer?.(dataset, colorIndex, options);
        relayLayerAdd(dataset, colorIndex, options);
        return undefined;
    };

    mapApi.addWorkspaceLayer = async function addWorkspaceLayer(dataset, colorIndex = 0, options = {}) {
        if (!coordinator.isActive) return originals.addWorkspaceLayer?.(dataset, colorIndex, options);
        relayLayerAdd(dataset, colorIndex, options);
        return undefined;
    };

    mapApi.addLayerIncremental = async function addLayerIncremental(dataset, colorIndex = 0, options = {}) {
        if (!coordinator.isActive) return originals.addLayerIncremental?.(dataset, colorIndex, options);
        relayLayerAdd(dataset, colorIndex, options);
        return undefined;
    };

    mapApi.removeLayer = function removeLayer(layerId) {
        if (!coordinator.isActive) return originals.removeLayer?.(layerId);
        coordinator.broadcastLayerRemove(layerId);
        return undefined;
    };

    mapApi.toggleLayer = function toggleLayer(layerId, visible) {
        if (!coordinator.isActive) return originals.toggleLayer?.(layerId, visible);
        coordinator.syncLayersChanged();
        return undefined;
    };

    mapApi.syncLayerOrder = function syncLayerOrder(orderedIds) {
        if (!coordinator.isActive) return originals.syncLayerOrder?.(orderedIds);
        coordinator.broadcastLayerOrder(orderedIds);
        return undefined;
    };

    mapApi.setLayerStyle = function setLayerStyle(layerId, style) {
        const result = originals.setLayerStyle?.(layerId, style);
        if (coordinator.isActive) {
            coordinator.broadcastLayerStyle(layerId, style);
            bus.emit('map:styleChanged', { layerId });
        }
        return result;
    };

    mapApi.restyleLayer = function restyleLayer(layerId, dataset, style) {
        originals.setLayerStyle?.(layerId, style);
        if (!coordinator.isActive) return originals.restyleLayer?.(layerId, dataset, style);
        coordinator.broadcastLayerStyle(layerId, style, dataset);
        bus.emit('map:styleChanged', { layerId });
        return undefined;
    };

    mapApi.setLayerScaleRange = function setLayerScaleRange(layerId, range, latitude) {
        if (!coordinator.isActive) {
            return originals.setLayerScaleRange?.(layerId, range, latitude);
        }
        coordinator.broadcastMapCmd('setLayerScaleRange', {
            layerId,
            range: cloneJson(range),
            latitude
        });
        return undefined;
    };

    mapApi.refreshLayerData = function refreshLayerData(dataset) {
        if (!coordinator.isActive) return originals.refreshLayerData?.(dataset);
        coordinator.syncLayersChanged();
        return undefined;
    };

    mapApi.fitToAll = function fitToAll() {
        if (!coordinator.isActive) return originals.fitToAll?.();
        coordinator.broadcastFit('fitAll');
        return undefined;
    };

    mapApi.fitToLayers = function fitToLayers(layerIds) {
        if (!coordinator.isActive) return originals.fitToLayers?.(layerIds);
        coordinator.broadcastFit('fitLayers', { layerIds });
        return undefined;
    };

    mapApi.fitBounds = function fitBounds(bounds, options = {}) {
        if (!coordinator.isActive) return originals.fitBounds?.(bounds, options);
        coordinator.broadcastFit('fitBounds', { bounds, options });
        return undefined;
    };

    mapApi.setBasemap = function setBasemap(key) {
        if (!coordinator.isActive) return originals.setBasemap?.(key);
        mapApi.setCurrentBasemap?.(key);
        coordinator.syncLayersChanged();
        return undefined;
    };

    mapApi.setBasemapTone = function setBasemapTone(tone, options = {}) {
        if (!coordinator.isActive) return originals.setBasemapTone?.(tone, options);
        const result = originals.setBasemapTone?.(tone, options);
        coordinator.syncLayersChanged();
        return result;
    };

    mapApi.enable3D = function enable3D() {
        if (!coordinator.isActive) return originals.enable3D?.();
        mapApi.set3DEnabled?.(true);
        coordinator.syncLayersChanged();
        return undefined;
    };

    mapApi.disable3D = function disable3D() {
        if (!coordinator.isActive) return originals.disable3D?.();
        mapApi.set3DEnabled?.(false);
        coordinator.syncLayersChanged();
        return undefined;
    };

    mapApi.getBounds = function getBounds() {
        if (!coordinator.isActive) return originals.getBounds?.();
        return coordinator.getBounds();
    };

    mapApi.resize = function resize() {
        return originals.resize?.();
    };

    mapApi.getMap = function getMap() {
        if (coordinator.isActive) return null;
        return originals.getMap?.();
    };

    mapApi.getImportFenceEsriEnvelope = function getImportFenceEsriEnvelope() {
        if (coordinator.isActive && coordinator._fenceBbox) {
            return buildFenceEnvelope(coordinator._fenceBbox);
        }
        return originals.getImportFenceEsriEnvelope?.();
    };

    mapApi.showTempFeature = function showTempFeature(geojson, duration = 10000, options = {}) {
        if (!coordinator.isActive) return originals.showTempFeature?.(geojson, duration, options);
        coordinator.broadcastMapCmd('showTempFeature', { geojson: cloneJson(geojson), duration, options: cloneJson(options) });
        return { dualScreenRemote: true };
    };

    mapApi.showRouteMilepostPreview = function showRouteMilepostPreview(geojson, duration = 0) {
        if (!coordinator.isActive) return originals.showRouteMilepostPreview?.(geojson, duration);
        coordinator.broadcastMapCmd('showRouteMilepostPreview', { geojson: cloneJson(geojson), duration });
        return { dualScreenRemote: true };
    };

    mapApi.showWirelessPlanningPreview = function showWirelessPlanningPreview(geojson, duration = 0) {
        if (!coordinator.isActive) return originals.showWirelessPlanningPreview?.(geojson, duration);
        coordinator.broadcastMapCmd('showWirelessPlanningPreview', { geojson: cloneJson(geojson), duration });
        return { dualScreenRemote: true };
    };

    mapApi.showProjectStationingPreview = function showProjectStationingPreview(geojson, duration = 0) {
        if (!coordinator.isActive) return originals.showProjectStationingPreview?.(geojson, duration);
        coordinator.broadcastMapCmd('showProjectStationingPreview', { geojson: cloneJson(geojson), duration });
        return { dualScreenRemote: true };
    };

    mapApi.removeTempFeature = function removeTempFeature(entry) {
        if (!coordinator.isActive) return originals.removeTempFeature?.(entry);
        coordinator.broadcastMapCmd('clearTempFeatures');
        return undefined;
    };

    mapApi.clearTempFeatures = function clearTempFeatures() {
        if (!coordinator.isActive) return originals.clearTempFeatures?.();
        coordinator.broadcastMapCmd('clearTempFeatures');
        return undefined;
    };

    mapApi.cancelInteraction = function cancelInteraction() {
        if (!coordinator.isActive) return originals.cancelInteraction?.();
        coordinator.broadcastMapCmd('cancelInteraction');
        return undefined;
    };

    return function uninstallDualScreenMapServiceDecorator() {
        Object.entries(originals).forEach(([name, fn]) => {
            if (typeof fn === 'function') {
                mapApi[name] = fn;
            }
        });
    };
}
