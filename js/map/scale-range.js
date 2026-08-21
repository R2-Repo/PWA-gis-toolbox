/**
 * ArcGIS-style visible scale range ↔ MapLibre minzoom/maxzoom conversion.
 * Scale values are representative-fraction denominators (e.g. 50000 for 1:50,000).
 */

export const MAPLIBRE_MIN_ZOOM = 0;
export const MAPLIBRE_MAX_ZOOM = 24;

/** Camera zoom ceiling. MapLibre's default is 22; 24 is ~4× closer to the ground. */
export const MAP_CAMERA_MAX_ZOOM = MAPLIBRE_MAX_ZOOM;

const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Meters per pixel at zoom 0 for a 256px tile at the given latitude. */
function metersPerPixelAtZoom0(latitude) {
    const latRad = (latitude * Math.PI) / 180;
    return (EARTH_CIRCUMFERENCE_M * Math.cos(latRad)) / 256;
}

/**
 * @param {number} scale - ArcGIS scale denominator
 * @param {number} latitude
 * @returns {number|null}
 */
export function scaleToZoom(scale, latitude) {
    const denom = Number(scale);
    if (!Number.isFinite(denom) || denom <= 0) return null;
    const lat = Number.isFinite(latitude) ? latitude : 0;
    const mpp0 = metersPerPixelAtZoom0(lat);
    const zoom = Math.log2((mpp0 * 96 * 39.37) / denom);
    return Math.max(MAPLIBRE_MIN_ZOOM, Math.min(MAPLIBRE_MAX_ZOOM, zoom));
}

/**
 * @param {number} zoom
 * @param {number} latitude
 * @returns {number}
 */
export function zoomToScale(zoom, latitude) {
    const z = Number(zoom);
    const lat = Number.isFinite(latitude) ? latitude : 0;
    const mpp0 = metersPerPixelAtZoom0(lat);
    const mpp = mpp0 / Math.pow(2, z);
    return (mpp * 96 * 39.37);
}

/**
 * @param {number} zoom
 * @param {number} latitude
 * @returns {number}
 */
export function getCurrentMapScale(zoom, latitude) {
    return zoomToScale(zoom, latitude);
}

/**
 * @param {object} layer
 * @returns {{ scaleRangeEnabled: boolean, minScale: number|null, maxScale: number|null }}
 */
export function normalizeScaleRange(layer = {}) {
    const enabled = !!layer.scaleRangeEnabled;
    let minScale = layer.minScale;
    let maxScale = layer.maxScale;

    if (minScale === 0 || minScale == null || !Number.isFinite(Number(minScale)) || Number(minScale) <= 0) {
        minScale = null;
    } else {
        minScale = Number(minScale);
    }

    if (maxScale === 0 || maxScale == null || !Number.isFinite(Number(maxScale)) || Number(maxScale) <= 0) {
        maxScale = null;
    } else {
        maxScale = Number(maxScale);
    }

    // ArcGIS: minScale denominator is larger (zoomed-out limit) than maxScale (zoomed-in limit).
    if (minScale != null && maxScale != null && minScale < maxScale) {
        const tmp = minScale;
        minScale = maxScale;
        maxScale = tmp;
    }

    return { scaleRangeEnabled: enabled, minScale, maxScale };
}

/**
 * @param {{ scaleRangeEnabled?: boolean, minScale?: number|null, maxScale?: number|null }} layer
 * @param {number} latitude
 * @returns {{ minzoom: number, maxzoom: number }|null}
 */
export function resolveMapLibreZoomRange(layer, latitude) {
    const { scaleRangeEnabled, minScale, maxScale } = normalizeScaleRange(layer);
    if (!scaleRangeEnabled) return null;
    if (minScale == null && maxScale == null) return null;

    const lat = Number.isFinite(latitude) ? latitude : 0;
    let minzoom = MAPLIBRE_MIN_ZOOM;
    let maxzoom = MAPLIBRE_MAX_ZOOM;

    if (minScale != null) {
        const z = scaleToZoom(minScale, lat);
        if (z != null) minzoom = z;
    }
    if (maxScale != null) {
        const z = scaleToZoom(maxScale, lat);
        if (z != null) maxzoom = z;
    }

    if (minzoom > maxzoom) {
        const mid = (minzoom + maxzoom) / 2;
        minzoom = mid;
        maxzoom = mid;
    }

    return { minzoom, maxzoom };
}

/**
 * Whether a layer would draw at the given map zoom (ArcGIS scale-range semantics).
 * @param {object} layer
 * @param {number} zoom
 * @param {number} latitude
 * @returns {boolean}
 */
export function isLayerVisibleAtScale(layer, zoom, latitude) {
    const { scaleRangeEnabled, minScale, maxScale } = normalizeScaleRange(layer);
    if (!scaleRangeEnabled || (minScale == null && maxScale == null)) return true;

    const currentScale = getCurrentMapScale(zoom, latitude);
    if (minScale != null && currentScale > minScale) return false;
    if (maxScale != null && currentScale < maxScale) return false;
    return true;
}

/**
 * Apply ArcGIS REST minScale/maxScale metadata onto a layer dataset.
 * @param {object} layer
 * @param {{ minScale?: number|null, maxScale?: number|null }} metadata
 * @returns {object}
 */
export function applyArcgisScaleRangeToLayer(layer, metadata = {}) {
    const minScale = metadata.minScale || null;
    const maxScale = metadata.maxScale || null;
    if (!minScale && !maxScale) return layer;
    layer.scaleRangeEnabled = true;
    layer.minScale = minScale || null;
    layer.maxScale = maxScale || null;
    return layer;
}

/** Default scale-range fields for new spatial layers. */
export const DEFAULT_SCALE_RANGE = {
    scaleRangeEnabled: false,
    minScale: null,
    maxScale: null
};
