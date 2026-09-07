/**
 * Pure georeferencing math — no DOM, mapService, or React.
 * Plan-alignment quality (Web Mercator), not survey-grade.
 */

export const GEOREF_SCHEMA_VERSION = 1;
export const GEOREF_FORMAT = 'georeferenced-image';
export const GEOREF_TYPE = 'image';

export const MIN_AFFINE_POINTS = 3;
export const WORKING_MAX_EDGE = 4096;
export const TRANSLATION_PREVIEW_WIDTH_M = 400;

const EARTH_RADIUS = 6378137;
const MAX_MERCATOR_LAT = 85.05112878;
const COLLINEAR_AREA_RATIO = 0.012;
const CLUSTER_AREA_RATIO = 0.08;
const OUTLIER_RMS_RATIO = 2.5;
const OUTLIER_MIN_METERS = 5;

export const ALIGNMENT_STATUS = {
    NEED_MORE: 'need_more',
    READY_REVIEW: 'ready_review',
    REVIEW_POINT: 'review_point',
    POOR_DISTRIBUTION: 'poor_distribution',
    READY_ADD: 'ready_add'
};

/**
 * @param {number} lng
 * @param {number} lat
 * @returns {{ x: number, y: number }}
 */
export function lngLatToMercator(lng, lat) {
    const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
    const x = EARTH_RADIUS * (lng * Math.PI / 180);
    const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + clampedLat * Math.PI / 360));
    return { x, y };
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {{ lng: number, lat: number }}
 */
export function mercatorToLngLat(x, y) {
    const lng = (x / EARTH_RADIUS) * 180 / Math.PI;
    const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * 180 / Math.PI;
    return { lng, lat };
}

/**
 * @param {{ x: number, y: number }} sourcePx
 * @param {number} width
 * @param {number} height
 */
export function toNormalizedSource(sourcePx, width, height) {
    const w = Math.max(1, Number(width) || 1);
    const h = Math.max(1, Number(height) || 1);
    return {
        x: Number(sourcePx?.x || 0) / w,
        y: Number(sourcePx?.y || 0) / h
    };
}

/**
 * @param {{ x: number, y: number }} sourceNorm
 * @param {number} width
 * @param {number} height
 */
export function fromNormalizedSource(sourceNorm, width, height) {
    return {
        x: Number(sourceNorm?.x || 0) * width,
        y: Number(sourceNorm?.y || 0) * height
    };
}

