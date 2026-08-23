/**
 * Sheet Cutter detail boxes (insets) — zoomed cutouts packed onto DETAILS pages.
 * Pure helpers: no DOM, no mapService.
 */

import { createStableId } from '../../plan-project/id-utils.js';

export const INSETS_PER_PAGE = 4;
export const INSET_PREVIEW_COLOR = '#2563eb';
export const INSET_CELL_GUTTER_PT = 8;
export const INSET_CELL_HEADER_PT = 14;
/** Gap between the DETAIL map and the reserved key-notes strip. */
export const INSET_NOTES_GAP_PT = 4;
/** Gap from the box edge to the label anchor (ground feet). */
export const INSET_LABEL_STANDOFF_FT = 18;
/** Reject / penalize candidates closer than this to other sheet features. */
export const INSET_LABEL_CLEARANCE_FT = 22;
const INSET_LABEL_WIDTH_FT = 110;
const INSET_LABEL_HEIGHT_FT = 36;
const INSET_LABEL_BEARINGS = Object.freeze([0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330]);
/** Ignore nicks smaller than this share of the detail-box area. */
export const INSET_PARENT_MIN_OVERLAP_RATIO = 0.02;
/** Absolute floor so tiny boxes still get a parent (square meters). */
export const INSET_PARENT_MIN_OVERLAP_M2 = 4;
const SKIP_INSET_OBSTACLE_TYPES = new Set([
    'sheet_outline',
    'matchline_see_label',
    'overview_sheet_outline',
    'overview_sheet_label',
    'overview_route',
    'inset_label'
]);

/**
 * @param {number} index
 * @returns {string}
 */
export function insetLetterFromIndex(index) {
    let n = Math.max(0, Math.floor(Number(index) || 0)) + 1;
    let out = '';
    while (n > 0) {
        n -= 1;
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26);
    }
    return out;
}

/**
 * @param {string} [label]
 * @returns {string}
 */
export function formatInsetDetailLabel(label) {
    const letter = String(label || '').trim();
    return letter ? `DETAIL ${letter}` : '';
}

/**
 * @param {number} pageNumber
 * @returns {string}
 */
export function formatSeeDetailsLabel(pageNumber) {
    const num = Number(pageNumber);
    if (!Number.isFinite(num) || num <= 0) return '';
    return `SEE DETAILS ${String(num).padStart(2, '0')}`;
}

/**
 * @param {number} pageNumber
 * @param {number} [totalPages]
 * @returns {string}
 */
export function formatDetailsPageLabel(pageNumber, totalPages = 0) {
    const num = Number(pageNumber);
    if (!Number.isFinite(num) || num <= 0) return '';
    const page = String(num).padStart(2, '0');
    const total = Number(totalPages);
    if (!Number.isFinite(total) || total <= 0) return `DETAILS ${page}`;
    return `DETAILS ${page} of ${String(total).padStart(2, '0')}`;
}

/**
 * @param {number[]} [numbers]
 * @returns {number[]}
 */
export function uniquePositiveSheetNumbers(numbers = []) {
    const seen = new Set();
    const out = [];
    for (const value of numbers || []) {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0 || seen.has(num)) continue;
        seen.add(num);
        out.push(num);
    }
    out.sort((a, b) => a - b);
    return out;
}

/**
 * @param {string[]} [ids]
 * @returns {string[]}
 */
