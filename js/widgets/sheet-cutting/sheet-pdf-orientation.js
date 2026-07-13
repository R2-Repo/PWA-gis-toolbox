/**
 * PDF export map bearing — landscape-align (default), north-up, or match-line flow.
 */

import { getLocalTangentBearing } from '../project-stationing/engine.js';

/** How detail PDF pages orient the map camera. */
export const PDF_MAP_BEARING_MODES = {
    /** North up on every sheet — matches the in-app sheet preview. */
    NORTH_UP: 'north-up',
    /** Route along page length (landscape); north stays upright; compass rotates per sheet. */
    LANDSCAPE_ALIGN: 'landscape-align',
    /** Rotate each sheet so increasing station reads left → right (may flip 180°). */
    MATCH_LINE: 'match-line-flow'
};

/** Default detail-page map bearing mode. */
export const DEFAULT_PDF_MAP_BEARING_MODE = PDF_MAP_BEARING_MODES.LANDSCAPE_ALIGN;

/** Offset into the sheet before sampling the start match-line tangent (feet). */
export const PDF_EXPORT_STATION_EPS_FT = 2;

/** Extra bottom margin reserved for continuation labels (inches). */
export const PDF_DETAIL_FOOTER_BAND_IN = 0.75;

/**
 * @param {number} bearingDeg
 * @returns {number}
 */
export function normalizeDegrees(bearingDeg) {
    return ((Number(bearingDeg) % 360) + 360) % 360;
}

/**
 * Map bearing so geographic forward (route tangent) reads left → right on screen.
 * @param {number} tangentDeg Geographic route tangent (degrees clockwise from north).
 * @returns {number}
 */
export function tangentToLandscapeMapBearing(tangentDeg) {
    return normalizeDegrees(tangentDeg - 90);
}

/**
 * Two map bearings (180° apart) that put the route tangent along the page width.
 * @param {number} tangentDeg
 * @returns {[number, number]}
 */
export function landscapeBearingCandidates(tangentDeg) {
    const base = tangentToLandscapeMapBearing(tangentDeg);
    return [normalizeDegrees(base), normalizeDegrees(base + 180)];
}

/**
 * True when geographic north appears in the upper half of the page (not upside down).
 * @param {number} mapBearingDeg
 * @returns {boolean}
 */
export function northPointsUpOnPage(mapBearingDeg) {
    const bearing = normalizeDegrees(mapBearingDeg);
    return bearing <= 90 || bearing >= 270;
}

/**
 * Pick a landscape bearing that keeps north upright; prefer left → right when both qualify.
 * @param {number} tangentDeg
 * @param {import('geojson').Feature<import('geojson').LineString>} routeLine
 * @param {number} startFt
 * @param {number} endFt
 * @returns {number}
 */
export function resolveLandscapeAlignBearing(tangentDeg, routeLine, startFt, endFt) {
    const candidates = landscapeBearingCandidates(tangentDeg);
    const upright = candidates.filter((bearing) => northPointsUpOnPage(bearing));
    const pool = upright.length ? upright : candidates;

    if (!routeLine?.geometry || typeof turf === 'undefined' || pool.length === 1) {
        return pool[0];
    }

    const totalLength = turf.length(routeLine, { units: 'feet' });
    const start = Math.max(0, Math.min(startFt, totalLength));
    const end = Math.max(start, Math.min(endFt, totalLength));
    const startCoord = turf.along(routeLine, start, { units: 'feet' }).geometry.coordinates;
    const endCoord = turf.along(routeLine, end, { units: 'feet' }).geometry.coordinates;
    const origin = [
        (startCoord[0] + endCoord[0]) / 2,
        (startCoord[1] + endCoord[1]) / 2
    ];

    for (const bearing of pool) {
        const startX = projectedScreenX(startCoord, origin, bearing);
        const endX = projectedScreenX(endCoord, origin, bearing);
        if (endX > startX) {
            return bearing;
        }
    }

    return pool[0];
}

/**
 * Screen-space X of a lng/lat point after applying map bearing (relative to origin).
 * @param {number[]} point
 * @param {number[]} origin
 * @param {number} mapBearingDeg
 * @returns {number}
 */
