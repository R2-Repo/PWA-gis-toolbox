/**
 * Shared placement math for sheet PDF pages (raster underlay + vector overlay).
 */

import { coordsEqual } from './export-builder.js';

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

/**
 * Locate consecutive ring indices for a match-line cap edge (cap.left → cap.right).
 *
 * @param {number[][]} ring
 * @param {{ left: number[], right: number[] }} cap
 * @returns {{ leftIndex: number, rightIndex: number }|null}
 */
export function findCapEdgeVertexIndices(ring, cap) {
    if (!ring?.length || !cap?.left?.length || !cap?.right?.length) {
        return null;
    }

    const limit = ring.length;
    const isClosed = limit > 1 && coordsEqual(ring[0], ring[limit - 1]);
    const vertexCount = isClosed ? limit - 1 : limit;
    if (vertexCount < 2) return null;

    let leftIndex = -1;
    let rightIndex = -1;
    for (let i = 0; i < vertexCount; i++) {
        if (coordsEqual(ring[i], cap.left)) leftIndex = i;
        if (coordsEqual(ring[i], cap.right)) rightIndex = i;
    }
    if (leftIndex < 0 || rightIndex < 0 || leftIndex === rightIndex) {
        return null;
    }

    const next = (index) => (index + 1) % vertexCount;
    const prev = (index) => (index - 1 + vertexCount) % vertexCount;
    const isConsecutive = next(leftIndex) === rightIndex
        || next(rightIndex) === leftIndex
        || prev(leftIndex) === rightIndex
        || prev(rightIndex) === leftIndex;

    return isConsecutive ? { leftIndex, rightIndex } : null;
}

/**
 * @param {number[][]} pixelRing
 * @param {object} transform
 * @returns {Array<{ x: number, y: number }>}
 */
