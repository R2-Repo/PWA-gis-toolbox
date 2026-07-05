import { nearestPointOnLineAny, pointToLineDistanceAny } from '../../tools/line-geojson.js';
import { lineSlice, lineSliceAlong, nearestPointOnLine } from '../../tools/gis-tools.js';
import { OUTPUT_ALIGNMENT, METHOD_VALUES } from './config.js';

const FEET_PER_MILE = 5280;

export function normalizeRouteSearchTerm(term) {
    return String(term ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Expand a route search into multiple alias patterns (hyphen/space variants, numeric fragments).
 * @param {string} searchTerm
 * @returns {string[]}
 */
export function expandRouteSearchPatterns(searchTerm) {
    const term = normalizeRouteSearchTerm(searchTerm);
    if (!term) return [];

    const upper = term.toUpperCase();
    const patterns = new Set();

    const add = (value) => {
        const cleaned = String(value ?? '').trim();
        if (cleaned.length >= 2) patterns.add(cleaned);
    };

    add(upper);
    add(upper.replace(/-/g, ' '));
    add(upper.replace(/[-\s]+/g, ''));
    add(upper.replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim());

    const digits = upper.match(/\d+/g);
    if (digits?.length) {
        for (const part of digits) add(part);
    }

    return [...patterns];
}

export function escapeSqlLiteral(value) {
    return String(value ?? '').replace(/'/g, "''");
}

/**
 * @param {string|number} value
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
export function validateMilepostValue(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        return { valid: false, error: 'Milepost is required.' };
    }

    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
        return { valid: false, error: 'Milepost must be a whole mile or up to two decimal places (e.g. 10.65).' };
    }

    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) {
        return { valid: false, error: 'Milepost must be a non-negative number.' };
    }

    return { valid: true, value: num };
}

/**
 * @param {string|number} start
 * @param {string|number} end
 */
export function validateMilepostRange(start, end) {
    const startResult = validateMilepostValue(start);
    if (!startResult.valid) {
        return { valid: false, errors: [startResult.error || 'Invalid start milepost.'] };
    }

    const endResult = validateMilepostValue(end);
    if (!endResult.valid) {
        return { valid: false, errors: [endResult.error || 'Invalid end milepost.'] };
    }

    if (startResult.value === endResult.value) {
        return { valid: false, errors: ['Start and end mileposts cannot be the same.'] };
    }

    const reversed = startResult.value > endResult.value;
    return {
        valid: true,
        startMp: Math.min(startResult.value, endResult.value),
        endMp: Math.max(startResult.value, endResult.value),
        reversed
    };
}

export function isWholeMilepost(value) {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) && Math.abs(num - Math.round(num)) < 0.0001;
}

export function isTenthMilepost(value) {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) && !isWholeMilepost(num);
}

/**
 * @param {number} startMp
 * @param {number} endMp
 * @param {import('./config.js').UDOT_ROUTE_SEGMENT_CONFIG} config
 */
export function chooseMilepostLayer(startMp, endMp, config) {
    if (isWholeMilepost(startMp) && isWholeMilepost(endMp)) {
        return {
            layerKey: 'whole',
            url: config.milepostWholeLayerUrl,
            label: 'whole-mile'
        };
    }
    return {
        layerKey: 'tenth',
        url: config.milepostTenthLayerUrl,
        label: 'tenth-mile'
    };
}

export function buildRouteCartoCodeWhere(config) {
    const field = config.cartoCodeField;
    const codes = (config.allowedCartoCodes || []).map((code) => `'${escapeSqlLiteral(code)}'`);
    if (!field || codes.length === 0) return '1=1';
    return `${field} IN (${codes.join(', ')})`;
}

export function buildRouteBaseWhere(config) {
    const dir = escapeSqlLiteral(config.positiveDirectionValue);
    const type = escapeSqlLiteral(config.routeTypeValue);
    return `${config.routeDirectionField} = '${dir}' AND ${config.routeTypeField} = '${type}' AND ${buildRouteCartoCodeWhere(config)}`;
}

export function buildRouteSearchBaseWhere(config) {
    const type = escapeSqlLiteral(config.routeTypeValue);
    return `${config.routeTypeField} = '${type}' AND ${buildRouteCartoCodeWhere(config)}`;
}

/**
 * Normalize ROUTE_ALIAS_COMMON for display (e.g. "I 80" → "I-80").
 * @param {string} value
 */
export function normalizeRouteAliasCommon(value) {
    const raw = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!raw) return '';
    return raw.replace(/\s+/g, '-').replace(/-+/g, '-');
}

