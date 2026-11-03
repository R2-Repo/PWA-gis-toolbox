/**
 * Page layout for the header map PDF (Letter / Tabloid).
 * Pure math: no jsPDF, no map, no network.
 */

/** Portrait point sizes (72 pt = 1 in). */
export const HEADER_PDF_PAGE_SIZES_PT = {
    letter: { width: 612, height: 792 },
    tabloid: { width: 792, height: 1224 }
};

export const HEADER_PDF_MARGIN_PT = 36;
export const HEADER_PDF_TITLE_BAND_PT = 32;
export const HEADER_PDF_TITLE_GAP_PT = 8;
export const HEADER_PDF_TITLE_FONT_PT = 14;

export const HEADER_PDF_SCALE_BAR_INSET_PT = 14;
export const HEADER_PDF_SCALE_BAR_HEIGHT_PT = 7;
export const HEADER_PDF_SCALE_BAR_MAX_FRACTION = 0.28;
export const HEADER_PDF_SCALE_BAR_MAX_PT = 180;

export const HEADER_PDF_NORTH_ARROW_SIZE_PT = 26;
export const HEADER_PDF_NORTH_ARROW_INSET_PT = 14;
/** Tip distance from the arrow center, as a fraction of the arrow size. */
export const HEADER_PDF_NORTH_ARROW_TIP = 0.48;

export const HEADER_PDF_DOCUMENT_COMPRESS = true;
/** jsPDF addImage compression. NONE would store the image uncompressed. */
export const HEADER_PDF_IMAGE_COMPRESSION = 'FAST';
/** JPEG quality in (0, 1). Below 1 keeps the embedded map smaller than a PNG. */
export const HEADER_PDF_JPEG_QUALITY = 0.72;

const EQUATOR_METERS_PER_DEGREE = 111320;
const WEB_MERCATOR_METERS_PER_PIXEL_Z0 = 156543.03392;
const SCALE_STEPS = [1, 2, 5];

export function normalizeHeaderPdfPageSize(pageSize) {
    const key = String(pageSize ?? 'letter').trim().toLowerCase();
    if (!key || key === 'letter') return 'letter';
    if (key === 'tabloid') return 'tabloid';
    throw new Error(`Unknown page size: ${pageSize}`);
}

/**
 * Oriented page. A wider map uses landscape; a taller map uses portrait.
 * @param {'letter'|'tabloid'|string} pageSize
 * @param {number} imageWidth
 * @param {number} imageHeight
 */
export function resolveHeaderPdfPage(pageSize, imageWidth, imageHeight) {
    const key = normalizeHeaderPdfPageSize(pageSize);
    const spec = HEADER_PDF_PAGE_SIZES_PT[key];
    const landscape = Number(imageWidth) >= Number(imageHeight);
    const longSide = Math.max(spec.width, spec.height);
    const shortSide = Math.min(spec.width, spec.height);
    return {
        pageSize: key,
        orientation: landscape ? 'landscape' : 'portrait',
        pageW: landscape ? longSide : shortSide,
        pageH: landscape ? shortSide : longSide
    };
}

export function contentBoxForPage(pageW, pageH) {
    const x = HEADER_PDF_MARGIN_PT;
    const y = HEADER_PDF_MARGIN_PT + HEADER_PDF_TITLE_BAND_PT + HEADER_PDF_TITLE_GAP_PT;
    return {
        x,
        y,
        width: pageW - (HEADER_PDF_MARGIN_PT * 2),
        height: pageH - y - HEADER_PDF_MARGIN_PT
    };
}

/**
 * Contain the map image in the content box. Aspect ratio is unchanged.
 */
export function fitMapImageToPage({ pageW, pageH, imageWidth, imageHeight }) {
    const content = contentBoxForPage(pageW, pageH);
    const srcW = Math.max(1, Number(imageWidth) || 1);
    const srcH = Math.max(1, Number(imageHeight) || 1);
    const scale = Math.min(content.width / srcW, content.height / srcH);
    const width = srcW * scale;
    const height = srcH * scale;
    return {
        x: content.x + ((content.width - width) / 2),
        y: content.y + ((content.height - height) / 2),
        width,
        height,
        scale,
        content
    };
}

export function placeHeaderPdfTitle({ pageW, title }) {
    const text = String(title ?? '').trim() || 'Map';
    return {
        text,
        x: pageW / 2,
        y: HEADER_PDF_MARGIN_PT + HEADER_PDF_TITLE_FONT_PT,
        align: 'center',
        fontSize: HEADER_PDF_TITLE_FONT_PT
    };
}

export function chooseScaleBarDistance(maxMeters) {
    const max = Number(maxMeters);
    if (!Number.isFinite(max) || max <= 0) return 1;
    let best = 1;
    for (let exp = 0; exp <= 7; exp += 1) {
        const base = 10 ** exp;
        for (const step of SCALE_STEPS) {
            const value = step * base;
            if (value <= max + 1e-6) best = value;
        }
    }
    return best;
}

export function formatScaleDistance(meters) {
    const value = Number(meters);
    if (!Number.isFinite(value) || value <= 0) return '0 m';
    if (value >= 1000) {
        const km = value / 1000;
        const text = Number.isInteger(km) ? String(km) : String(Math.round(km * 10) / 10);
        return `${text} km`;
    }
    return `${Math.round(value)} m`;
}

