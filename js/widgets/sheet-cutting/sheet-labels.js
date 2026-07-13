/**
 * Sheet polygon label text and placement for map preview + overview export.
 */

/** Minimum ground distance (ft) between label anchor points. */
export const SHEET_LABEL_MIN_SEPARATION_FT = 150;

/** Nudge step along route when resolving label collisions (ft). */
const LABEL_NUDGE_STEP_FT = 80;

/** Max nudge attempts per label. */
const LABEL_MAX_NUDGE_PASSES = 12;

/**
 * @param {number} sheetNumber
 * @returns {string}
 */
export function formatSheetLabel(sheetNumber) {
    const num = Number(sheetNumber);
    if (!Number.isFinite(num) || num <= 0) return '';
    return `Sheet ${String(num).padStart(2, '0')}`;
}

/**
 * @param {import('geojson').Feature} frameFeature
 * @param {import('geojson').Feature|null|undefined} routeLine
 * @returns {import('geojson').Feature|null}
 */
export function buildInitialSheetLabelPoint(frameFeature, routeLine = null) {
    if (!frameFeature?.geometry || typeof turf === 'undefined') return null;

    const sheetNumber = frameFeature.properties?.sheet_number;
    const label = formatSheetLabel(sheetNumber);
    if (!label) return null;

    const centerFt = Number(frameFeature.properties?.center_distance_ft);
    let coords = null;

    if (routeLine?.geometry && Number.isFinite(centerFt)) {
        try {
            coords = turf.along(routeLine, centerFt, { units: 'feet' }).geometry.coordinates;
        } catch (_) {
            coords = null;
        }
    }

    if (!coords) {
        try {
            coords = turf.pointOnFeature(frameFeature).geometry.coordinates;
        } catch (_) {
            return null;
        }
    }

    if (!turf.booleanPointInPolygon(turf.point(coords), frameFeature)) {
        try {
            coords = turf.pointOnFeature(frameFeature).geometry.coordinates;
        } catch (_) {
            return null;
        }
    }

    return turf.point(coords, {
        sheet_id: frameFeature.properties?.sheet_id ?? null,
        sheet_number: sheetNumber,
        sheet_label: label
    });
}

/**
 * @param {import('geojson').Feature} pointFeature
 * @param {import('geojson').Feature} frameFeature
 * @returns {boolean}
 */
export function isLabelPointInsideFrame(pointFeature, frameFeature) {
    try {
        return turf.booleanPointInPolygon(pointFeature, frameFeature);
    } catch (_) {
        return false;
    }
}

/**
 * @param {import('geojson').Feature} a
 * @param {import('geojson').Feature} b
 * @returns {number}
 */
function labelSeparationFt(a, b) {
    try {
        return turf.distance(a, b, { units: 'feet' });
    } catch (_) {
        return Infinity;
    }
}

/**
 * @param {import('geojson').Feature} pointFeature
 * @param {import('geojson').Feature|null|undefined} routeLine
 * @param {number} centerFt
 * @param {number} deltaFt
 * @returns {import('geojson').Feature|null}
 */
function nudgeLabelAlongRoute(pointFeature, routeLine, centerFt, deltaFt) {
    if (!routeLine?.geometry || !Number.isFinite(centerFt)) return null;

    const routeLength = turf.length(routeLine, { units: 'feet' });
    const station = Math.max(0, Math.min(routeLength, centerFt + deltaFt));

    try {
        const coords = turf.along(routeLine, station, { units: 'feet' }).geometry.coordinates;
        return turf.point(coords, { ...(pointFeature.properties || {}) });
    } catch (_) {
        return null;
    }
}

/**
 * Resolve label anchor points so each sits inside its sheet polygon and
 * stays separated from neighboring labels along the route.
 *
 * @param {import('geojson').FeatureCollection} sheetFrames
 * @param {import('geojson').Feature|null|undefined} routeLine
 * @returns {import('geojson').FeatureCollection}
 */
export function buildSheetLabelCollection(sheetFrames, routeLine = null) {
    const frames = [...(sheetFrames?.features || [])].sort(
        (a, b) => (a.properties?.sheet_number ?? 0) - (b.properties?.sheet_number ?? 0)
    );

    const labels = frames
        .map((frame) => ({
            frame,
            point: buildInitialSheetLabelPoint(frame, routeLine)
        }))
        .filter((entry) => entry.point);

    for (let pass = 0; pass < LABEL_MAX_NUDGE_PASSES; pass++) {
        let adjusted = false;

        for (let i = 0; i < labels.length; i++) {
            for (let j = i + 1; j < labels.length; j++) {
                const a = labels[i];
                const b = labels[j];
                const separation = labelSeparationFt(a.point, b.point);
                if (separation >= SHEET_LABEL_MIN_SEPARATION_FT) continue;

                const aNum = a.frame.properties?.sheet_number ?? i + 1;
                const bNum = b.frame.properties?.sheet_number ?? j + 1;
                const nudgeTarget = aNum <= bNum ? b : a;
                const other = nudgeTarget === a ? b : a;
                const centerFt = Number(nudgeTarget.frame.properties?.center_distance_ft);
                const otherCenter = Number(other.frame.properties?.center_distance_ft);
                const direction = Number.isFinite(otherCenter) && Number.isFinite(centerFt) && otherCenter >= centerFt
                    ? 1
                    : -1;

                let candidate = null;
                for (let step = 1; step <= 4; step++) {
                    const trial = nudgeLabelAlongRoute(
                        nudgeTarget.point,
                        routeLine,
                        centerFt,
                        direction * LABEL_NUDGE_STEP_FT * step
                    );
                    if (!trial) continue;
                    if (!isLabelPointInsideFrame(trial, nudgeTarget.frame)) continue;
                    if (labelSeparationFt(trial, other.point) <= separation) continue;
                    candidate = trial;
                    break;
                }

                if (candidate) {
                    nudgeTarget.point = candidate;
                    adjusted = true;
                }
            }
        }

        if (!adjusted) break;
    }

    return {
        type: 'FeatureCollection',
        features: labels.map((entry) => entry.point)
    };
}