/**
 * @param {object} row
 * @param {import('./config.js').UDOT_ROUTE_SEGMENT_CONFIG} config
 */
export function formatRouteVariantLabel(row, config) {
    const alias = normalizeRouteAliasCommon(row?.[config.routeAliasField]);
    const stdDir = String(row?.[config.routeAliasStdDirField] ?? '').trim();
    if (alias && stdDir) return `${alias} (${stdDir})`;

    const direction = String(row?.[config.routeDirectionField] ?? '').trim().toUpperCase();
    if (alias && direction) return `${alias} (${direction})`;

    return String(row?.[config.routeIdField] ?? (alias || 'Route'));
}

/**
 * @param {object[]} rows
 * @param {import('./config.js').UDOT_ROUTE_SEGMENT_CONFIG} config
 */
export function mapRouteSearchRows(rows, config) {
    const seen = new Set();
    const mapped = [];

    for (const row of rows || []) {
        const routeId = row?.[config.routeIdField];
        if (!routeId || seen.has(routeId)) continue;
        seen.add(routeId);
        const routeAlias = normalizeRouteAliasCommon(row[config.routeAliasField]) || routeId;
        mapped.push({
            routeId,
            routeAlias,
            routeLabel: routeAlias,
            routeDirection: String(row?.[config.routeDirectionField] ?? '').toUpperCase(),
            raw: row
        });
    }

    return mapped.sort((a, b) => a.routeAlias.localeCompare(b.routeAlias));
}

/**
 * Group route variants by common alias for two-step divided-highway selection.
 * @param {object[]} rows
 * @param {import('./config.js').UDOT_ROUTE_SEGMENT_CONFIG} config
 */
export function groupRouteSearchResults(rows, config) {
    const byAlias = new Map();

    for (const row of rows || []) {
        if (!byAlias.has(row.routeAlias)) byAlias.set(row.routeAlias, []);
        byAlias.get(row.routeAlias).push(row);
    }

    return [...byAlias.entries()]
        .map(([routeAlias, variants]) => {
            const isDivided = variants.length > 1;
            return {
                groupKey: routeAlias,
                routeAlias,
                routeLabel: routeAlias,
                isDivided,
                variants: variants.map((variant) => ({
                    ...variant,
                    routeLabel: isDivided
                        ? formatRouteVariantLabel(variant.raw, config)
                        : routeAlias
                }))
            };
        })
        .sort((a, b) => a.routeLabel.localeCompare(b.routeLabel));
}

export function buildRouteSearchWhere(searchTerm, config) {
    const patterns = expandRouteSearchPatterns(searchTerm);
    if (!patterns.length) return '1=2';

    const alias = config.routeAliasField;
    const clauses = patterns.map((pattern) => {
        const cleaned = escapeSqlLiteral(pattern).replace(/[%_]/g, '');
        return `UPPER(${alias}) LIKE '%${cleaned}%'`;
    });

    return `${buildRouteSearchBaseWhere(config)} AND (${clauses.join(' OR ')})`;
}

export function buildSelectedRouteWhere(routeId, direction, config) {
    const id = escapeSqlLiteral(routeId);
    const dir = escapeSqlLiteral(direction);
    return `${config.routeIdField} = '${id}' AND ${config.routeDirectionField} = '${dir}' AND ${config.routeTypeField} = '${escapeSqlLiteral(config.routeTypeValue)}' AND ${buildRouteCartoCodeWhere(config)}`;
}