export function buildPdfRingFromPixelRing(pixelRing, transform) {
    if (!pixelRing?.length || !transform?.toPdf) return [];
    const limit = pixelRing.length;
    const isClosed = limit > 1
        && Math.hypot(
            pixelRing[0][0] - pixelRing[limit - 1][0],
            pixelRing[0][1] - pixelRing[limit - 1][1]
        ) < 1e-6;
    const vertexCount = isClosed ? limit - 1 : limit;
    const pdfRing = [];
    for (let i = 0; i < vertexCount; i++) {
        const [px, py] = pixelRing[i];
        pdfRing.push(transform.toPdf(px, py));
    }
    return pdfRing;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {Array<{ x: number, y: number }>} pdfRing
 * @returns {boolean}
 */
export function pointInPdfRing(x, y, pdfRing) {
    if (!pdfRing?.length) return false;
    let inside = false;
    for (let i = 0, j = pdfRing.length - 1; i < pdfRing.length; j = i++) {
        const xi = pdfRing[i].x;
        const yi = pdfRing[i].y;
        const xj = pdfRing[j].x;
        const yj = pdfRing[j].y;
        const intersects = ((yi > y) !== (yj > y))
            && (x < ((xj - xi) * (y - yi)) / (yj - yi + 0) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

/**
 * @param {number[][]} ring
 * @param {{ left: number[], right: number[] }} cap
 * @returns {{ fromIndex: number, toIndex: number }|null}
 */
export function findDirectedCapEdgeIndices(ring, cap) {
    const indices = findCapEdgeVertexIndices(ring, cap);
    if (!indices) return null;

    const limit = ring.length;
    const isClosed = limit > 1 && coordsEqual(ring[0], ring[limit - 1]);
    const vertexCount = isClosed ? limit - 1 : limit;
    const next = (index) => (index + 1) % vertexCount;
    const { leftIndex, rightIndex } = indices;

    if (next(leftIndex) === rightIndex) {
        return { fromIndex: leftIndex, toIndex: rightIndex };
    }
    if (next(rightIndex) === leftIndex) {
        return { fromIndex: rightIndex, toIndex: leftIndex };
    }
    return null;
}

/**
 * Outward unit normal from a cap edge midpoint (away from polygon interior).
 *
 * @param {number} midX
 * @param {number} midY
 * @param {Array<{ x: number, y: number }>} pdfRing
 * @returns {{ x: number, y: number }|null}
 */
export function computeOutwardNormalFromPdfRing(midX, midY, pdfRing) {
    if (!pdfRing?.length) return null;

    let centroidX = 0;
    let centroidY = 0;
    for (const point of pdfRing) {
        centroidX += point.x;
        centroidY += point.y;
    }
    centroidX /= pdfRing.length;
    centroidY /= pdfRing.length;

    const nx = midX - centroidX;
    const ny = midY - centroidY;
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) return null;

    return { x: nx / len, y: ny / len };
}

/**
 * Step outward along a fixed normal until the point clears the PDF ring (no direction flip).
 *
 * @param {number} midX
 * @param {number} midY
 * @param {number} normX
 * @param {number} normY
 * @param {number} offsetPt
 * @param {Array<{ x: number, y: number }>} pdfRing
 * @returns {{ x: number, y: number, distance: number, normX: number, normY: number }}
 */
export function offsetPointAlongNormalOutsidePdfRing(midX, midY, normX, normY, offsetPt, pdfRing) {
    let distance = Math.max(0, offsetPt);
    for (let attempt = 0; attempt < 40; attempt++) {
        const x = midX + normX * distance;
        const y = midY + normY * distance;
        if (!pdfRing?.length || !pointInPdfRing(x, y, pdfRing)) {
            return { x, y, distance, normX, normY };
        }
        distance += offsetPt;
    }

    return {
        x: midX + normX * distance,
        y: midY + normY * distance,
        distance,
        normX,
        normY
    };
}

/**
 * @param {number} midX
 * @param {number} midY
 * @param {number} normX
 * @param {number} normY
 * @param {number} offsetPt
 * @param {Array<{ x: number, y: number }>} pdfRing
 * @returns {{ x: number, y: number, distance: number, normX: number, normY: number }}
 */
export function offsetPointOutsidePdfRing(midX, midY, normX, normY, offsetPt, pdfRing) {
    const tryDirection = (nx, ny) => {
        let distance = Math.max(0, offsetPt);
        for (let attempt = 0; attempt < 8; attempt++) {
            const x = midX + nx * distance;
            const y = midY + ny * distance;
            if (!pdfRing?.length || !pointInPdfRing(x, y, pdfRing)) {
                return { x, y, distance, normX: nx, normY: ny };
            }
            distance += offsetPt;
        }
        return null;
    };

    let result = tryDirection(normX, normY);
    if (!result) {
        result = tryDirection(-normX, -normY);
    }

    if (result) {
        return result;
    }

    return {
        x: midX - normX * offsetPt,
        y: midY - normY * offsetPt,
        distance: offsetPt,
        normX: -normX,
        normY: -normY
    };
}

/**
 * @param {Array<{ x: number, y: number }>} pdfRing
 * @returns {{ x: number, y: number }|null}
 */
export function computePdfRingCentroid(pdfRing) {
    if (!pdfRing?.length) return null;

    let sumX = 0;
    let sumY = 0;
    for (const point of pdfRing) {
        sumX += point.x;
        sumY += point.y;
    }
    return { x: sumX / pdfRing.length, y: sumY / pdfRing.length };
}

/**
 * True when a cap midpoint is on the right-hand match line of the sheet cutout.
 * Uses distance to the cutout edges (not page center) so rotated/offset sheets still classify correctly.
 *
 * @param {number} midX
 * @param {{ x: number, y: number, width: number, height: number }} [placedRect]
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @returns {boolean}
 */
export function isRightHandCapMidpoint(midX, placedRect, pdfRing) {
    if (pdfRing?.length) {
        const xs = pdfRing.map((point) => point.x);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        if (maxX - minX > 1e-6) {
            return (midX - minX) >= (maxX - midX);
        }
    }
    if (placedRect?.width > 0) {
        return midX >= placedRect.x + placedRect.width * 0.5;
    }
    return false;
}

/**
 * Push a label to the right of a match-line midpoint until it clears the cutout.
 * Always moves in +X from the cap mid — never toward the sheet interior.
 *
 * @param {number} midX
 * @param {number} midY
 * @param {number} offsetPt
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @returns {{ x: number, y: number }}
 */
export function offsetRightHandLabelOutsidePdfRing(midX, midY, offsetPt, pdfRing = null) {
    const step = Math.max(1, offsetPt);
    let distance = step;
    let x = midX + distance;
    const y = midY;

    if (!pdfRing?.length) {
        return { x, y };
    }

    for (let attempt = 0; attempt < 80; attempt++) {
        if (!pointInPdfRing(x, y, pdfRing) && x > midX) {
            // One extra step clears the dashed outline stroke on the match line.
            return { x: x + step, y };
        }
        distance += step;
        x = midX + distance;
    }

    const ringMaxX = Math.max(...pdfRing.map((point) => point.x));
    return { x: Math.max(midX + step, ringMaxX + step), y };
}

/**
 * Place a SEE SHEET label just outside a right-hand match line (page-right of the cap).
 * Left-hand labels use placeLeftHandCapSeeLabel and are not affected.
 *
 * @param {number} midX
 * @param {number} midY
 * @param {number} edgeAngleDeg
 * @param {Array<{ x: number, y: number }>} pdfRing
 * @param {{ x: number, y: number, width: number, height: number }} [placedRect]
 * @param {{ x: number, y: number }} fallbackInteriorRefPdf
 * @param {number} offsetPt
 * @returns {{ midX: number, midY: number, x: number, y: number, angle: number, edgeAngleDeg: number }}
 */
export function placeRightHandCapSeeLabel(
    midX,
    midY,
    edgeAngleDeg,
    pdfRing,
    placedRect,
    fallbackInteriorRefPdf,
    offsetPt
) {
    const { x, y } = offsetRightHandLabelOutsidePdfRing(midX, midY, offsetPt, pdfRing);
    const interiorRefPdf = computePdfRingCentroid(pdfRing)
        ?? fallbackInteriorRefPdf
        ?? {
            x: placedRect ? placedRect.x + placedRect.width / 2 : midX - 1,
            y: midY
        };

    return {
        midX,
        midY,
        x,
        y,
        angle: pickTextAngleWithBottomTowardInterior(edgeAngleDeg, x, y, interiorRefPdf),
        edgeAngleDeg
    };
}

/**
 * Last-chance draw position for right-hand SEE SHEET labels.
 * Recomputes x from the cap midpoint so a bad placement cannot leave text inside
 * the cutout. Left-hand labels (midX on the left half) pass through unchanged.
 *
 * @param {{ x: number, y: number, midX?: number, midY?: number, angle: number, text: string, edgeAngleDeg?: number }} placement
 * @param {object} transform
 * @param {number[][]} [pixelRing]
 * @param {number} offsetPt
 * @returns {{ x: number, y: number, angle: number, text: string }}
 */
export function resolveRightHandSeeLabelDrawPosition(placement, transform, pixelRing, offsetPt) {
    if (!placement?.text || placement.midX == null || placement.midY == null) {
        return placement;
    }

    const pdfRing = pixelRing?.length && transform?.toPdf
        ? buildPdfRingFromPixelRing(pixelRing, transform)
        : null;
    if (!isRightHandCapMidpoint(placement.midX, transform?.placedRect, pdfRing)) {
        return placement;
    }

    const { x, y } = offsetRightHandLabelOutsidePdfRing(
        placement.midX,
        placement.midY,
        offsetPt,
        pdfRing
    );
    const interiorRefPdf = computePdfRingCentroid(pdfRing)
        ?? {
            x: transform?.placedRect
                ? transform.placedRect.x + transform.placedRect.width / 2
                : placement.midX - 1,
            y: placement.midY
        };

    return {
        ...placement,
        x,
        y,
        angle: pickTextAngleWithBottomTowardInterior(
            placement.edgeAngleDeg ?? 0,
            x,
            y,
            interiorRefPdf
        )
    };
}

/**
 * Original left-margin placement (unchanged from production behavior).
 *
 * @param {number} midX
 * @param {number} midY
 * @param {number} edgeAngleDeg
 * @param {number} edgeNormX
 * @param {number} edgeNormY
 * @param {{ x: number, y: number }} interiorRefPdf
 * @param {number} offsetPt
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @returns {{ midX: number, midY: number, x: number, y: number, angle: number, edgeAngleDeg: number }}
 */
export function placeLeftHandCapSeeLabel(
    midX,
    midY,
    edgeAngleDeg,
    edgeNormX,
    edgeNormY,
    interiorRefPdf,
    offsetPt,
    pdfRing = null
) {
    let normX = edgeNormX;
    let normY = edgeNormY;

    if (pdfRing?.length) {
        const outward = computeOutwardNormalFromPdfRing(midX, midY, pdfRing);
        if (outward) {
            normX = outward.x;
            normY = outward.y;
        } else {
            const interiorX = interiorRefPdf.x - midX;
            const interiorY = interiorRefPdf.y - midY;
            if (normX * interiorX + normY * interiorY > 0) {
                normX = -normX;
                normY = -normY;
            }
        }
    } else {
        const interiorX = interiorRefPdf.x - midX;
        const interiorY = interiorRefPdf.y - midY;
        if (normX * interiorX + normY * interiorY > 0) {
            normX = -normX;
            normY = -normY;
        }
    }

    const offset = offsetPointOutsidePdfRing(midX, midY, normX, normY, offsetPt, pdfRing);
    let x = offset.x;
    let y = offset.y;

    if (pdfRing?.length || interiorRefPdf) {
        ({ x, y } = mirrorLabelAcrossCapMidIfInside(midX, midY, x, y, interiorRefPdf, pdfRing));
    }

    return {
        midX,
        midY,
        x,
        y,
        angle: pickTextAngleWithBottomTowardInterior(edgeAngleDeg, x, y, interiorRefPdf),
        edgeAngleDeg
    };
}

/**
 * Mirror a label across the cap midpoint when it sits on the interior side.
 *
 * @param {number} midX
 * @param {number} midY
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number }} interiorRefPdf
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @returns {{ x: number, y: number }}
 */
export function mirrorLabelAcrossCapMidIfInside(midX, midY, x, y, interiorRefPdf, pdfRing = null) {
    const toInteriorX = interiorRefPdf.x - midX;
    const toInteriorY = interiorRefPdf.y - midY;
    const toLabelX = x - midX;
    const toLabelY = y - midY;
    const towardInterior = toLabelX * toInteriorX + toLabelY * toInteriorY > 0;
    const insideRing = pdfRing?.length ? pointInPdfRing(x, y, pdfRing) : false;

    if (!towardInterior && !insideRing) {
        return { x, y };
    }

    return {
        x: midX - toLabelX,
        y: midY - toLabelY
    };
}

/**
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @returns {boolean}
 */
export function pointInAxisAlignedRect(x, y, rect) {
    if (!rect) return false;
    return x >= rect.x
        && x <= rect.x + rect.width
        && y >= rect.y
        && y <= rect.y + rect.height;
}

/**
 * Pick the parallel jsPDF text angle whose glyph bottom faces the interior reference.
 *
 * @param {number} edgeAngleDeg
 * @param {number} labelX
 * @param {number} labelY
 * @param {{ x: number, y: number }} interiorRefPdf
 * @returns {number}
 */
export function pickTextAngleWithBottomTowardInterior(edgeAngleDeg, labelX, labelY, interiorRefPdf) {
    const toInteriorX = interiorRefPdf.x - labelX;
    const toInteriorY = interiorRefPdf.y - labelY;
    if (Math.hypot(toInteriorX, toInteriorY) < 1e-6) {
        return -Number(edgeAngleDeg);
    }

    const parallelA = -Number(edgeAngleDeg);
    const parallelB = parallelA + (parallelA > 0 ? -180 : 180);

    for (const angle of [parallelA, parallelB]) {
        for (const bottomOffset of [90, -90]) {
            const rad = ((angle + bottomOffset) * Math.PI) / 180;
            const bottomX = Math.cos(rad);
            const bottomY = Math.sin(rad);
            if (bottomX * toInteriorX + bottomY * toInteriorY > 0) {
                return angle;
            }
        }
    }

    return parallelA;
}

/**
 * Convert a PDF edge angle to a readable jsPDF text rotation (y-down coords).
 * @deprecated Prefer pickTextAngleWithBottomTowardInterior for cap labels.
 * @param {number} edgeAngleDeg
 * @returns {number}
 */
export function toJsPdfTextAngle(edgeAngleDeg) {
    let angle = -Number(edgeAngleDeg);
    if (angle > 90 || angle <= -90) {
        angle += angle > 0 ? -180 : 180;
    }
    return angle;
}

/**
 * PDF label placement from cap edge endpoints already in PDF points.
 *
 * @param {{ x: number, y: number }} pLeft
 * @param {{ x: number, y: number }} pRight
 * @param {{ x: number, y: number }} interiorRefPdf
 * @param {number} offsetPt
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @param {{ x: number, y: number, width: number, height: number }} [placedRect]
 * @returns {{ midX: number, midY: number, x: number, y: number, angle: number, edgeAngleDeg: number }|null}
 */
export function computeCapEdgePdfPlacementFromPdfPoints(pLeft, pRight, interiorRefPdf, offsetPt, pdfRing = null, placedRect = null) {
    if (!pLeft || !pRight || !interiorRefPdf) {
        return null;
    }

    const edgeDx = pRight.x - pLeft.x;
    const edgeDy = pRight.y - pLeft.y;
    const edgeLen = Math.hypot(edgeDx, edgeDy);
    if (edgeLen < 1e-6) return null;

    const midX = (pLeft.x + pRight.x) / 2;
    const midY = (pLeft.y + pRight.y) / 2;
    const edgeAngleDeg = (Math.atan2(edgeDy, edgeDx) * 180) / Math.PI;
    const edgeNormX = -edgeDy / edgeLen;
    const edgeNormY = edgeDx / edgeLen;
    const pdfRingResolved = pdfRing ?? null;

    if (isRightHandCapMidpoint(midX, placedRect, pdfRingResolved)) {
        return placeRightHandCapSeeLabel(
            midX,
            midY,
            edgeAngleDeg,
            pdfRingResolved,
            placedRect,
            interiorRefPdf,
            offsetPt
        );
    }

    return placeLeftHandCapSeeLabel(
        midX,
        midY,
        edgeAngleDeg,
        edgeNormX,
        edgeNormY,
        interiorRefPdf,
        offsetPt,
        pdfRingResolved
    );
}

/**
 * PDF label placement from the projected frame ring (matches sheet_outline + clip).
 *
 * @param {object} params
 * @param {number[][]} params.ring
 * @param {number[][]} params.pixelRing
 * @param {{ left: number[], right: number[] }} params.cap
 * @param {object} params.transform
 * @param {{ x: number, y: number }} params.interiorRefPdf
 * @param {number} params.offsetPt
 * @param {{ x: number, y: number, width: number, height: number }} [params.placedRect]
 * @returns {{ midX: number, midY: number, x: number, y: number, angle: number, edgeAngleDeg: number }|null}
 */
export function computeCapEdgePdfPlacementFromRing({
    ring,
    pixelRing,
    cap,
    transform,
    interiorRefPdf,
    offsetPt,
    placedRect = null
}) {
    if (!ring?.length || !pixelRing?.length || !transform?.toPdf || !cap) {
        return null;
    }

    const directed = findDirectedCapEdgeIndices(ring, cap);
    const pdfRing = buildPdfRingFromPixelRing(pixelRing, transform);
    if (!directed) return null;

    const fromPx = pixelRing[directed.fromIndex];
    const toPx = pixelRing[directed.toIndex];
    if (!fromPx?.length || !toPx?.length) return null;

    const pFrom = transform.toPdf(fromPx[0], fromPx[1]);
    const pTo = transform.toPdf(toPx[0], toPx[1]);
    return computeCapEdgePdfPlacementFromPdfPoints(pFrom, pTo, interiorRefPdf, offsetPt, pdfRing, placedRect);
}

/**
 * PDF label placement aligned to a cap edge (left → right) with outward standoff.
 *
 * @param {{ left: number[], right: number[] }} cap
 * @param {object} transform
 * @param {import('maplibre-gl').Map} map
 * @param {number} captureScale
 * @param {{ x: number, y: number }} interiorRefPdf - route point inside the sheet near the cap
 * @param {number} offsetPt - standoff distance in PDF points
 * @param {number[][]} [pixelRing]
 * @param {{ x: number, y: number, width: number, height: number }} [placedRect]
 * @returns {{ midX: number, midY: number, x: number, y: number, angle: number, edgeAngleDeg: number }|null}
 */
export function computeCapEdgePdfPlacement(cap, transform, map, captureScale, interiorRefPdf, offsetPt, pixelRing = null, placedRect = null) {
    if (!cap?.left?.length || !cap?.right?.length || !transform?.projectLngLat || !map || !interiorRefPdf) {
        return null;
    }

    const pLeft = transform.projectLngLat(map, cap.left[0], cap.left[1], captureScale);
    const pRight = transform.projectLngLat(map, cap.right[0], cap.right[1], captureScale);
    const pdfRing = pixelRing?.length ? buildPdfRingFromPixelRing(pixelRing, transform) : null;
    return computeCapEdgePdfPlacementFromPdfPoints(pLeft, pRight, interiorRefPdf, offsetPt, pdfRing, placedRect);
}