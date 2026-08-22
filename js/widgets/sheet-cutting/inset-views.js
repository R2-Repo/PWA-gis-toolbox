/**
 * Sheet Cutter detail boxes (insets) — zoomed cutouts packed onto DETAILS pages.
 * Pure helpers: no DOM, no mapService.
 */

import { createStableId } from '../../plan-project/id-utils.js';

export const INSETS_PER_PAGE = 4;
export const INSET_PREVIEW_COLOR = '#2563eb';
export const INSET_CELL_GUTTER_PT = 8;
export const INSET_CELL_HEADER_PT = 14;

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
 * Parent corridor sheet = largest overlapping sheet frame.
 * @param {object} bboxPolygon
 * @param {object[]} [frameFeatures]
 * @returns {{ parentSheetId: string, parentSheetNumber: number, overlapArea: number }|null}
 */
export function assignParentSheet(bboxPolygon, frameFeatures = []) {
    const polygon = polygonFromGeoJson(bboxPolygon);
    if (!polygon) return null;

    let best = null;
    for (const frame of frameFeatures || []) {
        if (!frame?.geometry) continue;
        const area = polygonOverlapArea(polygon, frame);
        let hits = area > 0;
        if (!hits) {
            try {
                hits = turf.booleanIntersects(polygon, frame);
            } catch {
                hits = false;
            }
        }
        if (!hits) continue;
        if (!best || area > best.overlapArea) {
            best = {
                parentSheetId: frame.properties?.sheet_id || '',
                parentSheetNumber: Number(frame.properties?.sheet_number) || 0,
                overlapArea: area
            };
        }
    }
    if (!best?.parentSheetId) return null;
    return best;
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

    return {
        insetId: input.insetId || createStableId('inset'),
        label: String(input.label || 'A').trim() || 'A',
        bbox,
        geometry: polygon.geometry,
        parentSheetId: input.parentSheetId || '',
        parentSheetNumber: Number(input.parentSheetNumber) || 0
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

    const parent = assignParentSheet(polygon, frameFeatures);
    if (!parent) {
        throw new Error('Draw the detail box so it overlaps a sheet polygon.');
    }

    const nextView = normalizeInsetView({
        geometry: polygon.geometry,
        parentSheetId: parent.parentSheetId,
        parentSheetNumber: parent.parentSheetNumber
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
 * Corridor-page overlay: rectangle + DETAIL letter / SEE DETAILS nn.
 *
 * @param {object[]} [insetViews]
 * @param {Record<string, number>} [detailsPageByInsetId]
 * @returns {object[]}
 */
export function buildInsetCalloutFeatures(insetViews = [], detailsPageByInsetId = {}) {
    const features = [];
    if (typeof turf === 'undefined') return features;

    for (const view of insetViews || []) {
        const polygon = polygonFromInsetView(view);
        if (!polygon?.geometry) continue;
        const page = detailsPageByInsetId[view.insetId] || 0;
        const letter = view.label || '';

        features.push({
            type: 'Feature',
            geometry: polygon.geometry,
            properties: {
                feature_type: 'inset_outline',
                inset_id: view.insetId,
                inset_label: letter,
                parent_sheet_id: view.parentSheetId || '',
                parent_sheet_number: view.parentSheetNumber || 0,
                details_page: page
            }
        });

        let labelPoint = null;
        try {
            labelPoint = turf.center(polygon);
        } catch {
            try {
                labelPoint = turf.pointOnFeature(polygon);
            } catch {
                labelPoint = null;
            }
        }
        if (!labelPoint?.geometry) continue;

        features.push({
            type: 'Feature',
            geometry: labelPoint.geometry,
            properties: {
                feature_type: 'inset_label',
                inset_id: view.insetId,
                inset_label: formatInsetDetailLabel(letter),
                see_details: formatSeeDetailsLabel(page),
                parent_sheet_id: view.parentSheetId || '',
                parent_sheet_number: view.parentSheetNumber || 0,
                details_page: page
            }
        });
    }

    return features;
}

/**
 * 2×2 cell layout inside the printable map frame (above the title-block footer).
 *
 * @param {number} pageW
 * @param {number} pageH
 * @param {object} marginsPt
 * @param {{ gutterPt?: number, headerPt?: number, perPage?: number }} [options]
 * @returns {Array<{
 *   index: number,
 *   chromeRect: { x: number, y: number, width: number, height: number },
 *   headerRect: { x: number, y: number, width: number, height: number },
 *   mapRect: { x: number, y: number, width: number, height: number }
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

    return origins.map((origin, index) => ({
        index,
        chromeRect: { x: origin.x, y: origin.y, width: cellW, height: cellH },
        headerRect: { x: origin.x, y: origin.y, width: cellW, height: header },
        mapRect: {
            x: origin.x,
            y: origin.y + header,
            width: cellW,
            height: Math.max(1, cellH - header)
        }
    }));
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
        if (view.parentSheetId && !frameIds.has(view.parentSheetId)) {
            warnings.push(`Detail ${letter} points at a sheet that is no longer in this set.`);
            continue;
        }
        const polygon = polygonFromInsetView(view);
        if (!polygon) {
            warnings.push(`Detail ${letter} is missing a bounding box.`);
            continue;
        }
        if (frames.length && !assignParentSheet(polygon, frames)) {
            warnings.push(`Detail ${letter} no longer overlaps a sheet polygon.`);
        }
    }

    return warnings;
}