export function buildRouteIdWhere(routeId, config) {
    const id = escapeSqlLiteral(routeId);
    return `${config.routeIdField} = '${id}' AND ${buildRouteBaseWhere(config)}`;
}

export function buildMilepostWhere(routeId, minMp, maxMp, config) {
    const id = escapeSqlLiteral(routeId);
    return `${config.milepostRouteIdField} = '${id}' AND ${config.milepostValueField} >= ${minMp} AND ${config.milepostValueField} <= ${maxMp}`;
}

/**
 * Milepost layer query for a requested MP range, expanded by snap tolerance so
 * bracketing tenth-mile points (e.g. 459.8 for 459.81) are included.
 * @param {string} routeId
 * @param {number} startMp
 * @param {number} endMp
 * @param {import('./config.js').UDOT_ROUTE_SEGMENT_CONFIG} config
 * @param {'whole'|'tenth'} [layerKey]
 */
export function buildMilepostRangeWhere(routeId, startMp, endMp, config, layerKey = 'tenth') {
    const snapTolerance = getMilepostSnapTolerance(layerKey, config);
    const minMp = Math.min(startMp, endMp) - snapTolerance;
    const maxMp = Math.max(startMp, endMp) + snapTolerance;
    return buildMilepostWhere(routeId, minMp, maxMp, config);
}

/**
 * @param {'whole'|'tenth'} layerKey
 * @param {import('./config.js').UDOT_ROUTE_SEGMENT_CONFIG} config
 */
export function getMilepostSnapTolerance(layerKey, config) {
    if (layerKey === 'whole') {
        return config.milepostWholeSnapTolerance ?? 0.51;
    }
    return config.milepostSnapTolerance ?? 0.051;
}

export function buildMilepostPointWhere(routeId, mp, config, layerKey = 'tenth') {
    const snapTolerance = getMilepostSnapTolerance(layerKey, config);
    return buildMilepostWhere(routeId, mp - snapTolerance, mp + snapTolerance, config);
}

/**
 * @param {import('geojson').Feature[]} features
 * @param {number} targetMp
 * @param {number} exactTolerance
 * @param {number} snapTolerance
 * @param {string} valueField
 * @returns {{ point: import('geojson').Feature, snapped: boolean, requested: number, resolved: number, snapDistance?: number } | null}
 */
export function resolveMilepostPoint(features, targetMp, exactTolerance, snapTolerance, valueField = 'Measure') {
    let nearestFeature = null;
    let nearestDistance = Infinity;

    for (const feature of features || []) {
        const measure = Number(feature?.properties?.[valueField]);
        if (!Number.isFinite(measure)) continue;

        const distance = Math.abs(measure - targetMp);
        if (distance <= exactTolerance) {
            return {
                point: feature,
                snapped: false,
                requested: targetMp,
                resolved: measure
            };
        }

        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestFeature = feature;
        }
    }

    if (!nearestFeature || nearestDistance > snapTolerance) {
        return null;
    }

    const resolved = Number(nearestFeature.properties?.[valueField]);
    return {
        point: nearestFeature,
        snapped: nearestDistance > exactTolerance,
        requested: targetMp,
        resolved,
        snapDistance: nearestDistance
    };
}

/**
 * @param {import('geojson').Feature[]} features
 * @param {number} startMp
 * @param {number} endMp
 * @param {number} [tolerance]
 * @param {string} [valueField]
 * @param {number} [snapTolerance]
 */
export function findStartEndMilepostPoints(
    features,
    startMp,
    endMp,
    tolerance = 0.001,
    valueField = 'Measure',
    snapTolerance = 0.051
) {
    const missing = [];
    const snaps = [];

    const startResolved = resolveMilepostPoint(features, startMp, tolerance, snapTolerance, valueField);
    const endResolved = resolveMilepostPoint(features, endMp, tolerance, snapTolerance, valueField);

    if (!startResolved) missing.push(startMp);
    else if (startResolved.snapped) snaps.push(startResolved);

    if (!endResolved) missing.push(endMp);
    else if (endResolved.snapped) snaps.push(endResolved);

    return {
        startPoint: startResolved?.point || null,
        endPoint: endResolved?.point || null,
        missing,
        snaps
    };
}