function uniqueSheetIds(ids = []) {
    const seen = new Set();
    const out = [];
    for (const value of ids || []) {
        const id = String(value || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

/**
 * @param {object} [view]
 * @returns {string[]}
 */
export function parentSheetIdsOf(view) {
    const listed = uniqueSheetIds(view?.parentSheetIds);
    if (listed.length) return listed;
    const single = String(view?.parentSheetId || '').trim();
    return single ? [single] : [];
}

/**
 * @param {object} [view]
 * @returns {number[]}
 */
export function parentSheetNumbersOf(view) {
    const listed = uniquePositiveSheetNumbers(view?.parentSheetNumbers);
    if (listed.length) return listed;
    const single = Number(view?.parentSheetNumber);
    return Number.isFinite(single) && single > 0 ? [single] : [];
}

/**
 * @param {object} [view]
 * @returns {string}
 */
export function formatInsetParentSheetsLabel(view) {
    const numbers = parentSheetNumbersOf(view);
    if (!numbers.length) return '';
    const padded = numbers.map((num) => String(num).padStart(2, '0'));
    return padded.length === 1 ? `Sheet ${padded[0]}` : `Sheets ${padded.join(', ')}`;
}

/**
 * @param {number|number[]} [raw]
 * @returns {string}
 */
export function formatSeeSheetsLabel(raw) {
    const numbers = uniquePositiveSheetNumbers(Array.isArray(raw) ? raw : [raw]);
    if (!numbers.length) return '';
    const padded = numbers.map((num) => String(num).padStart(2, '0'));
    return padded.length === 1
        ? `SEE SHEET ${padded[0]}`
        : `SEE SHEETS ${padded.join(', ')}`;
}

/**
 * @param {object} [feature]
 * @returns {object|null}
 */
export function polygonFromGeoJson(feature) {
    const type = feature?.geometry?.type;
    if (type === 'Polygon' || type === 'MultiPolygon') return feature;
    return null;
}

/**
 * @param {object} [view]
 * @returns {object|null}
 */
export function polygonFromInsetView(view) {
    if (!view || typeof turf === 'undefined') return null;
    if (view.geometry?.type === 'Polygon' || view.geometry?.type === 'MultiPolygon') {
        return { type: 'Feature', properties: { ...(view.properties || {}) }, geometry: view.geometry };
    }
    if (Array.isArray(view.bbox) && view.bbox.length === 4 && view.bbox.every(Number.isFinite)) {
        return turf.bboxPolygon(view.bbox);
    }
    return polygonFromGeoJson(view);
}

/**
 * @param {object} [feature]
 * @returns {number[]|null}
 */
export function bboxFromPolygon(feature) {
    if (!feature?.geometry || typeof turf === 'undefined') return null;
    try {
        const bbox = turf.bbox(feature);
        return bbox?.every(Number.isFinite) ? bbox : null;
    } catch {
        return null;
    }
}

/**
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function polygonOverlapArea(a, b) {
    if (!a?.geometry || !b?.geometry || typeof turf === 'undefined') return 0;
    try {
        if (!turf.booleanIntersects(a, b)) return 0;
        const inter = turf.intersect(turf.featureCollection([a, b]));
        return inter?.geometry ? turf.area(inter) : 0;
    } catch {
        try {
            return turf.booleanIntersects(a, b) ? 1 : 0;
        } catch {
            return 0;
        }
    }
}

/**
 * @param {object} [polygon]
 * @returns {number}
 */
function polygonAreaM2(polygon) {
    if (!polygon?.geometry || typeof turf === 'undefined') return 0;
    try {
        const area = turf.area(polygon);
        return Number.isFinite(area) ? area : 0;
    } catch {
        return 0;
    }
}

/**
 * Corridor sheets whose overlap with the box is large enough to count (not a sliver).
 * Sorted by overlap area descending.
 *
 * @param {object} bboxPolygon
 * @param {object[]} [frameFeatures]
 * @param {{ minOverlapRatio?: number, minOverlapM2?: number }} [options]
 * @returns {{ parentSheetId: string, parentSheetNumber: number, overlapArea: number }[]}
 */
export function assignOverlappingSheets(bboxPolygon, frameFeatures = [], options = {}) {
    const polygon = polygonFromGeoJson(bboxPolygon);
    if (!polygon) return [];

    const boxArea = polygonAreaM2(polygon);
    const minRatio = Number.isFinite(Number(options.minOverlapRatio))
        ? Number(options.minOverlapRatio)
        : INSET_PARENT_MIN_OVERLAP_RATIO;
    const minAbs = Number.isFinite(Number(options.minOverlapM2))
        ? Number(options.minOverlapM2)
        : INSET_PARENT_MIN_OVERLAP_M2;
    const minArea = Math.max(minAbs, boxArea * minRatio);

    const hits = [];
    for (const frame of frameFeatures || []) {
        if (!frame?.geometry) continue;
        const sheetId = String(frame.properties?.sheet_id || '').trim();
        if (!sheetId) continue;
        const area = polygonOverlapArea(polygon, frame);
        if (!(area >= minArea)) continue;
        hits.push({
            parentSheetId: sheetId,
            parentSheetNumber: Number(frame.properties?.sheet_number) || 0,
            overlapArea: area
        });
    }
    hits.sort((a, b) => (
        b.overlapArea - a.overlapArea
        || a.parentSheetNumber - b.parentSheetNumber
        || a.parentSheetId.localeCompare(b.parentSheetId)
    ));
    return hits;
}

/**
 * Parent corridor sheet = largest overlapping sheet frame.
 * @param {object} bboxPolygon
 * @param {object[]} [frameFeatures]
 * @param {{ minOverlapRatio?: number, minOverlapM2?: number }} [options]
 * @returns {{ parentSheetId: string, parentSheetNumber: number, overlapArea: number }|null}
 */
export function assignParentSheet(bboxPolygon, frameFeatures = [], options = {}) {
    return assignOverlappingSheets(bboxPolygon, frameFeatures, options)[0] || null;
}

/**
 * @param {object} [polygon]
 * @param {object} [frame]
 * @returns {object|null}
 */
export function clipPolygonToFrame(polygon, frame) {
    if (!polygon?.geometry || !frame?.geometry || typeof turf === 'undefined') return null;
    try {
        if (!turf.booleanIntersects(polygon, frame)) return null;
        const inter = turf.intersect(turf.featureCollection([polygon, frame]));
        return inter?.geometry ? inter : null;
    } catch {
        return null;
    }
}

/**
 * @param {object[]} [views]
 * @returns {object[]}
 */
export function relabelInsetViews(views = []) {
    return (views || []).map((view, index) => ({
        ...view,
        label: insetLetterFromIndex(index)
    }));
}

/**
 * @param {object} [input]
 * @returns {object|null}
 */
export function normalizeInsetView(input = {}) {
    const polygon = polygonFromInsetView(input) || polygonFromGeoJson(input);
    const bbox = Array.isArray(input.bbox) && input.bbox.length === 4
        ? input.bbox.map(Number)
        : bboxFromPolygon(polygon);
    if (!polygon?.geometry || !bbox) return null;

    const parentSheetIds = parentSheetIdsOf(input);
    const parentSheetNumbers = parentSheetNumbersOf(input);
    const parentSheetId = String(input.parentSheetId || parentSheetIds[0] || '').trim();
    const parentSheetNumber = Number(input.parentSheetNumber) || parentSheetNumbers[0] || 0;

    return {
        insetId: input.insetId || createStableId('inset'),
        label: String(input.label || 'A').trim() || 'A',
        bbox,
        geometry: polygon.geometry,
        parentSheetId,
        parentSheetNumber,
        parentSheetIds: parentSheetId && !parentSheetIds.includes(parentSheetId)
            ? [parentSheetId, ...parentSheetIds]
            : parentSheetIds,
        parentSheetNumbers: parentSheetNumber > 0 && !parentSheetNumbers.includes(parentSheetNumber)
            ? uniquePositiveSheetNumbers([parentSheetNumber, ...parentSheetNumbers])
            : parentSheetNumbers
    };
}

/**
 * @param {object} session
 * @param {object} bboxPolygon
 * @param {object[]} frameFeatures
 * @returns {object}
 */
export function addInsetView(session, bboxPolygon, frameFeatures = []) {
    const polygon = polygonFromGeoJson(bboxPolygon);
    if (!polygon?.geometry) {
        throw new Error('Draw a detail box on the map.');
    }

    const parents = assignOverlappingSheets(polygon, frameFeatures);
    if (!parents.length) {
        throw new Error('Draw the detail box so it overlaps a sheet polygon.');
    }

    const primary = parents[0];
    const byNumber = [...parents].sort((a, b) => (
        a.parentSheetNumber - b.parentSheetNumber
        || a.parentSheetId.localeCompare(b.parentSheetId)
    ));
    const nextView = normalizeInsetView({
        geometry: polygon.geometry,
        parentSheetId: primary.parentSheetId,
        parentSheetNumber: primary.parentSheetNumber,
        parentSheetIds: byNumber.map((entry) => entry.parentSheetId),
        parentSheetNumbers: byNumber.map((entry) => entry.parentSheetNumber)
    });
    if (!nextView) {
        throw new Error('Detail box geometry is invalid.');
    }

    const insetViews = relabelInsetViews([
        ...(session.sheets?.insetViews || []),
        nextView
    ]);

    return {
        ...session,
        sheets: {
            ...session.sheets,
            insetViews
        }
    };
}

/**
 * @param {object} session
 * @param {string} insetId
 * @returns {object}
 */
export function removeInsetView(session, insetId) {
    const insetViews = relabelInsetViews(
        (session.sheets?.insetViews || []).filter((view) => view.insetId !== insetId)
    );
    return {
        ...session,
        sheets: {
            ...session.sheets,
            insetViews
        }
    };
}

/**
 * @param {object} session
 * @returns {object}
 */
export function clearInsetViews(session) {
    return {
        ...session,
        sheets: {
            ...session.sheets,
            insetViews: []
        }
    };
}

/**
 * Pack detail boxes into 4-up DETAILS pages (top-left, top-right, bottom-left, bottom-right).
 * Leftover 1–3 boxes leave empty quadrants.
 *
 * @param {object[]} [insetViews]
 * @param {{ perPage?: number }} [options]
 * @returns {{
 *   pages: object[],
 *   detailsPageByInsetId: Record<string, number>,
 *   totalInsetPages: number
 * }}
 */
export function packInsetPages(insetViews = [], options = {}) {
    const perPage = Math.max(1, Number(options.perPage) || INSETS_PER_PAGE);
    const views = (insetViews || []).filter((view) => view?.insetId);
    const detailsPageByInsetId = {};
    const pages = [];

    for (let i = 0; i < views.length; i += perPage) {
        const slice = views.slice(i, i + perPage);
        const insetPageNumber = pages.length + 1;
        const quadrants = [];
        for (let q = 0; q < perPage; q += 1) {
            const view = slice[q] || null;
            quadrants.push(view);
            if (view?.insetId) detailsPageByInsetId[view.insetId] = insetPageNumber;
        }
        pages.push({
            pageType: 'inset',
            insetPageNumber,
            insetIds: slice.map((view) => view.insetId),
            quadrants
        });
    }

    const totalInsetPages = pages.length;
    for (const page of pages) {
        page.totalInsetPages = totalInsetPages;
        page.title = formatDetailsPageLabel(page.insetPageNumber, totalInsetPages);
        page.exportBearingDeg = 0;
    }

    return { pages, detailsPageByInsetId, totalInsetPages };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * MapLibre / PDF text-anchor for a label sitting outward along `bearingDeg` (0 = north).
 *
 * @param {number} bearingDeg
 * @returns {string}
 */
export function insetLabelAnchorFromBearing(bearingDeg) {
    const b = ((Number(bearingDeg) % 360) + 360) % 360;
    if (b < 22.5 || b >= 337.5) return 'bottom';
    if (b < 67.5) return 'bottom-left';
    if (b < 112.5) return 'left';
    if (b < 157.5) return 'top-left';
    if (b < 202.5) return 'top';
    if (b < 247.5) return 'top-right';
    if (b < 292.5) return 'right';
    return 'bottom-right';
}

/**
 * Distance from bbox center to the rectangle edge along a bearing (ground feet).
 *
 * @param {number} widthFt
 * @param {number} heightFt
 * @param {number} bearingDeg
 * @returns {number}
 */
export function distanceFromCenterToBBoxEdgeFt(widthFt, heightFt, bearingDeg) {
    const rad = (Number(bearingDeg) * Math.PI) / 180;
    const east = Math.sin(rad);
    const north = Math.cos(rad);
    const tx = Math.abs(east) < 1e-9 ? Infinity : (widthFt / 2) / Math.abs(east);
    const ty = Math.abs(north) < 1e-9 ? Infinity : (heightFt / 2) / Math.abs(north);
    const dist = Math.min(tx, ty);
    return Number.isFinite(dist) ? dist : 0;
}

function pointInPolygon(point, polygon, ignoreBoundary = false) {
    if (!point?.geometry || !polygon?.geometry || typeof turf === 'undefined') return false;
    try {
        return turf.booleanPointInPolygon(point, polygon, { ignoreBoundary });
    } catch {
        return false;
    }
}

/**
 * Ground-feet from a box edge along a bearing until the sheet boundary.
 *
 * @param {object} center
 * @param {object} boxPolygon
 * @param {object|null} sheetPolygon
 * @param {number} bearingDeg
 * @param {number} toEdgeFt
 * @returns {number}
 */
function radialSpaceOutsideBoxFt(center, boxPolygon, sheetPolygon, bearingDeg, toEdgeFt) {
    if (!sheetPolygon?.geometry) return 240;
    let lastInside = 0;
    for (let extra = 4; extra <= 420; extra += 8) {
        let probe;
        try {
            probe = turf.destination(center, toEdgeFt + extra, bearingDeg, { units: 'feet' });
        } catch {
            return lastInside;
        }
        if (!pointInPolygon(probe, sheetPolygon, false)) return lastInside;
        if (pointInPolygon(probe, boxPolygon, true)) continue;
        lastInside = extra;
    }
    return lastInside;
}

function labelFootprintInsideSheet(point, bearingDeg, widthFt, heightFt, sheetPolygon) {
    if (!sheetPolygon?.geometry) return true;
    const along = (bearingDeg % 180 === 0) ? heightFt : widthFt;
    const across = (bearingDeg % 180 === 0) ? widthFt : heightFt;
    for (const offset of [0, 90, 180, 270]) {
        const dist = offset % 180 === 0 ? along * 0.35 : across * 0.35;
        let corner;
        try {
            corner = turf.destination(point, dist, bearingDeg + offset, { units: 'feet' });
        } catch {
            continue;
        }
        if (!pointInPolygon(corner, sheetPolygon, false)) return false;
    }
    return true;
}

function obstacleDistanceFt(point, obstacle) {
    const geometry = obstacle?.geometry;
    if (!geometry || typeof turf === 'undefined') return Infinity;
    const type = geometry.type;
    try {
        if (type === 'Point') {
            return turf.distance(point, obstacle, { units: 'feet' });
        }
        if (type === 'MultiPoint') {
            let min = Infinity;
            for (const coord of geometry.coordinates || []) {
                min = Math.min(min, turf.distance(point, turf.point(coord), { units: 'feet' }));
            }
            return min;
        }
        if (type === 'Polygon' || type === 'MultiPolygon') {
            if (pointInPolygon(point, obstacle, false)) return 0;
            const line = turf.polygonToLine(obstacle);
            return turf.pointToLineDistance(point, line, { units: 'feet' });
        }
        if (type === 'LineString' || type === 'MultiLineString') {
            return turf.pointToLineDistance(point, obstacle, { units: 'feet' });
        }
    } catch {
        return Infinity;
    }
    return Infinity;
}

/**
 * @param {object} point
 * @param {object[]} obstacles
 * @returns {number}
 */
export function minInsetLabelObstacleDistanceFt(point, obstacles = []) {
    let min = Infinity;
    for (const obstacle of obstacles || []) {
        min = Math.min(min, obstacleDistanceFt(point, obstacle));
        if (min <= 0) return 0;
    }
    return min;
}

function framesForInsetView(view, frameFeatures = []) {
    const frames = frameFeatures || [];
    const matched = [];
    const seen = new Set();
    for (const id of parentSheetIdsOf(view)) {
        const match = frames.find((frame) => frame?.properties?.sheet_id === id);
        if (!match?.geometry || seen.has(id)) continue;
        seen.add(id);
        matched.push(match);
    }
    if (matched.length) return matched;

    const polygon = polygonFromInsetView(view);
    if (!polygon) return [];
    return assignOverlappingSheets(polygon, frames)
        .map((parent) => frames.find((frame) => frame?.properties?.sheet_id === parent.parentSheetId))
        .filter((frame) => frame?.geometry);
}

function shouldSkipObstacle(feature, boxPolygon) {
    const type = feature?.properties?.feature_type;
    if (type && SKIP_INSET_OBSTACLE_TYPES.has(type)) return true;
    if (!feature?.geometry) return true;
    if (!boxPolygon?.geometry) return false;
    try {
        if (feature.geometry.type === 'Point') {
            return pointInPolygon(feature, boxPolygon, false);
        }
        const centroid = turf.centroid(feature);
        return pointInPolygon(centroid, boxPolygon, false);
    } catch {
        return false;
    }
}

/**
 * Place DETAIL / SEE DETAILS text just outside the box, inside the parent sheet,
 * away from other features on that sheet.
 *
 * @param {object} boxPolygon
 * @param {object|null} [sheetPolygon]
 * @param {object[]} [obstacles]
 * @param {{ standoffFt?: number, labelWidthFt?: number, labelHeightFt?: number }} [options]
 * @returns {{ point: object, anchor: string, bearing: number, score: number }|null}
 */
export function placeInsetLabelOutsideBox(boxPolygon, sheetPolygon = null, obstacles = [], options = {}) {
    if (!boxPolygon?.geometry || typeof turf === 'undefined') return null;

    let bbox;
    try {
        bbox = turf.bbox(boxPolygon);
    } catch {
        return null;
    }
    if (!bbox?.every(Number.isFinite)) return null;

    const [west, south, east, north] = bbox;
    const center = turf.point([(west + east) / 2, (south + north) / 2]);
    const midLat = (south + north) / 2;
    const widthFt = turf.distance([west, midLat], [east, midLat], { units: 'feet' });
    const heightFt = turf.distance([(west + east) / 2, south], [(west + east) / 2, north], { units: 'feet' });
    const standoffFt = Number.isFinite(Number(options.standoffFt))
        ? Number(options.standoffFt)
        : clampNumber(Math.min(widthFt, heightFt) * 0.12, INSET_LABEL_STANDOFF_FT, 40);
    const labelW = Number(options.labelWidthFt) || INSET_LABEL_WIDTH_FT;
    const labelH = Number(options.labelHeightFt) || INSET_LABEL_HEIGHT_FT;

    const candidates = [];
    for (const bearing of INSET_LABEL_BEARINGS) {
        const toEdge = distanceFromCenterToBBoxEdgeFt(widthFt, heightFt, bearing);
        const space = radialSpaceOutsideBoxFt(center, boxPolygon, sheetPolygon, bearing, toEdge);
        const extent = (bearing % 180 === 0) ? labelH : labelW * 0.45;
        if (sheetPolygon?.geometry && space < standoffFt + 8) continue;

        const placeFt = clampNumber(
            standoffFt + Math.min(extent * 0.35, 16),
            standoffFt,
            Math.max(standoffFt, space * 0.5)
        );
        let point;
        try {
            point = turf.destination(center, toEdge + placeFt, bearing, { units: 'feet' });
        } catch {
            continue;
        }
        if (pointInPolygon(point, boxPolygon, true)) continue;
        if (sheetPolygon?.geometry && !pointInPolygon(point, sheetPolygon, false)) continue;
        if (!labelFootprintInsideSheet(point, bearing, labelW, labelH, sheetPolygon)) continue;

        const clearance = minInsetLabelObstacleDistanceFt(point, obstacles);
        const sideBonus = bearing === 0 ? 28 : (bearing === 30 || bearing === 330 || bearing === 45 || bearing === 315) ? 10 : 0;
        const score = clearance
            + Math.min(space, 140) * 0.18
            + sideBonus
            - (clearance < INSET_LABEL_CLEARANCE_FT ? 160 : 0);
        candidates.push({
            point,
            anchor: insetLabelAnchorFromBearing(bearing),
            bearing,
            score,
            clearance
        });
    }

    if (!candidates.length) {
        for (const bearing of [0, 90, 180, 270]) {
            const toEdge = distanceFromCenterToBBoxEdgeFt(widthFt, heightFt, bearing);
            const space = radialSpaceOutsideBoxFt(center, boxPolygon, sheetPolygon, bearing, toEdge);
            const placeFt = Math.min(standoffFt, Math.max(6, space * 0.4));
            let point;
            try {
                point = turf.destination(center, toEdge + placeFt, bearing, { units: 'feet' });
            } catch {
                continue;
            }
            if (pointInPolygon(point, boxPolygon, true)) continue;
            if (sheetPolygon?.geometry && !pointInPolygon(point, sheetPolygon, false)) continue;
            candidates.push({
                point,
                anchor: insetLabelAnchorFromBearing(bearing),
                bearing,
                score: space,
                clearance: minInsetLabelObstacleDistanceFt(point, obstacles)
            });
        }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
}

function collectInsetLabelObstacles(view, boxPolygon, insetViews, frameFeature, designFeatures, placedLabels) {
    const obstacles = [];
    for (const other of insetViews || []) {
        if (!other || other.insetId === view.insetId) continue;
        const polygon = polygonFromInsetView(other);
        if (polygon?.geometry) obstacles.push(polygon);
    }
    for (const label of placedLabels || []) {
        if (label?.geometry) obstacles.push(label);
    }
    for (const feature of designFeatures || []) {
        if (shouldSkipObstacle(feature, boxPolygon)) continue;
        if (frameFeature?.geometry) {
            try {
                if (!turf.booleanIntersects(feature, frameFeature)) continue;
            } catch {
                continue;
            }
        }
        obstacles.push(feature);
        if (obstacles.length > 1800) break;
    }
    return obstacles;
}

function fallbackInsetLabelPoint(boxPolygon) {
    if (!boxPolygon?.geometry || typeof turf === 'undefined') return null;
    try {
        const [west, south, east, north] = turf.bbox(boxPolygon);
        return turf.destination(
            turf.point([(west + east) / 2, north]),
            INSET_LABEL_STANDOFF_FT,
            0,
            { units: 'feet' }
        );
    } catch {
        return null;
    }
}

/**
 * Corridor-page overlay: rectangle + DETAIL letter / SEE DETAILS nn.
 * A box that spans a match line emits one clipped outline + label per overlapping sheet.
 *
 * @param {object[]} [insetViews]
 * @param {Record<string, number>} [detailsPageByInsetId]
 * @param {{ frameFeatures?: object[], obstacleFeatures?: object[] }} [options]
 * @returns {object[]}
 */
export function buildInsetCalloutFeatures(insetViews = [], detailsPageByInsetId = {}, options = {}) {
    const features = [];
    if (typeof turf === 'undefined') return features;

    const frameFeatures = options.frameFeatures || [];
    const designFeatures = options.obstacleFeatures || [];
    const placedLabels = [];

    for (const view of insetViews || []) {
        const polygon = polygonFromInsetView(view);
        if (!polygon?.geometry) continue;
        const page = detailsPageByInsetId[view.insetId] || 0;
        const letter = view.label || '';
        const allParentIds = parentSheetIdsOf(view);
        const sheets = framesForInsetView(view, frameFeatures);
        const targets = sheets.length
            ? sheets.map((sheet) => ({
                sheet,
                sheetId: sheet.properties?.sheet_id || '',
                sheetNumber: Number(sheet.properties?.sheet_number) || 0,
                outline: clipPolygonToFrame(polygon, sheet)
            }))
            : [{
                sheet: null,
                sheetId: view.parentSheetId || '',
                sheetNumber: view.parentSheetNumber || 0,
                outline: polygon
            }];

        for (const target of targets) {
            if (!target.outline?.geometry) continue;
            features.push({
                type: 'Feature',
                geometry: target.outline.geometry,
                properties: {
                    feature_type: 'inset_outline',
                    inset_id: view.insetId,
                    inset_label: letter,
                    parent_sheet_id: target.sheetId,
                    parent_sheet_number: target.sheetNumber,
                    parent_sheet_ids: allParentIds,
                    details_page: page
                }
            });

            const obstacles = collectInsetLabelObstacles(
                view,
                polygon,
                insetViews,
                target.sheet,
                designFeatures,
                placedLabels
            );
            const placed = placeInsetLabelOutsideBox(polygon, target.sheet, obstacles);
            const labelPoint = placed?.point || fallbackInsetLabelPoint(target.outline);
            if (!labelPoint?.geometry) continue;

            const insetLabel = formatInsetDetailLabel(letter);
            const seeDetails = formatSeeDetailsLabel(page);
            const labelFeature = {
                type: 'Feature',
                geometry: labelPoint.geometry,
                properties: {
                    feature_type: 'inset_label',
                    inset_id: view.insetId,
                    inset_label: insetLabel,
                    see_details: seeDetails,
                    label_text: [insetLabel, seeDetails].filter(Boolean).join('\n'),
                    label_anchor: placed?.anchor || 'bottom',
                    parent_sheet_id: target.sheetId,
                    parent_sheet_number: target.sheetNumber,
                    parent_sheet_ids: allParentIds,
                    details_page: page
                }
            };
            features.push(labelFeature);
            placedLabels.push(labelFeature);
        }
    }

    return features;
}

/**
 * @param {number|number[]} [raw]
 * @param {number} index
 * @returns {number}
 */
function resolveNotesReservePt(raw, index) {
    if (Array.isArray(raw)) {
        return Math.max(0, Number(raw[index]) || 0);
    }
    return Math.max(0, Number(raw) || 0);
}

/**
 * 2×2 cell layout inside the printable map frame (above the title-block footer).
 * Stack per cell: header → map → optional key-notes strip.
 *
 * @param {number} pageW
 * @param {number} pageH
 * @param {object} marginsPt
 * @param {{ gutterPt?: number, headerPt?: number, perPage?: number, notesReservePt?: number|number[] }} [options]
 * @returns {Array<{
 *   index: number,
 *   chromeRect: { x: number, y: number, width: number, height: number },
 *   headerRect: { x: number, y: number, width: number, height: number },
 *   mapRect: { x: number, y: number, width: number, height: number },
 *   notesRect: { x: number, y: number, width: number, height: number }|null
 * }>}
 */
export function computeInsetQuadrantRects(pageW, pageH, marginsPt, options = {}) {
    const gutter = Number.isFinite(Number(options.gutterPt))
        ? Number(options.gutterPt)
        : INSET_CELL_GUTTER_PT;
    const header = Number.isFinite(Number(options.headerPt))
        ? Number(options.headerPt)
        : INSET_CELL_HEADER_PT;
    const left = Number(marginsPt?.left) || 0;
    const right = Number(marginsPt?.right) || 0;
    const top = Number(marginsPt?.top) || 0;
    const bottom = Number(marginsPt?.bottom) || 0;
    const mapW = Math.max(1, pageW - left - right);
    const mapH = Math.max(1, pageH - top - bottom);
    const cellW = (mapW - gutter) / 2;
    const cellH = (mapH - gutter) / 2;
    const origins = [
        { x: left, y: top },
        { x: left + cellW + gutter, y: top },
        { x: left, y: top + cellH + gutter },
        { x: left + cellW + gutter, y: top + cellH + gutter }
    ];

    return origins.map((origin, index) => {
        const notesH = resolveNotesReservePt(options.notesReservePt, index);
        const gap = notesH > 0 ? INSET_NOTES_GAP_PT : 0;
        const mapHeight = Math.max(1, cellH - header - notesH - gap);
        const mapRect = {
            x: origin.x,
            y: origin.y + header,
            width: cellW,
            height: mapHeight
        };
        const notesRect = notesH > 0
            ? {
                x: origin.x,
                y: origin.y + header + mapHeight + gap,
                width: cellW,
                height: notesH
            }
            : null;
        return {
            index,
            chromeRect: { x: origin.x, y: origin.y, width: cellW, height: cellH },
            headerRect: { x: origin.x, y: origin.y, width: cellW, height: header },
            mapRect,
            notesRect
        };
    });
}

/**
 * Ground feet represented by 1 inch on the placed inset image.
 *
 * @param {object} bboxPolygon
 * @param {number} placedWidthPt
 * @returns {string}
 */
export function formatInsetScaleLabel(bboxPolygon, placedWidthPt) {
    if (!bboxPolygon?.geometry || !Number.isFinite(placedWidthPt) || placedWidthPt <= 0) {
        return '';
    }
    if (typeof turf === 'undefined') return '';
    try {
        const [west, south, east, north] = turf.bbox(bboxPolygon);
        const midLat = (south + north) / 2;
        const widthFt = turf.distance([west, midLat], [east, midLat], { units: 'feet' });
        const widthIn = placedWidthPt / 72;
        if (!Number.isFinite(widthFt) || widthFt <= 0 || widthIn < 0.05) return '';
        const ftPerIn = widthFt / widthIn;
        return `1" = ${Math.round(ftPerIn).toLocaleString()} ft`;
    } catch {
        return '';
    }
}

/**
 * @param {object} session
 * @param {object[]} [frameFeatures]
 * @returns {string[]}
 */
export function validateInsetViews(session, frameFeatures = []) {
    const warnings = [];
    const frames = frameFeatures || [];
    const frameIds = new Set(frames.map((frame) => frame.properties?.sheet_id).filter(Boolean));

    for (const view of session?.sheets?.insetViews || []) {
        const letter = view.label || view.insetId;
        const storedIds = parentSheetIdsOf(view);
        if (storedIds.length && storedIds.every((id) => !frameIds.has(id))) {
            warnings.push(`Detail ${letter} points at a sheet that is no longer in this set.`);
            continue;
        }
        const polygon = polygonFromInsetView(view);
        if (!polygon) {
            warnings.push(`Detail ${letter} is missing a bounding box.`);
            continue;
        }
        if (frames.length && !assignOverlappingSheets(polygon, frames).length) {
            warnings.push(`Detail ${letter} no longer overlaps a sheet polygon.`);
        }
    }

    return warnings;
}
