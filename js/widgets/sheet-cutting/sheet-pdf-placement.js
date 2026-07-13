/**
 * Shared placement math for sheet PDF pages (raster underlay + vector overlay).
 */

/**
 * @param {number} pageW
 * @param {number} pageH
 * @param {object} marginsPt
 * @param {number} contentWidthPx
 * @param {number} contentHeightPx
 * @param {object} [options]
 * @returns {{ x: number, y: number, width: number, height: number, scale: number }}
 */
export function computeSheetImagePlacement(pageW, pageH, marginsPt, contentWidthPx, contentHeightPx, options = {}) {
    const availW = pageW - marginsPt.left - marginsPt.right;
    const availH = pageH - marginsPt.top - marginsPt.bottom;
    const preferLandscapeFlow = options.preferLandscapeFlow !== false;
    const widthPx = Math.max(1, contentWidthPx);
    const heightPx = Math.max(1, contentHeightPx);

    let scale;
    if (preferLandscapeFlow && widthPx >= heightPx) {
        scale = availW / widthPx;
        if (heightPx * scale > availH) {
            scale = availH / heightPx;
        }
    } else {
        scale = Math.min(availW / widthPx, availH / heightPx);
    }

    const width = widthPx * scale;
    const height = heightPx * scale;
    const x = marginsPt.left + (availW - width) / 2;
    const y = marginsPt.top + (availH - height) / 2;

    return { x, y, width, height, scale };
}

/**
 * @param {number[][]} pixelRing
 * @returns {{ minX: number, minY: number, width: number, height: number }}
 */
export function computeClipBBoxFromPixelRing(pixelRing) {
    const xs = pixelRing.map(([x]) => x);
    const ys = pixelRing.map(([, y]) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return {
        minX,
        minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY)
    };
}

/**
 * Build a map-device-pixel → PDF-point transform aligned to a clipped sheet image placement.
 *
 * @param {number[][]} pixelRing
 * @param {object} marginsPt
 * @param {{ width: number, height: number }} pageSize
 * @param {object} [options]
 * @returns {{
 *   minX: number,
 *   minY: number,
 *   clipWidth: number,
 *   clipHeight: number,
 *   placedRect: { x: number, y: number, width: number, height: number, scale: number },
 *   pxPerPt: number,
 *   toPdf: (px: number, py: number) => { x: number, y: number },
 *   projectLngLat: (map: import('maplibre-gl').Map, lng: number, lat: number, captureScale: number) => { x: number, y: number }
 * }}
 */
export function buildSheetPageTransform(pixelRing, marginsPt, pageSize, options = {}) {
    const { minX, minY, width: clipWidth, height: clipHeight } = computeClipBBoxFromPixelRing(pixelRing);
    const placedRect = computeSheetImagePlacement(
        pageSize.width,
        pageSize.height,
        marginsPt,
        clipWidth,
        clipHeight,
        options
    );
    const pxPerPt = placedRect.width / clipWidth;

    const toPdf = (px, py) => ({
        x: placedRect.x + ((px - minX) / clipWidth) * placedRect.width,
        y: placedRect.y + ((py - minY) / clipHeight) * placedRect.height
    });

    const projectLngLat = (map, lng, lat, captureScale) => {
        const point = map.project([lng, lat]);
        return toPdf(point.x * captureScale, point.y * captureScale);
    };

    return {
        minX,
        minY,
        clipWidth,
        clipHeight,
        placedRect,
        pxPerPt,
        toPdf,
        projectLngLat
    };
}