export function buildMilepostSnapWarnings(snaps) {
    return (snaps || [])
        .filter((snap) => snap?.snapped)
        .map((snap) =>
            `Milepost ${formatMilepost(snap.requested)} snapped to nearest measure ${formatMilepost(snap.resolved)} (${snap.snapDistance.toFixed(2)} mi).`
        );
}

/**
 * @param {import('geojson').Feature} positiveLine
 * @param {object} [routeRecord]
 * @param {import('./config.js').UDOT_ROUTE_SEGMENT_CONFIG} config
 */
export function readRouteMileageBounds(positiveLine, routeRecord, config) {
    const begField = config.begMileageField;
    const endField = config.endMileageField;
    const beg = Number(routeRecord?.[begField] ?? positiveLine?.properties?.[begField]);
    const end = Number(routeRecord?.[endField] ?? positiveLine?.properties?.[endField]);

    if (!Number.isFinite(beg) || !Number.isFinite(end)) {
        return { ok: false, error: 'Route mileage bounds are unavailable on the selected route.' };
    }

    if (Math.abs(end - beg) < 0.0001) {
        return { ok: false, error: 'Route mileage range is invalid.' };
    }

    return {
        ok: true,
        beg,
        end,
        minMp: Math.min(beg, end),
        maxMp: Math.max(beg, end)
    };
}

/**
 * @param {number|string|null|undefined} value
 */
export function formatRouteMileage(value) {
    if (value == null || value === '') return '—';
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return num.toFixed(2);
}

/**
 * @param {object} routeContext
 * @param {import('./config.js').UDOT_ROUTE_SEGMENT_CONFIG} config
 */
export function readRouteMileageDisplay(routeContext, config) {
    const record = routeContext?.routeRecord;
    const posLine = routeContext?.routeSelection?.positiveLine;
    const beg = Number(record?.[config.begMileageField] ?? posLine?.properties?.[config.begMileageField]);
    const end = Number(record?.[config.endMileageField] ?? posLine?.properties?.[config.endMileageField]);
    return {
        begMileageFormatted: Number.isFinite(beg) ? formatRouteMileage(beg) : '—',
        endMileageFormatted: Number.isFinite(end) ? formatRouteMileage(end) : '—'
    };
}

/**
 * @param {number} targetMp
 * @param {number} begMp
 * @param {number} endMp
 * @param {number} lineLengthFeet
 */
export function milepostToDistanceFeet(targetMp, begMp, endMp, lineLengthFeet) {
    const t = (Number(targetMp) - Number(begMp)) / (Number(endMp) - Number(begMp));
    return t * lineLengthFeet;
}

/**
 * @param {number} distanceFeet
 * @param {number} begMp
 * @param {number} endMp
 * @param {number} lineLengthFeet
 */
export function distanceFeetToMilepost(distanceFeet, begMp, endMp, lineLengthFeet) {
    const len = Number(lineLengthFeet);
    if (!Number.isFinite(len) || len <= 0) return null;
    const t = Number(distanceFeet) / len;
    return Number(begMp) + t * (Number(endMp) - Number(begMp));
}

/**
 * Locate an exact milepost along the route centerline via BEG/END linear referencing.
 * @param {import('geojson').Feature} positiveLine
 * @param {number} targetMp
 * @param {object} [routeRecord]
 * @param {import('./config.js').UDOT_ROUTE_SEGMENT_CONFIG} config
 */