export function placeScaleBar({ imageBox, groundWidthMeters }) {
    const meters = Number(groundWidthMeters);
    const safeMeters = Number.isFinite(meters) && meters > 0 ? meters : 1;
    const metersPerPoint = safeMeters / imageBox.width;
    const inset = Math.min(
        HEADER_PDF_SCALE_BAR_INSET_PT,
        Math.max(4, imageBox.width * 0.04)
    );
    const available = Math.max(8, imageBox.width - (inset * 2));
    const maxPt = Math.min(
        imageBox.width * HEADER_PDF_SCALE_BAR_MAX_FRACTION,
        HEADER_PDF_SCALE_BAR_MAX_PT,
        available
    );
    const distanceMeters = chooseScaleBarDistance(maxPt * metersPerPoint);
    let width = distanceMeters / metersPerPoint;
    if (width > available) width = available;
    const height = Math.min(HEADER_PDF_SCALE_BAR_HEIGHT_PT, Math.max(3, imageBox.height * 0.08));
    const x = imageBox.x + inset;
    const y = imageBox.y + imageBox.height - inset - height;
    return {
        x,
        y,
        width,
        height,
        distanceMeters,
        label: formatScaleDistance(distanceMeters),
        labelX: x + (width / 2),
        labelY: y - 4,
        segments: [
            { x, y, width: width / 2, height, fill: '#111111' },
            { x: x + (width / 2), y, width: width / 2, height, fill: '#ffffff' }
        ]
    };
}

export function normalizeBearingDeg(bearingDeg) {
    const n = Number(bearingDeg);
    if (!Number.isFinite(n)) return 0;
    return ((n % 360) + 360) % 360;
}

/**
 * Rotate a page point around (cx, cy) by a map bearing.
 * Bearing is clockwise degrees from north-up. Page y grows downward,
 * so bearing 0 keeps north up and bearing 90 points the arrow to the left.
 */
export function rotatePagePoint(x, y, cx, cy, bearingDeg) {
    const theta = (normalizeBearingDeg(bearingDeg) * Math.PI) / 180;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const dx = x - cx;
    const dy = y - cy;
    return {
        x: cx + (dx * c) + (dy * s),
        y: cy - (dx * s) + (dy * c)
    };
}

export function placeNorthArrow({ imageBox, bearingDeg = 0 }) {
    const size = Math.min(
        HEADER_PDF_NORTH_ARROW_SIZE_PT,
        imageBox.width * 0.5,
        imageBox.height * 0.5
    );
    const room = Math.max(0, Math.min(imageBox.width, imageBox.height) - size);
    const inset = Math.min(HEADER_PDF_NORTH_ARROW_INSET_PT, room / 2);
    const cx = imageBox.x + imageBox.width - inset - (size / 2);
    const cy = imageBox.y + inset + (size / 2);
    const bearing = normalizeBearingDeg(bearingDeg);
    const tip = rotatePagePoint(cx, cy - (size * HEADER_PDF_NORTH_ARROW_TIP), cx, cy, bearing);
    const left = rotatePagePoint(cx - (size * 0.22), cy + (size * 0.32), cx, cy, bearing);
    const right = rotatePagePoint(cx + (size * 0.22), cy + (size * 0.32), cx, cy, bearing);
    const label = rotatePagePoint(cx, cy - (size * 0.72), cx, cy, bearing);
    return {
        cx,
        cy,
        size,
        bearingDeg: bearing,
        tip,
        left,
        right,
        label: { text: 'N', x: label.x, y: label.y, align: 'center' }
    };
}

export function longitudeSpanDegrees(west, east) {
    if (!Number.isFinite(west) || !Number.isFinite(east)) return 0;
    let span = east - west;
    if (span < 0) span += 360;
    return span;
}

/**
 * Ground width of the captured map. Bounds win; zoom is the fallback.
 */
export function groundWidthMetersFromView({ bounds, latitude, zoom, imageWidthPx } = {}) {
    const px = Math.max(1, Number(imageWidthPx) || 1);
    if (bounds) {
        const west = Number(bounds.west);
        const south = Number(bounds.south);
        const east = Number(bounds.east);
        const north = Number(bounds.north);
        if ([west, south, east, north].every(Number.isFinite)) {
            const span = longitudeSpanDegrees(west, east);
            const lat = (south + north) / 2;
            const meters = span * EQUATOR_METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
            if (meters > 0) return { groundWidthMeters: meters, latitude: lat };
        }
    }
    const lat = Number.isFinite(latitude) ? latitude : 0;
    const z = Number.isFinite(zoom) ? zoom : 0;
    const metersPerPixel = WEB_MERCATOR_METERS_PER_PIXEL_Z0
        * Math.cos((lat * Math.PI) / 180)
        / (2 ** z);
    return { groundWidthMeters: metersPerPixel * px, latitude: lat };
}

export function layoutHeaderPdf({
    pageSize = 'letter',
    imageWidth,
    imageHeight,
    title = 'Map',
    groundWidthMeters,
    bearingDeg = 0
} = {}) {
    const srcW = Number(imageWidth);
    const srcH = Number(imageHeight);
    if (!Number.isFinite(srcW) || srcW <= 0 || !Number.isFinite(srcH) || srcH <= 0) {
        throw new Error('Map image size is not valid');
    }
    const page = resolveHeaderPdfPage(pageSize, srcW, srcH);
    const image = fitMapImageToPage({
        pageW: page.pageW,
        pageH: page.pageH,
        imageWidth: srcW,
        imageHeight: srcH
    });
    return {
        page,
        image,
        title: placeHeaderPdfTitle({ pageW: page.pageW, title }),
        scaleBar: placeScaleBar({ imageBox: image, groundWidthMeters }),
        north: placeNorthArrow({ imageBox: image, bearingDeg }),
        compression: {
            document: HEADER_PDF_DOCUMENT_COMPRESS,
            image: HEADER_PDF_IMAGE_COMPRESSION,
            jpegQuality: HEADER_PDF_JPEG_QUALITY
        }
    };
}