export function createGcpId(index = 1) {
    return `gcp-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {object} partial
 */
export function createGcp(partial = {}) {
    return {
        id: partial.id || createGcpId(),
        sourcePx: partial.sourcePx || null,
        sourceNorm: partial.sourceNorm || null,
        mapLngLat: partial.mapLngLat || null,
        enabled: partial.enabled !== false,
        residualMeters: Number.isFinite(partial.residualMeters) ? partial.residualMeters : null,
        notes: partial.notes || ''
    };
}

export function isGcpComplete(gcp) {
    return !!(
        gcp
        && gcp.enabled !== false
        && gcp.sourcePx
        && Number.isFinite(gcp.sourcePx.x)
        && Number.isFinite(gcp.sourcePx.y)
        && gcp.mapLngLat
        && Number.isFinite(gcp.mapLngLat.lng)
        && Number.isFinite(gcp.mapLngLat.lat)
    );
}

export function getEnabledCompleteGcps(gcps = []) {
    return (gcps || []).filter(isGcpComplete);
}

function resolveSourcePx(gcp, width, height) {
    if (gcp?.sourcePx && Number.isFinite(gcp.sourcePx.x) && Number.isFinite(gcp.sourcePx.y)) {
        return gcp.sourcePx;
    }
    if (gcp?.sourceNorm && width && height) {
        return fromNormalizedSource(gcp.sourceNorm, width, height);
    }
    return null;
}

function toPlanarPair(gcp, width, height) {
    const sourcePx = resolveSourcePx(gcp, width, height);
    if (!sourcePx || !gcp.mapLngLat) return null;
    const map = lngLatToMercator(gcp.mapLngLat.lng, gcp.mapLngLat.lat);
    return { gcp, src: sourcePx, map };
}

function nearlyEqual(a, b, eps = 1e-6) {
    return Math.abs(a - b) <= eps;
}

function pointDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

function triangleArea(a, b, c) {
    return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

/**
 * @param {{ x: number, y: number }[]} points
 */
export function areSourcePointsCollinear(points, epsilon = COLLINEAR_AREA_RATIO) {
    if (!points || points.length < 3) return false;
    let maxEdge = 0;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            maxEdge = Math.max(maxEdge, pointDistance(points[i], points[j]));
        }
    }
    if (maxEdge < 1e-6) return true;

    let maxArea = 0;
    const origin = points[0];
    for (let i = 1; i < points.length - 1; i++) {
        for (let j = i + 1; j < points.length; j++) {
            maxArea = Math.max(maxArea, triangleArea(origin, points[i], points[j]));
        }
    }
    return maxArea / (maxEdge * maxEdge) < epsilon;
}

function sourceBoundsAreaRatio(points, width, height) {
    if (!points.length || !width || !height) return 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    const area = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
    return area / (width * height);
}

function hasDuplicatePairs(pairs) {
    const seenSrc = [];
    const seenMap = [];
    for (const pair of pairs) {
        if (seenSrc.some((p) => nearlyEqual(p.x, pair.src.x, 0.5) && nearlyEqual(p.y, pair.src.y, 0.5))) {
            return true;
        }
        if (seenMap.some((p) => nearlyEqual(p.x, pair.map.x, 0.05) && nearlyEqual(p.y, pair.map.y, 0.05))) {
            return true;
        }
        seenSrc.push(pair.src);
        seenMap.push(pair.map);
    }
    return false;
}

/**
 * @param {object[]} gcps
 * @param {{ width?: number, height?: number }} [dims]
 */
export function validateGcps(gcps = [], dims = {}) {
    const pairs = getEnabledCompleteGcps(gcps)
        .map((gcp) => toPlanarPair(gcp, dims.width, dims.height))
        .filter(Boolean);
    const warnings = [];

    if (hasDuplicatePairs(pairs)) {
        return { ok: false, fatal: true, error: 'Control points are too close or duplicated.', warnings, pairs };
    }

    if (pairs.length >= MIN_AFFINE_POINTS && areSourcePointsCollinear(pairs.map((p) => p.src))) {
        warnings.push('Points are nearly in a line. Add a point away from that line.');
        return {
            ok: false,
            fatal: true,
            error: 'Need a point away from the existing line to finish alignment.',
            code: 'collinear',
            warnings,
            pairs
        };
    }

    if (
        pairs.length >= MIN_AFFINE_POINTS
        && dims.width
        && dims.height
        && sourceBoundsAreaRatio(pairs.map((p) => p.src), dims.width, dims.height) < CLUSTER_AREA_RATIO
    ) {
        warnings.push('Points are clustered. Add a point farther across the source.');
    }

    return { ok: true, fatal: false, warnings, pairs };
}

/**
 * @param {object[]} gcps
 * @param {{ width?: number, height?: number }} [dims]
 */
export function validatePointDistribution(gcps = [], dims = {}) {
    const validation = validateGcps(gcps, dims);
    const clustered = (validation.warnings || []).some((w) => w.includes('clustered'));
    return {
        collinear: validation.code === 'collinear',
        clustered,
        warnings: validation.warnings || []
    };
}

function makeTransform(model, a, b, c, d, e, f) {
    return { model, a, b, c, d, e, f };
}

/**
 * @param {object[]} gcps
 * @param {{ width?: number, height?: number }} [dims]
 */
export function solveTranslation(gcps, dims = {}) {
    const pair = getEnabledCompleteGcps(gcps)
        .map((gcp) => toPlanarPair(gcp, dims.width, dims.height))
        .filter(Boolean)[0];
    if (!pair) {
        throw new Error('Need one complete control point for a preview.');
    }
    const width = Math.max(1, Number(dims.width) || 1);
    const scale = TRANSLATION_PREVIEW_WIDTH_M / width;
    const a = scale;
    const b = 0;
    const d = 0;
    const e = -scale;
    const c = pair.map.x - (a * pair.src.x + b * pair.src.y);
    const f = pair.map.y - (d * pair.src.x + e * pair.src.y);
    return makeTransform('translation', a, b, c, d, e, f);
}

/**
 * @param {object[]} gcps
 * @param {{ width?: number, height?: number }} [dims]
 */
export function solveSimilarity(gcps, dims = {}) {
    const pairs = getEnabledCompleteGcps(gcps)
        .map((gcp) => toPlanarPair(gcp, dims.width, dims.height))
        .filter(Boolean);
    if (pairs.length < 2) {
        throw new Error('Need two complete control points for a similarity preview.');
    }
    const p1 = pairs[0];
    const p2 = pairs[1];
    const dxs = p2.src.x - p1.src.x;
    const dys = p2.src.y - p1.src.y;
    const dxm = p2.map.x - p1.map.x;
    const dym = p2.map.y - p1.map.y;
    const srcLen2 = dxs * dxs + dys * dys;
    if (srcLen2 < 1e-8) {
        throw new Error('The two source points are too close together.');
    }
    const a = (dxm * dxs + dym * dys) / srcLen2;
    const bRot = (dym * dxs - dxm * dys) / srcLen2;
    const A = a;
    const B = -bRot;
    const D = bRot;
    const E = a;
    const C = p1.map.x - (A * p1.src.x + B * p1.src.y);
    const F = p1.map.y - (D * p1.src.x + E * p1.src.y);
    return makeTransform('similarity', A, B, C, D, E, F);
}

function solve3x3(matrix, rhs) {
    const a = matrix.map((row, i) => [...row, rhs[i]]);
    const n = 3;
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
        }
        if (Math.abs(a[pivot][col]) < 1e-12) {
            throw new Error('Cannot solve affine transform from these points.');
        }
        if (pivot !== col) {
            const tmp = a[col];
            a[col] = a[pivot];
            a[pivot] = tmp;
        }
        const div = a[col][col];
        for (let j = col; j <= n; j++) a[col][j] /= div;
        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const factor = a[row][col];
            for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
        }
    }
    return [a[0][3], a[1][3], a[2][3]];
}

function solveAffineAbc(pairs, mapKey) {
    const n = pairs.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    let sx = 0;
    let sy = 0;
    let sxm = 0;
    let sym = 0;
    let sm = 0;
    for (const pair of pairs) {
        const x = pair.src.x;
        const y = pair.src.y;
        const m = pair.map[mapKey];
        sxx += x * x;
        sxy += x * y;
        syy += y * y;
        sx += x;
        sy += y;
        sxm += x * m;
        sym += y * m;
        sm += m;
    }
    return solve3x3(
        [
            [sxx, sxy, sx],
            [sxy, syy, sy],
            [sx, sy, n]
        ],
        [sxm, sym, sm]
    );
}

/**
 * @param {object[]} gcps
 * @param {{ width?: number, height?: number }} [dims]
 */
export function solveAffine(gcps, dims = {}) {
    const validation = validateGcps(gcps, dims);
    if (validation.pairs.length < MIN_AFFINE_POINTS) {
        throw new Error('Need three complete control points for an affine alignment.');
    }
    if (validation.code === 'collinear') {
        throw new Error(validation.error);
    }
    const [a, b, c] = solveAffineAbc(validation.pairs, 'x');
    const [d, e, f] = solveAffineAbc(validation.pairs, 'y');
    const model = validation.pairs.length > MIN_AFFINE_POINTS ? 'affine-ls' : 'affine';
    return makeTransform(model, a, b, c, d, e, f);
}

/**
 * @param {{ a:number, b:number, c:number, d:number, e:number, f:number }} transform
 * @param {{ x:number, y:number }} sourcePoint
 */
export function applyTransform(transform, sourcePoint) {
    const x = Number(sourcePoint?.x);
    const y = Number(sourcePoint?.y);
    return {
        x: transform.a * x + transform.b * y + transform.c,
        y: transform.d * x + transform.e * y + transform.f
    };
}

/**
 * @param {{ a:number, b:number, c:number, d:number, e:number, f:number }} transform
 * @param {{ x:number, y:number }} mapPoint
 */
export function invertTransform(transform, mapPoint) {
    const det = transform.a * transform.e - transform.b * transform.d;
    if (Math.abs(det) < 1e-12) {
        throw new Error('Transform is not invertible.');
    }
    const dx = mapPoint.x - transform.c;
    const dy = mapPoint.y - transform.f;
    return {
        x: (transform.e * dx - transform.b * dy) / det,
        y: (-transform.d * dx + transform.a * dy) / det
    };
}

/**
 * @param {object} transform
 * @param {object[]} gcps
 * @param {{ width?: number, height?: number }} [dims]
 */
export function computeResiduals(transform, gcps = [], dims = {}) {
    return getEnabledCompleteGcps(gcps).map((gcp) => {
        const pair = toPlanarPair(gcp, dims.width, dims.height);
        if (!pair) {
            return { id: gcp.id, meters: null };
        }
        const predicted = applyTransform(transform, pair.src);
        const meters = Math.hypot(predicted.x - pair.map.x, predicted.y - pair.map.y);
        return { id: gcp.id, meters };
    });
}

export function computeRmsResidual(residuals = []) {
    const values = residuals.map((r) => r.meters).filter((v) => Number.isFinite(v));
    if (!values.length) return null;
    const sumSq = values.reduce((acc, v) => acc + v * v, 0);
    return Math.sqrt(sumSq / values.length);
}

export function findWorstResidual(residuals = []) {
    let worst = null;
    for (const residual of residuals) {
        if (!Number.isFinite(residual?.meters)) continue;
        if (!worst || residual.meters > worst.meters) worst = residual;
    }
    return worst;
}

/**
 * MapLibre image source order: TL, TR, BR, BL as [lng, lat].
 * @param {object} transform
 * @param {number} width
 * @param {number} height
 */
export function transformImageCorners(transform, width, height) {
    const corners = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height }
    ];
    return corners.map((pt) => {
        const merc = applyTransform(transform, pt);
        const { lng, lat } = mercatorToLngLat(merc.x, merc.y);
        return [lng, lat];
    });
}

export function cornersToBbox(coordinates = []) {
    if (!coordinates.length) return null;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [lng, lat] of coordinates) {
        west = Math.min(west, lng);
        east = Math.max(east, lng);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
    }
    if (!Number.isFinite(west)) return null;
    return [west, south, east, north];
}

/**
 * @param {object[]} gcps
 * @param {{ width: number, height: number }} dims
 */
export function solveAlignment(gcps = [], dims = {}) {
    const complete = getEnabledCompleteGcps(gcps);
    if (!complete.length) {
        return {
            ok: false,
            preview: false,
            error: 'Add a control point to start the preview.',
            transform: null,
            residuals: [],
            rmsResidualMeters: null,
            warnings: []
        };
    }

    const validation = validateGcps(complete, dims);
    let transform = null;
    let error = null;

    try {
        if (complete.length === 1) {
            transform = solveTranslation(complete, dims);
        } else if (complete.length === 2 || validation.code === 'collinear') {
            transform = solveSimilarity(complete, dims);
        } else {
            transform = solveAffine(complete, dims);
        }
    } catch (err) {
        error = err?.message || 'Could not compute alignment.';
    }

    if (!transform) {
        return {
            ok: false,
            preview: false,
            error,
            transform: null,
            residuals: [],
            rmsResidualMeters: null,
            warnings: validation.warnings || []
        };
    }

    const residuals = computeResiduals(transform, complete, dims);
    const rmsResidualMeters = computeRmsResidual(residuals);
    const worst = findWorstResidual(residuals);
    const annotated = complete.map((gcp) => {
        const residual = residuals.find((r) => r.id === gcp.id);
        return { ...gcp, residualMeters: residual?.meters ?? null };
    });

    const affineReady = complete.length >= MIN_AFFINE_POINTS && validation.code !== 'collinear';
    return {
        ok: affineReady,
        preview: true,
        error: affineReady ? null : (validation.error || error),
        transform,
        residuals,
        rmsResidualMeters,
        worstResidual: worst,
        gcps: annotated,
        warnings: validation.warnings || [],
        distribution: validatePointDistribution(complete, dims)
    };
}

/**
 * @param {object} alignment
 * @param {{ reviewed?: boolean }} [opts]
 */
export function getAlignmentStatus(alignment, opts = {}) {
    if (!alignment?.preview || !alignment.transform) {
        return {
            code: ALIGNMENT_STATUS.NEED_MORE,
            label: 'Need more points',
            detail: alignment?.error || 'Click a location on the source, then the same place on the map.'
        };
    }

    const model = alignment.transform.model;
    const worst = alignment.worstResidual;
    const rms = alignment.rmsResidualMeters;
    const clustered = alignment.distribution?.clustered;
    const collinear = alignment.distribution?.collinear;

    if (model === 'translation' || model === 'similarity' || !alignment.ok) {
        if (collinear) {
            return {
                code: ALIGNMENT_STATUS.POOR_DISTRIBUTION,
                label: 'Poor point distribution',
                detail: 'Add a point away from the existing line.'
            };
        }
        return {
            code: ALIGNMENT_STATUS.NEED_MORE,
            label: 'Need more points',
            detail: model === 'similarity'
                ? 'Similarity preview is ready. Add a third point to finish.'
                : 'Rough location only. Add more matched points.'
        };
    }

    if (clustered) {
        return {
            code: ALIGNMENT_STATUS.POOR_DISTRIBUTION,
            label: 'Poor point distribution',
            detail: 'Add a point farther across the sheet.',
            rmsResidualMeters: rms,
            worstPointId: worst?.id || null
        };
    }

    if (
        worst
        && Number.isFinite(worst.meters)
        && Number.isFinite(rms)
        && worst.meters >= OUTLIER_MIN_METERS
        && worst.meters >= OUTLIER_RMS_RATIO * Math.max(rms, 0.01)
    ) {
        return {
            code: ALIGNMENT_STATUS.REVIEW_POINT,
            label: `Review ${formatGcpLabel(worst.id)}`,
            detail: `That point is ${formatMeters(worst.meters)} off the others.`,
            rmsResidualMeters: rms,
            worstPointId: worst.id
        };
    }

    if (opts.reviewed) {
        return {
            code: ALIGNMENT_STATUS.READY_ADD,
            label: 'Ready to add',
            detail: rms != null ? `RMS ${formatMeters(rms)}` : 'Alignment looks ready.',
            rmsResidualMeters: rms,
            worstPointId: worst?.id || null
        };
    }

    return {
        code: ALIGNMENT_STATUS.READY_REVIEW,
        label: 'Ready to review',
        detail: rms != null
            ? `Inspect the overlay. RMS ${formatMeters(rms)}.`
            : 'Inspect the overlay before adding it to the map.',
        rmsResidualMeters: rms,
        worstPointId: worst?.id || null
    };
}

export function formatMeters(meters) {
    if (!Number.isFinite(meters)) return '—';
    if (meters < 1) return `${meters.toFixed(2)} m`;
    if (meters < 20) return `${meters.toFixed(1)} m`;
    return `${Math.round(meters)} m`;
}

export function formatGcpLabel(id, index) {
    if (Number.isFinite(index)) return `Point ${index}`;
    const match = String(id || '').match(/gcp-(\d+)/);
    if (match) return `Point ${match[1]}`;
    return 'Point';
}

export function nextGcpNumber(gcps = []) {
    return (gcps?.length || 0) + 1;
}

/**
 * @param {object} alignment
 * @param {{ width: number, height: number, sourceName?: string, pageIndex?: number, fingerprint?: string }} source
 * @param {object[]} gcps
 */
export function buildGeoreferenceRecord(alignment, source, gcps) {
    const coordinates = alignment?.transform
        ? transformImageCorners(alignment.transform, source.width, source.height)
        : null;
    return {
        schemaVersion: GEOREF_SCHEMA_VERSION,
        sourceName: source.sourceName || source.name || '',
        pageIndex: Number.isFinite(source.pageIndex) ? source.pageIndex : 0,
        fingerprint: source.fingerprint || '',
        gcps: (gcps || []).map((gcp) => ({
            id: gcp.id,
            sourcePx: gcp.sourcePx,
            sourceNorm: gcp.sourceNorm,
            mapLngLat: gcp.mapLngLat,
            enabled: gcp.enabled !== false,
            residualMeters: gcp.residualMeters ?? null,
            notes: gcp.notes || ''
        })),
        result: alignment?.transform ? {
            model: alignment.transform.model,
            coefficients: {
                a: alignment.transform.a,
                b: alignment.transform.b,
                c: alignment.transform.c,
                d: alignment.transform.d,
                e: alignment.transform.e,
                f: alignment.transform.f
            },
            rmsResidualMeters: alignment.rmsResidualMeters,
            transformedCorners: coordinates,
            sourceWidth: source.width,
            sourceHeight: source.height,
            solvedAt: new Date().toISOString()
        } : null
    };
}

export function buildSourceFingerprint(file, width, height, pageIndex = 0) {
    const name = file?.name || 'source';
    const size = file?.size ?? 0;
    const modified = file?.lastModified ?? 0;
    return `${name}|${size}|${modified}|${width}x${height}|p${pageIndex}`;
}

export default {
    GEOREF_SCHEMA_VERSION,
    GEOREF_FORMAT,
    GEOREF_TYPE,
    lngLatToMercator,
    mercatorToLngLat,
    toNormalizedSource,
    fromNormalizedSource,
    validateGcps,
    solveTranslation,
    solveSimilarity,
    solveAffine,
    applyTransform,
    invertTransform,
    computeResiduals,
    computeRmsResidual,
    findWorstResidual,
    validatePointDistribution,
    transformImageCorners,
    solveAlignment,
    getAlignmentStatus
};