export function locateMilepostOnRoute(positiveLine, targetMp, routeRecord, config) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const bounds = readRouteMileageBounds(positiveLine, routeRecord, config);
    if (!bounds.ok) {
        return { ok: false, error: bounds.error };
    }

    const mp = Number(targetMp);
    if (!Number.isFinite(mp)) {
        return { ok: false, error: 'Milepost must be a number.' };
    }

    if (mp < bounds.minMp - 0.001 || mp > bounds.maxMp + 0.001) {
        return {
            ok: false,
            error: `Milepost ${formatMilepost(mp)} is outside route mileage (${formatMilepost(bounds.beg)}–${formatMilepost(bounds.end)}).`
        };
    }

    const lineLengthFeet = turf.length(positiveLine, { units: 'feet' });
    if (!Number.isFinite(lineLengthFeet) || lineLengthFeet <= 0) {
        return { ok: false, error: 'Route centerline length is invalid.' };
    }

    const distanceFeet = milepostToDistanceFeet(mp, bounds.beg, bounds.end, lineLengthFeet);
    const clampedFeet = Math.max(0, Math.min(distanceFeet, lineLengthFeet));
    const point = turf.along(positiveLine, clampedFeet, { units: 'feet' });
    point.properties = {
        ...(point.properties || {}),
        [config.milepostValueField]: mp,
        milepost: formatMilepost(mp),
        located_by: 'linear_referencing'
    };

    return { ok: true, point, distanceFeet: clampedFeet, bounds };
}

function lineLengthValue(feature, config) {
    const fromAttr = Number(feature?.properties?.[config.routeLengthField]);
    if (Number.isFinite(fromAttr) && fromAttr > 0) return fromAttr;
    if (typeof turf !== 'undefined' && feature?.geometry) {
        return turf.length(feature, { units: 'meters' });
    }
    return 0;
}

/**
 * @param {import('geojson').Feature[]} features
 * @param {import('./config.js').UDOT_ROUTE_SEGMENT_CONFIG} config
 * @param {object} [routeRecord]
 */
export function selectRouteFeatures(features, config, routeRecord = null) {
    const warnings = [];
    const positiveDir = String(config.positiveDirectionValue).toUpperCase();
    const negativeDir = String(config.negativeDirectionValue).toUpperCase();
    const selectedDir = String(
        routeRecord?.[config.routeDirectionField] ?? config.positiveDirectionValue
    ).toUpperCase();
    const primaryDir = selectedDir === negativeDir ? negativeDir : positiveDir;
    const secondaryDir = primaryDir === positiveDir ? negativeDir : positiveDir;
    const primaryLabel = primaryDir === positiveDir ? 'positive' : 'negative';
    const secondaryLabel = secondaryDir === positiveDir ? 'positive' : 'negative';

    const primaryCandidates = (features || []).filter((feature) =>
        feature?.geometry &&
        String(feature.properties?.[config.routeDirectionField] ?? '').toUpperCase() === primaryDir
    );

    const secondaryCandidates = (features || []).filter((feature) =>
        feature?.geometry &&
        String(feature.properties?.[config.routeDirectionField] ?? '').toUpperCase() === secondaryDir
    );

    if (primaryCandidates.length === 0) {
        return {
            positiveLine: null,
            negativeLine: null,
            warnings: [`No ${primaryLabel}-direction route centerline found for the selected route.`]
        };
    }

    if (primaryCandidates.length > 1) {
        warnings.push(`Multiple ${primaryLabel}-direction route features found; using the longest segment.`);
    }

    const positiveLine = primaryCandidates.reduce((best, current) => {
        if (!best) return current;
        return lineLengthValue(current, config) > lineLengthValue(best, config) ? current : best;
    }, null);

    let negativeLine = null;
    if (secondaryCandidates.length > 0) {
        negativeLine = secondaryCandidates.reduce((best, current) => {
            if (!best) return current;
            return lineLengthValue(current, config) > lineLengthValue(best, config) ? current : best;
        }, null);
    }

    return { positiveLine, negativeLine, warnings };
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} routeLine
 * @param {import('geojson').Feature<import('geojson').Point>} startPoint
 * @param {import('geojson').Feature<import('geojson').Point>} endPoint
 */
