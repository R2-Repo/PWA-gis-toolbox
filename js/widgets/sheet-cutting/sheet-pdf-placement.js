/**
 * Shared placement math for sheet PDF pages (raster underlay + vector overlay).
 */

import { coordsEqual } from './export-builder.js';

/**
 * Fit a clipped sheet image into the printable page.
 * When `referenceWidthPx` / `referenceHeightPx` are set (nominal full-sheet clip),
 * scale is taken from that window so a short remnant is not blown up to fill the page.
 *
 * @param {number} pageW
 * @param {number} pageH
 * @param {object} marginsPt
 * @param {number} contentWidthPx
 * @param {number} contentHeightPx
 * @param {object} [options]
 * @returns {{ x: number, y: number, width: number, height: number, scale: number }}
 */
export function computeSheetImagePlacement(pageW, pageH, marginsPt, contentWidthPx, contentHeightPx, options = {}) {
    const target = options.targetRect;
    const availW = target?.width > 0
        ? target.width
        : pageW - marginsPt.left - marginsPt.right;
    const availH = target?.height > 0
        ? target.height
        : pageH - marginsPt.top - marginsPt.bottom;
    const originX = Number.isFinite(target?.x) ? target.x : marginsPt.left;
    const originY = Number.isFinite(target?.y) ? target.y : marginsPt.top;
    const preferLandscapeFlow = options.preferLandscapeFlow !== false;
    const widthPx = Math.max(1, contentWidthPx);
    const heightPx = Math.max(1, contentHeightPx);
    const refW = Number(options.referenceWidthPx);
    const refH = Number(options.referenceHeightPx);
    const fitW = Math.max(widthPx, Number.isFinite(refW) && refW > 0 ? refW : widthPx);
    const fitH = Math.max(heightPx, Number.isFinite(refH) && refH > 0 ? refH : heightPx);

    let scale;
    if (preferLandscapeFlow && fitW >= fitH) {
        scale = availW / fitW;
        if (fitH * scale > availH) {
            scale = availH / fitH;
        }
    } else {
        scale = Math.min(availW / fitW, availH / fitH);
    }

    const width = widthPx * scale;
    const height = heightPx * scale;
    const x = originX + (availW - width) / 2;
    const y = originY + (availH - height) / 2;

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
 * Project a geographic sheet ring with the same transform as the gold outline.
 *
 * @param {number[][]} ring
 * @param {object} transform
 * @param {import('maplibre-gl').Map} map
 * @param {number} captureScale
 * @returns {Array<{ x: number, y: number }>}
 */
export function buildPdfRingFromGeoRing(ring, transform, map, captureScale) {
    if (!ring?.length || !transform?.projectLngLat || !map) return [];
    const limit = ring.length;
    const isClosed = limit > 1 && coordsEqual(ring[0], ring[limit - 1]);
    const vertexCount = isClosed ? limit - 1 : limit;
    const pdfRing = [];
    for (let i = 0; i < vertexCount; i++) {
        const coord = ring[i];
        if (!Array.isArray(coord) || coord.length < 2) continue;
        pdfRing.push(transform.projectLngLat(map, coord[0], coord[1], captureScale));
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
 * Smallest angle between two directions, treating opposites as parallel.
 * @param {number} aDeg
 * @param {number} bDeg
 * @returns {number}
 */
function parallelAngleDeltaDeg(aDeg, bDeg) {
    const diff = Math.abs(((Number(aDeg) - Number(bDeg) + 180) % 360) - 180);
    return Math.min(diff, Math.abs(diff - 180));
}

/**
 * Closest point on a segment to (px, py).
 * @param {number} px
 * @param {number} py
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {{ x: number, y: number }}
 */
function closestPointOnSegment(px, py, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return { x: a.x, y: a.y };
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
    return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Distance from a point to a segment.
 * @param {number} px
 * @param {number} py
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number}
 */
function distancePointToSegment(px, py, a, b) {
    const point = closestPointOnSegment(px, py, a, b);
    return Math.hypot(px - point.x, py - point.y);
}

/**
 * Ring edge closest to a point, preferring edges parallel to `preferredAngleDeg`.
 *
 * @param {Array<{ x: number, y: number }>} pdfRing
 * @param {number} x
 * @param {number} y
 * @param {number} [preferredAngleDeg]
 * @returns {{ from: { x: number, y: number }, to: { x: number, y: number }, point: { x: number, y: number } }|null}
 */
export function closestPdfRingEdge(pdfRing, x, y, preferredAngleDeg = null) {
    if (!pdfRing?.length) return null;
    const PARALLEL_MAX_DEG = 35;

    const search = (requireParallel) => {
        let best = null;
        let bestDist = Infinity;
        for (let i = 0; i < pdfRing.length; i++) {
            const from = pdfRing[i];
            const to = pdfRing[(i + 1) % pdfRing.length];
            const edgeAngleDeg = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
            if (requireParallel && preferredAngleDeg != null
                && parallelAngleDeltaDeg(edgeAngleDeg, preferredAngleDeg) > PARALLEL_MAX_DEG) {
                continue;
            }
            const dist = distancePointToSegment(x, y, from, to);
            if (dist < bestDist) {
                bestDist = dist;
                best = { from, to, point: closestPointOnSegment(x, y, from, to) };
            }
        }
        return best;
    };

    return search(preferredAngleDeg != null) ?? search(false);
}

/**
 * Unit perpendicular for an edge angle in PDF points (y-down).
 * @param {number} edgeAngleDeg
 * @returns {{ x: number, y: number }}
 */
function unitPerpFromEdgeAngle(edgeAngleDeg) {
    const rad = (Number(edgeAngleDeg) || 0) * Math.PI / 180;
    const nx = -Math.sin(rad);
    const ny = Math.cos(rad);
    const len = Math.hypot(nx, ny) || 1;
    return { x: nx / len, y: ny / len };
}

/**
 * Perpendicular that points away from a known interior point.
 * @param {number} midX
 * @param {number} midY
 * @param {number} edgeAngleDeg
 * @param {{ x: number, y: number }} interior
 * @returns {{ x: number, y: number }}
 */
function outwardAwayFromInterior(midX, midY, edgeAngleDeg, interior) {
    const n = unitPerpFromEdgeAngle(edgeAngleDeg);
    const toIx = interior.x - midX;
    const toIy = interior.y - midY;
    if (toIx * n.x + toIy * n.y > 0) {
        return { x: -n.x, y: -n.y };
    }
    return n;
}

/**
 * Outward unit normal from a cutout edge, by probing which perpendicular
 * enters the polygon. A mid that is already outside must not walk back in.
 *
 * @param {number} midX
 * @param {number} midY
 * @param {number} edgeAngleDeg
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @returns {{ x: number, y: number }}
 */
export function probeOutwardUnitNormal(midX, midY, edgeAngleDeg, pdfRing = null) {
    const n = unitPerpFromEdgeAngle(edgeAngleDeg);
    if (!pdfRing?.length) {
        return n;
    }

    const firstInsideDistance = (dirX, dirY) => {
        for (const d of [3, 6, 10, 16, 24, 40, 64, 100, 160]) {
            if (pointInPdfRing(midX + dirX * d, midY + dirY * d, pdfRing)) {
                return d;
            }
        }
        return Infinity;
    };

    const aIn = firstInsideDistance(n.x, n.y);
    const bIn = firstInsideDistance(-n.x, -n.y);
    if (aIn !== bIn) {
        return aIn > bIn ? n : { x: -n.x, y: -n.y };
    }

    const aEsc = offsetPointAlongNormalOutsidePdfRing(midX, midY, n.x, n.y, 4, pdfRing);
    const bEsc = offsetPointAlongNormalOutsidePdfRing(midX, midY, -n.x, -n.y, 4, pdfRing);
    if (aEsc && bEsc) {
        return aEsc.distance <= bEsc.distance
            ? { x: aEsc.normX, y: aEsc.normY }
            : { x: bEsc.normX, y: bEsc.normY };
    }
    if (aEsc) return { x: aEsc.normX, y: aEsc.normY };
    if (bEsc) return { x: bEsc.normX, y: bEsc.normY };
    return n;
}

/**
 * Outward normal: away from a point that actually sits inside the cutout,
 * otherwise probe the polygon.
 *
 * @param {number} midX
 * @param {number} midY
 * @param {number} edgeAngleDeg
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @param {{ x: number, y: number }} [interiorRefPdf]
 * @returns {{ x: number, y: number }}
 */
export function resolveOutwardUnitNormal(midX, midY, edgeAngleDeg, pdfRing = null, interiorRefPdf = null) {
    const interiorIsInside = interiorRefPdf
        && pdfRing?.length
        && pointInPdfRing(interiorRefPdf.x, interiorRefPdf.y, pdfRing);
    if (interiorIsInside) {
        return outwardAwayFromInterior(midX, midY, edgeAngleDeg, interiorRefPdf);
    }
    return probeOutwardUnitNormal(midX, midY, edgeAngleDeg, pdfRing);
}

/**
 * Place a label at the midpoint of the nearest cutout border edge, always outside.
 *
 * @param {number} midX
 * @param {number} midY
 * @param {number} edgeAngleDeg
 * @param {number} offsetPt
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @param {{ x: number, y: number }} [interiorRefPdf]
 * @returns {{ midX: number, midY: number, x: number, y: number, angle: number, edgeAngleDeg: number }}
 */
export function placeLabelOutsidePdfCutout(
    midX,
    midY,
    edgeAngleDeg,
    offsetPt,
    pdfRing = null,
    interiorRefPdf = null
) {
    let useMidX = midX;
    let useMidY = midY;
    let useAngle = Number(edgeAngleDeg) || 0;
    const MAX_SNAP_PT = 24;
    if (pdfRing?.length) {
        const edge = closestPdfRingEdge(pdfRing, midX, midY, useAngle);
        if (edge) {
            const snapDist = Math.hypot(edge.point.x - midX, edge.point.y - midY);
            if (snapDist <= MAX_SNAP_PT) {
                useMidX = edge.point.x;
                useMidY = edge.point.y;
                const dx = edge.to.x - edge.from.x;
                const dy = edge.to.y - edge.from.y;
                if (Math.hypot(dx, dy) > 1e-6) {
                    useAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
                }
            }
        }
    }

    const outward = resolveOutwardUnitNormal(
        useMidX,
        useMidY,
        useAngle,
        pdfRing,
        interiorRefPdf
    );
    const dist = Math.max(0, Number(offsetPt) || 0);
    let x = useMidX + outward.x * dist;
    let y = useMidY + outward.y * dist;
    if (pdfRing?.length && pointInPdfRing(x, y, pdfRing)) {
        const flippedX = useMidX - outward.x * dist;
        const flippedY = useMidY - outward.y * dist;
        if (!pointInPdfRing(flippedX, flippedY, pdfRing)) {
            x = flippedX;
            y = flippedY;
        } else {
            const escaped = offsetPointAlongNormalOutsidePdfRing(
                useMidX,
                useMidY,
                outward.x,
                outward.y,
                Math.max(8, dist),
                pdfRing
            );
            x = escaped.x;
            y = escaped.y;
        }
    }

    const interior = interiorRefPdf
        ?? computePdfRingCentroid(pdfRing)
        ?? { x: useMidX - outward.x, y: useMidY - outward.y };
    return {
        midX: useMidX,
        midY: useMidY,
        x,
        y,
        edgeAngleDeg: useAngle,
        angle: pickTextAngleWithBottomTowardInterior(useAngle, x, y, interior)
    };
}

/**
 * Outward unit normal (away from interior) for an edge at `edgeAngleDeg`.
 *
 * @param {number} edgeAngleDeg
 * @param {{ x: number, y: number }} mid
 * @param {{ x: number, y: number }} interior
 * @returns {{ x: number, y: number }}
 */
export function outwardUnitNormalFromEdgeAngle(edgeAngleDeg, mid, interior) {
    const rad = (Number(edgeAngleDeg) || 0) * Math.PI / 180;
    let nx = -Math.sin(rad);
    let ny = Math.cos(rad);
    const toInteriorX = (interior?.x ?? mid.x) - mid.x;
    const toInteriorY = (interior?.y ?? mid.y) - mid.y;
    if (toInteriorX * nx + toInteriorY * ny > 0) {
        nx = -nx;
        ny = -ny;
    }
    const len = Math.hypot(nx, ny) || 1;
    return { x: nx / len, y: ny / len };
}

/**
 * Outward unit normal for the edge pFrom → pTo.
 *
 * @param {{ x: number, y: number }} pFrom
 * @param {{ x: number, y: number }} pTo
 * @param {{ x: number, y: number }} interior
 * @returns {{ x: number, y: number }|null}
 */
export function outwardUnitNormalFromEdge(pFrom, pTo, interior) {
    if (!pFrom || !pTo) return null;
    const dx = pTo.x - pFrom.x;
    const dy = pTo.y - pFrom.y;
    const edgeLen = Math.hypot(dx, dy);
    if (edgeLen < 1e-6) return null;
    const mid = { x: (pFrom.x + pTo.x) / 2, y: (pFrom.y + pTo.y) / 2 };
    const edgeAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    return outwardUnitNormalFromEdgeAngle(edgeAngleDeg, mid, interior);
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
 * Step along a ring-edge normal until the point is outside the cutout.
 * If the preferred normal points into the sheet, use the opposite direction.
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
    const step = Math.max(1, offsetPt);
    const tryDir = (nx, ny) => {
        let distance = step;
        for (let attempt = 0; attempt < 40; attempt++) {
            const x = midX + nx * distance;
            const y = midY + ny * distance;
            if (!pdfRing?.length || !pointInPdfRing(x, y, pdfRing)) {
                return { x, y, distance, normX: nx, normY: ny };
            }
            distance += step;
        }
        return null;
    };

    const preferred = tryDir(normX, normY);
    const flipped = tryDir(-normX, -normY);
    if (preferred && flipped) {
        return preferred.distance <= flipped.distance ? preferred : flipped;
    }
    if (preferred) return preferred;
    if (flipped) return flipped;

    return {
        x: midX + normX * step,
        y: midY + normY * step,
        distance: step,
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
 * Push a label horizontally away from the sheet until it clears the cutout.
 * Left → −X, right → +X. Never steps toward the sheet interior.
 *
 * @param {'left'|'right'} side
 * @param {number} midX
 * @param {number} midY
 * @param {number} offsetPt
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @returns {{ x: number, y: number }}
 */
export function offsetPageSideLabelOutsidePdfRing(side, midX, midY, offsetPt, pdfRing = null) {
    const sign = side === 'left' ? -1 : 1;
    const step = Math.max(1, offsetPt);
    let distance = step;
    let x = midX + sign * distance;
    const y = midY;

    if (!pdfRing?.length) {
        return { x, y };
    }

    for (let attempt = 0; attempt < 80; attempt++) {
        const outsideSide = side === 'left' ? x < midX : x > midX;
        if (!pointInPdfRing(x, y, pdfRing) && outsideSide) {
            // One extra step clears the dashed outline stroke on the match line.
            return { x: x + sign * step, y };
        }
        distance += step;
        x = midX + sign * distance;
    }

    // Last resort: stay relative to the match-line mid, not the sheet bbox.
    return { x: midX + sign * distance, y };
}

/**
 * @param {number} midX
 * @param {number} midY
 * @param {number} offsetPt
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @returns {{ x: number, y: number }}
 */
export function offsetRightHandLabelOutsidePdfRing(midX, midY, offsetPt, pdfRing = null) {
    return offsetPageSideLabelOutsidePdfRing('right', midX, midY, offsetPt, pdfRing);
}

/**
 * @param {number} midX
 * @param {number} midY
 * @param {number} offsetPt
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @returns {{ x: number, y: number }}
 */
export function offsetLeftHandLabelOutsidePdfRing(midX, midY, offsetPt, pdfRing = null) {
    return offsetPageSideLabelOutsidePdfRing('left', midX, midY, offsetPt, pdfRing);
}

/**
 * Place a SEE SHEET label just outside a page-side match line.
 *
 * @param {'left'|'right'} side
 * @param {number} midX
 * @param {number} midY
 * @param {number} edgeAngleDeg
 * @param {Array<{ x: number, y: number }>} pdfRing
 * @param {{ x: number, y: number, width: number, height: number }} [placedRect]
 * @param {{ x: number, y: number }} fallbackInteriorRefPdf
 * @param {number} offsetPt
 * @returns {{ midX: number, midY: number, x: number, y: number, angle: number, edgeAngleDeg: number }}
 */
export function placePageSideCapSeeLabel(
    side,
    midX,
    midY,
    edgeAngleDeg,
    pdfRing,
    placedRect,
    fallbackInteriorRefPdf,
    offsetPt
) {
    const interiorRefPdf = fallbackInteriorRefPdf
        ?? computePdfRingCentroid(pdfRing)
        ?? {
            x: placedRect
                ? placedRect.x + placedRect.width / 2
                : (side === 'left' ? midX + 1 : midX - 1),
            y: midY
        };
    return placeLabelOutsidePdfCutout(
        midX,
        midY,
        edgeAngleDeg,
        offsetPt,
        pdfRing,
        interiorRefPdf
    );
}

/**
 * Place a SEE SHEET label just outside a right-hand match line (page-right of the cap).
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
    return placePageSideCapSeeLabel(
        'right',
        midX,
        midY,
        edgeAngleDeg,
        pdfRing,
        placedRect,
        fallbackInteriorRefPdf,
        offsetPt
    );
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
 * Place a SEE SHEET label just outside a left-hand match line (page-left of the cap).
 * Same hard page-side offset as the right hand — always −X from the cap mid.
 *
 * @param {number} midX
 * @param {number} midY
 * @param {number} edgeAngleDeg
 * @param {number} _edgeNormX
 * @param {number} _edgeNormY
 * @param {{ x: number, y: number }} interiorRefPdf
 * @param {number} offsetPt
 * @param {Array<{ x: number, y: number }>} [pdfRing]
 * @param {{ x: number, y: number, width: number, height: number }} [placedRect]
 * @returns {{ midX: number, midY: number, x: number, y: number, angle: number, edgeAngleDeg: number }}
 */
export function placeLeftHandCapSeeLabel(
    midX,
    midY,
    edgeAngleDeg,
    _edgeNormX,
    _edgeNormY,
    interiorRefPdf,
    offsetPt,
    pdfRing = null,
    placedRect = null
) {
    return placePageSideCapSeeLabel(
        'left',
        midX,
        midY,
        edgeAngleDeg,
        pdfRing,
        placedRect,
        interiorRefPdf,
        offsetPt
    );
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
    const pdfRingResolved = pdfRing ?? null;

    const side = isRightHandCapMidpoint(midX, placedRect, pdfRingResolved) ? 'right' : 'left';
    return placePageSideCapSeeLabel(
        side,
        midX,
        midY,
        edgeAngleDeg,
        pdfRingResolved,
        placedRect,
        interiorRefPdf,
        offsetPt
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