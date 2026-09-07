/**
 * Which map layers can appear as crisp PDF linework on Sheet Cutter exports.
 * Raster / tiled / unloaded layers stay on the map only.
 */
import {
    getLayerFeatureCount,
    isCogLayer,
    isLiveVectorLayer,
    isPmTilesLayer,
    isServiceLayer,
    isSpatialLayer,
    isWorkspaceLayer
} from '../../core/data-model.js';
import { isUdotFiberLiveDataset } from '../../symbology/udot-fiber/hover-fields.js';
import { isSheetFiberSnapshotLayer } from './fiber-operational.js';
import { isGeoreferencedImageLayer } from '../georeference-raster/georef-layer.js';

export const SHEET_PDF_SKIP_REASON = {
    raster: 'Image layer — not redrawn as PDF linework',
    tiled: 'Stored or tiled — features are not loaded for PDF linework',
    empty: 'No features loaded on the map'
};

export const SHEET_PDF_LIVE_NOTE = 'Uses features currently loaded on the map';
export const SHEET_PDF_PARTIAL_NOTE = 'Only loaded features — not the full stored layer';

const RASTER_SERVICE_KINDS = new Set(['wms', 'arcgis-mapserver']);

/**
 * @param {object} [layer]
 * @returns {boolean}
 */
export function isSheetPdfRasterLayer(layer) {
    if (isCogLayer(layer)) return true;
    if (isGeoreferencedImageLayer(layer)) return true;
    if (!isServiceLayer(layer)) return false;
    return RASTER_SERVICE_KINDS.has(layer.service?.kind);
}

/**
 * @param {object} [layer]
 * @returns {boolean}
 */
export function isSheetCutterLayerCandidate(layer) {
    if (!layer || layer.type === 'table') return false;
    return isSpatialLayer(layer) || isServiceLayer(layer) || isCogLayer(layer);
}

/**
 * @param {object} [layer]
 * @param {object} [mapRecord]
 * @returns {number}
 */
export function countLoadedSheetPdfFeatures(layer, mapRecord = null) {
    const fromLayer = Array.isArray(layer?.geojson?.features) ? layer.geojson.features.length : 0;
    const fromMap = Array.isArray(mapRecord?.geojson?.features) ? mapRecord.geojson.features.length : 0;
    return Math.max(fromLayer, fromMap);
}

/**
 * @param {object} [layer]
 * @param {{ loadedFeatureCount?: number }} [options]
 * @returns {{
 *   eligible: boolean,
 *   reasonKey: 'raster'|'tiled'|'empty'|null,
 *   reason: string|null,
 *   note: string|null,
 *   loadedFeatureCount: number,
 *   isUdotFiberLive: boolean,
 *   isLiveViewport: boolean
 * }}
 */
export function classifySheetPdfLayer(layer, options = {}) {
    const loadedRaw = Number(options.loadedFeatureCount);
    const loadedFeatureCount = Number.isFinite(loadedRaw)
        ? Math.max(0, loadedRaw)
        : countLoadedSheetPdfFeatures(layer);
    const isUdotFiberLive = isUdotFiberLiveDataset(layer);
    const isLiveViewport = isLiveVectorLayer(layer) || isUdotFiberLive;
    const schemaCount = getLayerFeatureCount(layer);

    const base = {
        loadedFeatureCount,
        isUdotFiberLive,
        isLiveViewport
    };

    if (!layer) {
        return {
            ...base,
            eligible: false,
            reasonKey: 'empty',
            reason: SHEET_PDF_SKIP_REASON.empty,
            note: null,
            isUdotFiberLive: false,
            isLiveViewport: false
        };
    }

    if (isUdotFiberLive || isSheetFiberSnapshotLayer(layer)) {
        return {
            ...base,
            eligible: true,
            reasonKey: null,
            reason: null,
            note: null
        };
    }

    if (isSheetPdfRasterLayer(layer)) {
        return {
            ...base,
            eligible: false,
            reasonKey: 'raster',
            reason: SHEET_PDF_SKIP_REASON.raster,
            note: null,
            isLiveViewport: false
        };
    }

    if (isLiveViewport) {
        return {
            ...base,
            eligible: true,
            reasonKey: null,
            reason: null,
            note: SHEET_PDF_LIVE_NOTE
        };
    }

    const storedWithoutFeatures = (isWorkspaceLayer(layer) || isPmTilesLayer(layer))
        && loadedFeatureCount === 0;
    if (storedWithoutFeatures) {
        return {
            ...base,
            eligible: false,
            reasonKey: 'tiled',
            reason: SHEET_PDF_SKIP_REASON.tiled,
            note: null
        };
    }

    if (loadedFeatureCount === 0) {
        return {
            ...base,
            eligible: false,
            reasonKey: 'empty',
            reason: SHEET_PDF_SKIP_REASON.empty,
            note: null
        };
    }

    const partialStored = (isWorkspaceLayer(layer) || isPmTilesLayer(layer))
        && schemaCount > loadedFeatureCount;
    return {
        ...base,
        eligible: true,
        reasonKey: null,
        reason: null,
        note: partialStored ? SHEET_PDF_PARTIAL_NOTE : null
    };
}

/**
 * @param {object} layer
 * @param {{ loadedFeatureCount?: number }} [options]
 * @returns {object}
 */
export function buildSheetPdfLayerOption(layer, options = {}) {
    const loadedFeatureCount = options.loadedFeatureCount
        ?? countLoadedSheetPdfFeatures(layer);
    const classified = classifySheetPdfLayer(layer, { loadedFeatureCount });
    return {
        id: layer.id,
        name: layer.name || 'Layer',
        featureCount: classified.loadedFeatureCount,
        schemaFeatureCount: getLayerFeatureCount(layer),
        ...classified
    };
}

/**
 * @param {string[]} selectedIds
 * @param {object[]} layerOptions
 * @returns {string[]}
 */
export function keepEligibleSheetPdfLayerIds(selectedIds = [], layerOptions = []) {
    const eligible = new Set(
        (layerOptions || []).filter((layer) => layer?.eligible && layer?.id).map((layer) => layer.id)
    );
    return (selectedIds || []).filter((id) => eligible.has(id));
}