export function snapMilepostsToRoute(routeLine, startPoint, endPoint) {
    const startSnap = nearestPointOnLine(routeLine, startPoint, 'miles');
    const endSnap = nearestPointOnLine(routeLine, endPoint, 'miles');
    return { startSnap, endSnap };
}

/**
 * @param {import('geojson').Feature} routeLine
 * @param {import('geojson').Feature<import('geojson').Point>} startSnap
 * @param {import('geojson').Feature<import('geojson').Point>} endSnap
 */
export function sliceRouteBetweenMileposts(routeLine, startSnap, endSnap) {
    return lineSlice(startSnap, endSnap, routeLine);
}

/**
 * @param {number[]} values
 */
export function median(values) {
    const nums = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (nums.length === 0) return 0;
    const mid = Math.floor(nums.length / 2);
    if (nums.length % 2 === 0) {
        return (nums[mid - 1] + nums[mid]) / 2;
    }
    return nums[mid];
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} line
 * @param {number} [segmentLengthMiles]
 */
export function sampleLineForSeparation(line, segmentLengthMiles = 0) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const lengthMiles = turf.length(line, { units: 'miles' });
    const byQuarterMile = Math.max(1, Math.ceil(lengthMiles / 0.25));
    const count = Math.min(25, Math.max(7, byQuarterMile));
    const samples = [];

    for (let i = 0; i < count; i++) {
        const dist = count === 1 ? 0 : (lengthMiles * i) / (count - 1);
        samples.push(turf.along(line, dist, { units: 'miles' }));
    }

    return samples;
}

/**
 * @param {import('geojson').Feature<import('geojson').Point>[]} samplePoints
 * @param {import('geojson').Feature} referenceLine
 * @param {string} [units]
 */
export function measureDistancesToReferenceLine(samplePoints, referenceLine, units = 'feet') {
    return (samplePoints || []).map((point) =>
        pointToLineDistanceAny(point, referenceLine, units)
    );
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} positiveSegment
 * @param {import('geojson').Feature} referenceLine
 * @param {number} offsetDistanceFeet
 * @param {string} [units]
 */
export function chooseOffsetDirectionTowardReferenceLine(positiveSegment, referenceLine, offsetDistanceFeet, units = 'feet') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const miles = offsetDistanceFeet / FEET_PER_MILE;
    const positiveOffset = turf.lineOffset(positiveSegment, miles, { units: 'miles' });
    const negativeOffset = turf.lineOffset(positiveSegment, -miles, { units: 'miles' });

    const samplePoints = sampleLineForSeparation(positiveSegment);
    const baseline = measureDistancesToReferenceLine(samplePoints, referenceLine, units);
    const baselineAvg = baseline.reduce((sum, d) => sum + d, 0) / Math.max(baseline.length, 1);

    const positiveDistances = samplePoints.map((point) => {
        const nearest = nearestPointOnLineAny(point, positiveOffset, units);
        const refNearest = nearestPointOnLineAny(point, referenceLine, units);
        return turf.distance(nearest, refNearest, { units });
    });
    const negativeDistances = samplePoints.map((point) => {
        const nearest = nearestPointOnLineAny(point, negativeOffset, units);
        const refNearest = nearestPointOnLineAny(point, referenceLine, units);
        return turf.distance(nearest, refNearest, { units });
    });

    const positiveAvg = positiveDistances.reduce((sum, d) => sum + d, 0) / Math.max(positiveDistances.length, 1);
    const negativeAvg = negativeDistances.reduce((sum, d) => sum + d, 0) / Math.max(negativeDistances.length, 1);

    if (positiveAvg <= negativeAvg && positiveAvg < baselineAvg) return 'positive';
    if (negativeAvg < positiveAvg && negativeAvg < baselineAvg) return 'negative';
    return positiveAvg <= negativeAvg ? 'positive' : 'negative';
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} positiveSegment
 * @param {import('geojson').Feature} referenceLine
 */