export function projectedScreenX(point, origin, mapBearingDeg) {
    const latRad = (origin[1] * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    const dx = (point[0] - origin[0]) * cosLat;
    const dy = point[1] - origin[1];
    const rad = (mapBearingDeg * Math.PI) / 180;
    return dx * Math.cos(rad) + dy * Math.sin(rad);
}

/**
 * Flip map bearing 180° when route end projects left of start (right-to-left flow).
 * @param {import('geojson').Feature<import('geojson').LineString>} routeLine
 * @param {number} startFt
 * @param {number} endFt
 * @param {number} mapBearingDeg
 * @returns {number}
 */
export function normalizeMapBearingForLeftToRight(routeLine, startFt, endFt, mapBearingDeg) {
    if (!routeLine?.geometry || typeof turf === 'undefined') {
        return normalizeDegrees(mapBearingDeg);
    }

    const totalLength = turf.length(routeLine, { units: 'feet' });
    const start = Math.max(0, Math.min(startFt, totalLength));
    const end = Math.max(start, Math.min(endFt, totalLength));
    const startCoord = turf.along(routeLine, start, { units: 'feet' }).geometry.coordinates;
    const endCoord = turf.along(routeLine, end, { units: 'feet' }).geometry.coordinates;
    const origin = [
        (startCoord[0] + endCoord[0]) / 2,
        (startCoord[1] + endCoord[1]) / 2
    ];

    const startX = projectedScreenX(startCoord, origin, mapBearingDeg);
    const endX = projectedScreenX(endCoord, origin, mapBearingDeg);
    if (endX < startX) {
        return normalizeDegrees(mapBearingDeg + 180);
    }
    return normalizeDegrees(mapBearingDeg);
}

/**
 * @param {object} sheet
 * @param {import('geojson').Feature<import('geojson').LineString>} routeLine
 * @param {object} [options]
 * @param {'start'|'end'} [options.sampleAt]
 * @returns {number}
 */
export function resolveSheetPdfBearing(sheet, routeLine, options = {}) {
    const mode = options.mode ?? DEFAULT_PDF_MAP_BEARING_MODE;
    if (mode === PDF_MAP_BEARING_MODES.NORTH_UP) {
        return 0;
    }

    if (!routeLine?.geometry || typeof turf === 'undefined') {
        return normalizeDegrees(sheet?.rotationDeg ?? 0);
    }

    const epsFt = options.stationEpsFt ?? PDF_EXPORT_STATION_EPS_FT;
    const totalLength = turf.length(routeLine, { units: 'feet' });
    const startFt = sheet?.startDistanceFt ?? 0;
    const endFt = sheet?.endDistanceFt ?? totalLength;
    const sampleAt = options.sampleAt === 'end' ? 'end' : 'start';
    const sampleFt = sampleAt === 'end'
        ? Math.max(startFt, endFt - epsFt)
        : Math.min(startFt + epsFt, Math.max(startFt, endFt - epsFt));
    const tangent = getLocalTangentBearing(routeLine, sampleFt);

    if (mode === PDF_MAP_BEARING_MODES.LANDSCAPE_ALIGN) {
        return resolveLandscapeAlignBearing(tangent, routeLine, startFt, endFt);
    }

    const mapBearing = tangentToLandscapeMapBearing(tangent);
    return normalizeMapBearingForLeftToRight(routeLine, startFt, endFt, mapBearing);
}

/**
 * @param {object[]} detailSheets
 * @param {import('geojson').Feature<import('geojson').LineString>} routeLine
 * @param {object} [options]
 * @returns {Map<string, number>}
 */
export function resolveSheetPdfBearings(detailSheets = [], routeLine = null, options = {}) {
    const bearings = new Map();
    for (const sheet of detailSheets) {
        if (!sheet?.sheetId) continue;
        bearings.set(sheet.sheetId, resolveSheetPdfBearing(sheet, routeLine, options));
    }
    return bearings;
}

/**
 * @param {number} distanceFt
 * @returns {string}
 */
export function formatRouteStationFt(distanceFt) {
    const ft = Math.max(0, Number(distanceFt) || 0);
    const thousands = Math.floor(ft / 1000);
    const remainder = Math.round(ft % 1000);
    return `${thousands}+${String(remainder).padStart(3, '0')}`;
}

/**
 * @param {object} sheet
 * @param {number} totalSheets
 * @returns {{ sheetLabel: string, stationRange: string, continueFrom: string|null, continueTo: string|null }}
 */
export function buildSheetContinuationLabels(sheet, totalSheets) {
    const num = sheet?.sheetNumber ?? 0;
    const pad = String(num).padStart(2, '0');
    const sheetLabel = `Sheet ${pad} of ${totalSheets}`;
    const stationRange = `${formatRouteStationFt(sheet?.startDistanceFt ?? 0)} – ${formatRouteStationFt(sheet?.endDistanceFt ?? 0)}`;
    const continueFrom = num > 1
        ? `← Sheet ${String(num - 1).padStart(2, '0')}`
        : null;
    const continueTo = num < totalSheets
        ? `Sheet ${String(num + 1).padStart(2, '0')} →`
        : null;

    return { sheetLabel, stationRange, continueFrom, continueTo };
}

/**
 * @param {number} sheetNumber
 * @returns {string}
 */
export function formatSeeSheetLabel(sheetNumber) {
    const num = Number(sheetNumber);
    if (!Number.isFinite(num) || num <= 0) return '';
    return `SEE SHEET ${String(num).padStart(2, '0')}`;
}

/**
 * @param {object} sheet
 * @param {number} totalSheets
 * @returns {Array<{ position: 'start'|'end', adjacentSheetNumber: number, text: string, stationFt: number }>}
 */
export function buildSheetEdgeSeeLabelSpecs(sheet, totalSheets) {
    const num = sheet?.sheetNumber ?? 0;
    const specs = [];

    if (num > 1) {
        specs.push({
            position: 'start',
            adjacentSheetNumber: num - 1,
            text: formatSeeSheetLabel(num - 1),
            stationFt: sheet.startDistanceFt ?? 0
        });
    }

    if (num < totalSheets) {
        specs.push({
            position: 'end',
            adjacentSheetNumber: num + 1,
            text: formatSeeSheetLabel(num + 1),
            stationFt: sheet.endDistanceFt ?? 0
        });
    }

    return specs;
}