export function buildApproximateMedianLine(positiveSegment, referenceLine) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const samplePoints = sampleLineForSeparation(positiveSegment);
    const distancesFeet = measureDistancesToReferenceLine(samplePoints, referenceLine, 'feet');
    const medianSeparationFeet = median(distancesFeet);
    const offsetFeet = medianSeparationFeet / 2;
    const offsetMiles = offsetFeet / FEET_PER_MILE;

    const direction = chooseOffsetDirectionTowardReferenceLine(positiveSegment, referenceLine, offsetFeet, 'feet');
    const signedMiles = direction === 'positive' ? offsetMiles : -offsetMiles;
    const geometry = turf.lineOffset(positiveSegment, signedMiles, { units: 'miles' });

    return {
        ...geometry,
        medianSeparationFeet,
        offsetFeet,
        offsetDirection: direction
    };
}

export function formatMilepost(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value ?? '');
    if (isWholeMilepost(num)) return String(Math.round(num));
    const rounded = Math.round(num * 100) / 100;
    return rounded.toFixed(2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/**
 * @param {string} routeAlias
 * @param {number} startMp
 * @param {number} endMp
 * @param {string} alignment
 */
export function buildOutputLayerName(routeAlias, startMp, endMp, alignment) {
    const alias = routeAlias || 'Route';
    const startLabel = formatMilepost(startMp);
    const endLabel = formatMilepost(endMp);
    if (alignment === OUTPUT_ALIGNMENT.APPROXIMATE_MEDIAN) {
        return `${alias} MP ${startLabel} to ${endLabel} Median Approx`;
    }
    return `${alias} MP ${startLabel} to ${endLabel} Centerline`;
}

/**
 * @param {number|null|undefined} value
 * @param {number} [decimals]
 */
function roundLength(value, decimals = 2) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 10 ** decimals) / 10 ** decimals;
}

/**
 * @param {object} input
 * @param {string} input.routeAlias
 * @param {number} input.startMp
 * @param {number} input.endMp
 * @param {import('geojson').Feature} input.outputGeometry
 */
export function buildRouteCenterlineOutputProperties({ routeAlias, startMp, endMp, outputGeometry }) {
    const lengthMiles = typeof turf !== 'undefined'
        ? turf.length(outputGeometry, { units: 'miles' })
        : null;
    const lengthFeet = typeof turf !== 'undefined'
        ? turf.length(outputGeometry, { units: 'feet' })
        : null;
    return {
        route_alias_common: routeAlias,
        start_milepost: startMp,
        end_milepost: endMp,
        length_miles: roundLength(lengthMiles),
        length_feet: roundLength(lengthFeet),
        Name: '',
        ID: '',
        Future1: '',
        Future2: ''
    };
}

/**
 * @param {import('geojson').Feature} geometryFeature
 * @param {object} attrs
 */
export function buildOutputFeature(geometryFeature, attrs = {}) {
    return {
        type: 'Feature',
        geometry: geometryFeature.geometry,
        properties: { ...attrs }
    };
}

/**
 * @param {object} options
 */
export function buildWarnings(options = {}) {
    const warnings = [...(options.extraWarnings || [])];
    if (options.alignment === OUTPUT_ALIGNMENT.APPROXIMATE_MEDIAN) {
        warnings.push(
            'Approximate median mode offsets the positive-direction route segment halfway toward the opposite-direction reference line. It is intended for clean visual/export geometry, not survey-grade route geometry.'
        );
    }
    if (options.dividedHighwayDetected === false && options.alignment === OUTPUT_ALIGNMENT.APPROXIMATE_MEDIAN) {
        warnings.push('No opposite-direction reference line was found; approximate median mode is unavailable.');
    }
    return warnings;
}

/**
 * @param {object} input
 */
export function computeSegmentResult(input) {
    const {
        positiveLine,
        negativeLine,
        milepostFeatures,
        startMp,
        endMp,
        alignment,
        config,
        milepostLayerKey,
        routeMeta = {}
    } = input;

    const errors = [];
    const warnings = [];

    if (!positiveLine) {
        return { ok: false, errors: ['Positive-direction route centerline is required.'] };
    }

    const routeRecord = routeMeta.routeRecord ?? positiveLine.properties ?? {};
    const startLocated = locateMilepostOnRoute(positiveLine, startMp, routeRecord, config);
    if (!startLocated.ok) {
        return { ok: false, errors: [startLocated.error || `Milepost point not found for: ${formatMilepost(startMp)}.`] };
    }

    const endLocated = locateMilepostOnRoute(positiveLine, endMp, routeRecord, config);
    if (!endLocated.ok) {
        return { ok: false, errors: [endLocated.error || `Milepost point not found for: ${formatMilepost(endMp)}.`] };
    }

    const startPoint = startLocated.point;
    const endPoint = endLocated.point;
    const startSnap = startPoint;
    const endSnap = endPoint;
    const lowDist = Math.min(startLocated.distanceFeet, endLocated.distanceFeet);
    const highDist = Math.max(startLocated.distanceFeet, endLocated.distanceFeet);
    const centerlineSegment = lineSliceAlong(positiveLine, lowDist, highDist, 'feet');

    let outputGeometry = centerlineSegment;
    let medianSeparationFeet = null;
    let medianOffsetFeet = null;
    const dividedHighwayDetected = Boolean(negativeLine);

    if (alignment === OUTPUT_ALIGNMENT.APPROXIMATE_MEDIAN) {
        if (!negativeLine) {
            errors.push('Approximate divided-highway median mode requires an opposite-direction reference line.');
            return { ok: false, errors };
        }
        const medianResult = buildApproximateMedianLine(centerlineSegment, negativeLine);
        outputGeometry = medianResult;
        medianSeparationFeet = medianResult.medianSeparationFeet;
        medianOffsetFeet = medianResult.offsetFeet;
    }

    const lengthMiles = typeof turf !== 'undefined'
        ? turf.length(outputGeometry, { units: 'miles' })
        : null;

    const routeAlias = routeMeta.routeAlias
        || positiveLine.properties?.[config.routeAliasField]
        || routeMeta.routeId
        || 'Route';
    const routeId = routeMeta.routeId || positiveLine.properties?.[config.routeIdField] || '';

    const outputFeature = buildOutputFeature(outputGeometry, buildRouteCenterlineOutputProperties({
        routeAlias,
        startMp,
        endMp,
        outputGeometry
    }));

    const summary = {
        routeAlias,
        routeId,
        startMp,
        endMp,
        milepostLayerUsed: milepostLayerKey === 'whole' ? 'whole-mile' : 'tenth-mile',
        alignment,
        lengthMiles,
        dividedHighwayDetected,
        medianSeparationFeet,
        medianOffsetFeet
    };

    warnings.push(...buildWarnings({
        alignment,
        dividedHighwayDetected,
        extraWarnings: input.extraWarnings || []
    }));

    return {
        ok: true,
        outputFeature,
        centerlineSegment,
        startPoint,
        endPoint,
        startSnap,
        endSnap,
        summary,
        warnings,
        errors
    };
}

/**
 * @param {object} result
 */
export function buildPreviewSummary(result) {
    if (!result?.summary) return null;
    return {
        ...result.summary,
        warnings: result.warnings || []
    };
}

/** @deprecated scaffold compat — use validateMilepostRange */
export function validateRouteMilepostSegmentConfig(config = {}) {
    const range = validateMilepostRange(config.startMilepost, config.endMilepost);
    if (!range.valid) {
        return { valid: false, errors: range.errors || ['Invalid milepost range.'] };
    }
    if (!config.routeId) {
        return { valid: false, errors: ['Route is required.'] };
    }
    return { valid: true, errors: [] };
}

/** @deprecated scaffold compat */
export async function runRouteMilepostSegment(config = {}) {
    const validation = validateRouteMilepostSegmentConfig(config);
    if (!validation.valid) {
        throw new Error(validation.errors[0] || 'Invalid configuration.');
    }
    return { ok: true };
}
