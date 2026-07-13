import { lineSliceAlong } from '../../tools/gis-tools.js';
import { nearestPointOnLineAny } from '../../tools/line-geojson.js';
import { validateMilepostValue, validateMilepostRange } from '../route-milepost-segment/engine.js';

export const DEFAULT_INTERVAL_FT = 100;
const FEET_PER_MILE = 5280;

export const DEFAULT_STATIONING_GRAPHICS = {
    tickLengthFt: 30,
    majorTickLengthFt: 50,
    majorIntervalFt: 500,
    labelOffsetFt: 35,
    labelSide: 'right',
    labelIntervalFt: null,
    tangentSampleFt: 10,
    includeBeginEndMarkers: false,
    centerlineOffsetFt: 0,
    centerlineOffsetSide: 'right'
};

export const CLIP_METHODS = {
    MILEPOST: 'milepost',
    MAP_PICK: 'map_pick',
    FULL_ROUTE: 'full_route',
    DRAWN: 'drawn',
    BOX: 'box',
    CIRCLE: 'circle',
    POLYGON: 'polygon'
};

export const ROUTE_SOURCE_UDOT = 'udot';

export {
    ROUTE_SOURCE_DRAWN,
    ROUTE_SOURCE_IMPORTED,
    CUSTOM_ROUTE_SOURCES,
    isCustomRouteSource,
    buildDrawnRouteContext,
    buildCustomRouteContext,
    resolveCenterlineFromLayer
} from './drawn-route.js';

/**
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
export function formatRouteMileage(value) {
    if (value == null || value === '') return '—';
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return num.toFixed(2);
}

/**
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
export function parseRouteMileage(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

/**
 * Resolve milepost inputs for live clip preview (supports partial start/end using route endpoints).
 * @param {string|number} startMilepost
 * @param {string|number} endMilepost
 * @param {number|null} routeBegMileage
 * @param {number|null} routeEndMileage
 * @returns {{ ok: true, startMilepost: string, endMilepost: string, partial: boolean } | { ok: false }}
 */
export function resolvePartialMilepostClipInputs(startMilepost, endMilepost, routeBegMileage, routeEndMileage) {
    const startTrim = String(startMilepost ?? '').trim();
    const endTrim = String(endMilepost ?? '').trim();

    if (startTrim && endTrim) {
        const range = validateMilepostRange(startTrim, endTrim);
        if (range.valid) {
            return {
                ok: true,
                startMilepost: String(range.startMp),
                endMilepost: String(range.endMp),
                partial: false
            };
        }
        return { ok: false };
    }

    if (startTrim) {
        const startResult = validateMilepostValue(startTrim);
        if (startResult.valid && routeEndMileage != null) {
            return {
                ok: true,
                startMilepost: String(startResult.value),
                endMilepost: String(routeEndMileage),
                partial: true
            };
        }
        return { ok: false };
    }

    if (endTrim) {
        const endResult = validateMilepostValue(endTrim);
        if (endResult.valid && routeBegMileage != null) {
            return {
                ok: true,
                startMilepost: String(routeBegMileage),
                endMilepost: String(endResult.value),
                partial: true
            };
        }
        return { ok: false };
    }

    return { ok: false };
}

/**
 * Milepost range along clipped portion for LM tenth milepost layer query.
 * @param {object} clip
 * @param {object} routeContext
 * @param {object} config
 */
export function resolveClipMilepostRange(clip, routeContext, config) {
    const posLine = routeContext?.routeSelection?.positiveLine;
    const record = routeContext?.routeRecord;
    const begField = config.begMileageField;
    const endField = config.endMileageField;

    const readBeg = () => parseRouteMileage(
        record?.[begField] ?? posLine?.properties?.[begField]
    );
    const readEnd = () => parseRouteMileage(
        record?.[endField] ?? posLine?.properties?.[endField]
    );

    if (clip?.range?.startMp != null && clip?.range?.endMp != null) {
        const minMp = Math.min(clip.range.startMp, clip.range.endMp);
        const maxMp = Math.max(clip.range.startMp, clip.range.endMp);
        return { ok: true, minMp, maxMp };
    }

    const beg = readBeg();
    const end = readEnd();

    if (clip?.mapClipStartFt != null && clip?.mapClipEndFt != null && beg != null && end != null && posLine) {
        const totalLen = lineLengthFeet(posLine);
        if (totalLen <= 0) return { ok: false, needsSpatialFilter: true };
        const t0 = Number(clip.mapClipStartFt) / totalLen;
        const t1 = Number(clip.mapClipEndFt) / totalLen;
        const mp0 = beg + t0 * (end - beg);
        const mp1 = beg + t1 * (end - beg);
        return {
            ok: true,
            minMp: Math.min(mp0, mp1),
            maxMp: Math.max(mp0, mp1)
        };
    }

    if (beg != null && end != null) {
        return { ok: true, minMp: Math.min(beg, end), maxMp: Math.max(beg, end) };
    }

    return { ok: false, needsSpatialFilter: true };
}

/**
 * Milepost values at the start and end of a clipped centerline (for linear referencing).
 * @param {object} clip
 * @param {object} routeContext
 * @param {object} config
 * @returns {{ startMp: number, endMp: number }|null}
 */
export function resolveClipMilepostEndpoints(clip, routeContext, config) {
    if (clip?.range?.startMp != null && clip?.range?.endMp != null) {
        return normalizeMilepostEndpointsForLine(
            clip.range.startMp,
            clip.range.endMp,
            routeContext,
            config
        );
    }

    const posLine = routeContext?.routeSelection?.positiveLine;
    const record = routeContext?.routeRecord;
    const begField = config.begMileageField;
    const endField = config.endMileageField;
    const beg = parseRouteMileage(record?.[begField] ?? posLine?.properties?.[begField]);
    const end = parseRouteMileage(record?.[endField] ?? posLine?.properties?.[endField]);

    if (beg == null || end == null) return null;

    if (clip?.mapClipStartFt != null && clip?.mapClipEndFt != null && posLine) {
        const totalLen = lineLengthFeet(posLine);
        if (totalLen <= 0) return null;
        const startDist = Math.min(Number(clip.mapClipStartFt), Number(clip.mapClipEndFt));
        const endDist = Math.max(Number(clip.mapClipStartFt), Number(clip.mapClipEndFt));
        const t0 = startDist / totalLen;
        const t1 = endDist / totalLen;
        return {
            startMp: beg + t0 * (end - beg),
            endMp: beg + t1 * (end - beg)
        };
    }

    return { startMp: beg, endMp: end };
}

/**
 * Milepost clip slices always run low→high distance on the route line.
 * Store begin/end MP at geometry start/end, not user entry order.
 * @param {number|string} startMp
 * @param {number|string} endMp
 * @param {object} routeContext
 * @param {object} config
 */
export function normalizeMilepostEndpointsForLine(startMp, endMp, routeContext, config) {
    const a = Number(startMp);
    const b = Number(endMp);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
        return { startMp: a, endMp: b };
    }

    const posLine = routeContext?.routeSelection?.positiveLine;
    const record = routeContext?.routeRecord;
    const begField = config?.begMileageField || 'BEG_MILEAGE';
    const endField = config?.endMileageField || 'END_MILEAGE';
    const routeBeg = parseRouteMileage(record?.[begField] ?? posLine?.properties?.[begField]);
    const routeEnd = parseRouteMileage(record?.[endField] ?? posLine?.properties?.[endField]);

    if (routeBeg != null && routeEnd != null && routeBeg > routeEnd) {
        return { startMp: Math.max(a, b), endMp: Math.min(a, b) };
    }
    return { startMp: Math.min(a, b), endMp: Math.max(a, b) };
}

const STATION_PLUS_PATTERN = /^(\d+)\+(\d+(?:\.\d+)?)$/;

/**
 * Parse civil station notation or raw feet.
 * @param {string|number} value
 * @returns {number|null}
 */
export function parseStation(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    const plusMatch = raw.match(STATION_PLUS_PATTERN);
    if (plusMatch) {
        const hundreds = Number(plusMatch[1]);
        const remainder = Number(plusMatch[2]);
        if (!Number.isFinite(hundreds) || !Number.isFinite(remainder) || remainder >= 100) {
            return null;
        }
        return hundreds * 100 + remainder;
    }

    if (/^\d+(\.\d+)?$/.test(raw)) {
        const num = Number(raw);
        return Number.isFinite(num) && num >= 0 ? num : null;
    }

    return null;
}

/**
 * @param {number} feet
 * @returns {string}
 */
export function formatStation(feet) {
    const num = Number(feet);
    if (!Number.isFinite(num)) return String(feet ?? '');

    const hundreds = Math.floor(num / 100);
    const remainder = num - hundreds * 100;
    const remainderStr = Math.abs(remainder - Math.round(remainder)) < 0.001
        ? String(Math.round(remainder)).padStart(2, '0')
        : remainder.toFixed(2).padStart(5, '0').replace(/^0/, '');

    return `${hundreds}+${remainderStr}`;
}

/**
 * @param {string|number} value
 */
export function validateStation(value) {
    const parsed = parseStation(value);
    if (parsed == null) {
        return { valid: false, error: 'Enter a station like 817+15 or raw feet.' };
    }
    return { valid: true, value: parsed };
}

/**
 * @param {number} beginStationFeet
 * @param {number} endStationFeet
 * @param {number} [intervalFeet]
 * @returns {number[]}
 */
export function computeStationBreaks(beginStationFeet, endStationFeet, intervalFeet = DEFAULT_INTERVAL_FT) {
    const begin = Number(beginStationFeet);
    const end = Number(endStationFeet);
    const interval = Number(intervalFeet);
    if (!Number.isFinite(begin) || !Number.isFinite(end) || !Number.isFinite(interval) || interval <= 0) {
        return [];
    }

    if (Math.abs(begin - end) < 0.001) {
        return [begin];
    }

    const minSta = Math.min(begin, end);
    const maxSta = Math.max(begin, end);
    const breaks = [begin];

    let nextRound = Math.ceil(minSta / interval) * interval;
    while (nextRound < maxSta - 0.001) {
        if (nextRound > minSta + 0.001 && nextRound < maxSta - 0.001) {
            breaks.push(nextRound);
        }
        nextRound += interval;
    }

    if (Math.abs(breaks[breaks.length - 1] - end) > 0.001) {
        breaks.push(end);
    }

    return breaks;
}

function lineLengthFeet(line) {
    if (typeof turf === 'undefined' || !line?.geometry) return 0;
    return turf.length(line, { units: 'feet' });
}

/**
 * @param {import('geojson').Geometry} geometry
 * @returns {import('geojson').LineString[]}
 */
export function extractLineStringGeometries(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'LineString') return [geometry];
    if (geometry.type === 'MultiLineString') {
        return geometry.coordinates.map((coords) => ({ type: 'LineString', coordinates: coords }));
    }
    return [];
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>[]} lines
 * @returns {import('geojson').Feature<import('geojson').LineString>|null}
 */
export function pickLongestLineFeature(lines) {
    if (!lines?.length) return null;
    return lines.reduce((best, current) => {
        if (!best) return current;
        return lineLengthFeet(current) > lineLengthFeet(best) ? current : best;
    }, null);
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} centerline
 * @param {import('geojson').Feature|import('geojson').Polygon} clipArea
 * @param {object} [options]
 */
export function clipCenterlineToArea(centerline, clipArea, options = {}) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const minLengthFt = Number(options.minLengthFt) || DEFAULT_INTERVAL_FT;
    const clipFeature = clipArea?.type === 'Feature' ? clipArea : turf.feature(clipArea);

    let lineFeatures = [];

    try {
        const intersection = turf.intersect(turf.featureCollection([clipFeature, centerline]));
        if (intersection?.geometry) {
            lineFeatures = extractLineStringGeometries(intersection.geometry).map((geom) => ({
                type: 'Feature',
                geometry: geom,
                properties: { ...(centerline.properties || {}) }
            }));
        }
    } catch (_) { /* fall through to lineSplit */ }

    if (lineFeatures.length === 0) {
        try {
            const boundary = turf.polygonToLine(clipFeature);
            const split = turf.lineSplit(centerline, boundary);
            for (const part of split.features || []) {
                if (!part?.geometry) continue;
                const len = lineLengthFeet(part);
                if (len < 0.01) continue;
                const mid = turf.along(part, len / 2, { units: 'feet' });
                if (turf.booleanPointInPolygon(mid, clipFeature)) {
                    lineFeatures.push({
                        type: 'Feature',
                        geometry: part.geometry,
                        properties: { ...(centerline.properties || {}) }
                    });
                }
            }
        } catch (_) { /* ignore */ }
    }

    const longest = pickLongestLineFeature(lineFeatures);
    if (!longest) {
        return { ok: false, errors: ['No centerline within clip area.'] };
    }

    const lengthFeet = lineLengthFeet(longest);
    const warnings = [];
    if (lineFeatures.length > 1) {
        warnings.push('Multiple centerline portions found inside clip area; using the longest segment.');
    }
    if (lengthFeet < minLengthFt) {
        return {
            ok: false,
            errors: [`Clipped centerline (${lengthFeet.toFixed(1)} ft) is shorter than interval (${minLengthFt} ft).`]
        };
    }

    return { ok: true, centerline: longest, lengthFeet, warnings };
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} centerline
 * @param {number[]} bbox
 * @param {object} [options]
 */
export function clipCenterlineToBbox(centerline, bbox, options = {}) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const minLengthFt = Number(options.minLengthFt) || DEFAULT_INTERVAL_FT;
    let clipped = null;
    try {
        clipped = turf.bboxClip(centerline, bbox);
    } catch (_) {
        clipped = null;
    }

    if (!clipped?.geometry) {
        return { ok: false, errors: ['No centerline within clip box.'] };
    }

    const lineGeoms = extractLineStringGeometries(clipped.geometry);
    const lineFeatures = lineGeoms.map((geom) => ({
        type: 'Feature',
        geometry: geom,
        properties: { ...(centerline.properties || {}) }
    }));

    const longest = pickLongestLineFeature(lineFeatures);
    if (!longest) {
        return { ok: false, errors: ['No centerline within clip box.'] };
    }

    const lengthFeet = lineLengthFeet(longest);
    const warnings = [];
    if (lineFeatures.length > 1) {
        warnings.push('Multiple centerline portions found inside clip box; using the longest segment.');
    }
    if (lengthFeet < minLengthFt) {
        return {
            ok: false,
            errors: [`Clipped centerline (${lengthFeet.toFixed(1)} ft) is shorter than interval (${minLengthFt} ft).`]
        };
    }

    return { ok: true, centerline: longest, lengthFeet, warnings };
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} line
 * @param {number} startOffsetFt
 * @param {number} endOffsetFt
 * @returns {import('geojson').Feature<import('geojson').LineString>|null}
 */
export function trimCenterlineByOffsets(line, startOffsetFt = 0, endOffsetFt = 0) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const totalFeet = lineLengthFeet(line);
    const startDist = Math.max(0, Number(startOffsetFt) || 0);
    const endDist = totalFeet - Math.max(0, Number(endOffsetFt) || 0);

    if (endDist - startDist < 0.01) {
        return null;
    }

    return lineSliceAlong(line, startDist, endDist, 'feet');
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} line
 * @param {number} beginStationFeet
 * @param {number} endStationFeet
 */
export function trimCenterlineByEndStation(line, beginStationFeet, endStationFeet) {
    const physicalLen = lineLengthFeet(line);
    const maxLen = endStationFeet - beginStationFeet;
    if (!Number.isFinite(maxLen) || maxLen <= 0) return null;
    if (maxLen >= physicalLen - 0.01) return line;
    return lineSliceAlong(line, 0, maxLen, 'feet');
}

/**
 * @param {number} startOffsetFt
 * @param {number} endOffsetFt
 * @param {number} lineLengthFt
 * @param {number} [minLengthFt]
 */
export function validateTrimOffsets(startOffsetFt, endOffsetFt, lineLengthFt, minLengthFt = DEFAULT_INTERVAL_FT) {
    const start = Math.max(0, Number(startOffsetFt) || 0);
    const end = Math.max(0, Number(endOffsetFt) || 0);
    const remaining = lineLengthFt - start - end;

    if (remaining < minLengthFt) {
        return {
            valid: false,
            error: `Trimmed segment must be at least ${minLengthFt} ft (remaining: ${Math.max(0, remaining).toFixed(1)} ft).`
        };
    }
    return { valid: true, remainingLengthFt: remaining };
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} workingLine
 * @param {number[]} breaks
 * @param {number} beginStationFeet
 * @param {object} routeMeta
 * @param {object} clipMeta
 */
export function generateStationPoints(workingLine, breaks, beginStationFeet, routeMeta = {}, clipMeta = {}) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    return (breaks || []).map((sta, index) => {
        const distFeet = sta - beginStationFeet;
        const pt = turf.along(workingLine, distFeet, { units: 'feet' });
        return {
            type: 'Feature',
            geometry: pt.geometry,
            properties: {
                station: formatStation(sta),
                station_ft: sta,
                point_index: index,
                route_id: routeMeta.routeId || '',
                route_alias: routeMeta.routeAlias || '',
                clip_method: clipMeta.clipMethod || CLIP_METHODS.MILEPOST,
                begin_milepost: clipMeta.mileposts?.startMp ?? null,
                end_milepost: clipMeta.mileposts?.endMp ?? null,
                interval_ft: clipMeta.intervalFeet ?? DEFAULT_INTERVAL_FT,
                created_at: new Date().toISOString()
            }
        };
    });
}

function resolveWorkingLineAndStations(centerline, beginStationFeet, explicitEndStationFeet, intervalFeet) {
    const physicalLen = lineLengthFeet(centerline);
    const beginSta = Number(beginStationFeet);

    let endSta = explicitEndStationFeet != null && explicitEndStationFeet !== ''
        ? Number(explicitEndStationFeet)
        : beginSta + physicalLen;

    if (!Number.isFinite(endSta) || endSta <= beginSta) {
        return { ok: false, errors: ['End station must be greater than begin station.'] };
    }

    let workingLine = centerline;
    if (endSta < beginSta + physicalLen - 0.01) {
        workingLine = trimCenterlineByEndStation(centerline, beginSta, endSta);
        if (!workingLine) {
            return { ok: false, errors: ['Unable to trim centerline to end station.'] };
        }
    } else {
        endSta = beginSta + lineLengthFeet(workingLine);
    }

    const workingLen = lineLengthFeet(workingLine);
    if (workingLen < intervalFeet) {
        return {
            ok: false,
            errors: [`Centerline length (${workingLen.toFixed(1)} ft) is shorter than interval (${intervalFeet} ft).`]
        };
    }

    const breaks = computeStationBreaks(beginSta, endSta, intervalFeet);
    if (breaks.length < 1) {
        return { ok: false, errors: ['Need at least one station break.'] };
    }

    return { ok: true, workingLine, beginSta, endSta, breaks, workingLen };
}

/**
 * @param {object} options
 */
export function generateProjectStationingOutput(options = {}) {
    const {
        centerline,
        beginStationFeet,
        endStationFeet: explicitEndStationFeet,
        intervalFeet = DEFAULT_INTERVAL_FT,
        routeMeta = {},
        clipMeta = {}
    } = options;

    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    if (!centerline?.geometry) {
        return { ok: false, errors: ['Centerline geometry is required.'] };
    }

    const beginSta = Number(beginStationFeet);
    if (!Number.isFinite(beginSta)) {
        return { ok: false, errors: ['Begin station is required.'] };
    }

    const resolved = resolveWorkingLineAndStations(
        centerline,
        beginSta,
        explicitEndStationFeet,
        intervalFeet
    );
    if (!resolved.ok) return resolved;

    const { workingLine, endSta, breaks, workingLen } = resolved;
    const stationPoints = generateStationPoints(workingLine, breaks, beginSta, routeMeta, {
        ...clipMeta,
        intervalFeet
    });

    const centerlineFeature = {
        type: 'Feature',
        geometry: workingLine.geometry,
        properties: {
            station_begin: formatStation(beginSta),
            station_end: formatStation(endSta),
            station_begin_ft: beginSta,
            station_end_ft: endSta,
            length_ft: Math.round(workingLen * 100) / 100,
            clip_method: clipMeta.clipMethod || CLIP_METHODS.MILEPOST,
            route_id: routeMeta.routeId || '',
            route_alias: routeMeta.routeAlias || '',
            begin_milepost: clipMeta.mileposts?.startMp ?? null,
            end_milepost: clipMeta.mileposts?.endMp ?? null,
            interval_ft: intervalFeet,
            created_at: new Date().toISOString()
        }
    };

    return {
        ok: true,
        centerline: centerlineFeature,
        stationPoints,
        summary: {
            beginStation: formatStation(beginSta),
            endStation: formatStation(endSta),
            beginStationFeet: beginSta,
            endStationFeet: endSta,
            pointCount: stationPoints.length,
            lineLengthFeet: workingLen,
            intervalFeet
        },
        warnings: clipMeta.warnings || []
    };
}

/**
 * @param {object} options
 * @deprecated retained for optional analysis export
 */
export function generateStationSegments(options = {}) {
    const output = generateProjectStationingOutput(options);
    if (!output.ok) return output;

    const { workingLine, beginSta, breaks } = resolveWorkingLineAndStations(
        options.centerline,
        options.beginStationFeet,
        options.endStationFeet,
        options.intervalFeet ?? DEFAULT_INTERVAL_FT
    );

    const segments = [];
    for (let i = 0; i < breaks.length - 1; i++) {
        const staStart = breaks[i];
        const staEnd = breaks[i + 1];
        const distStart = staStart - beginSta;
        const distEnd = staEnd - beginSta;
        const slice = lineSliceAlong(workingLine, distStart, distEnd, 'feet');
        const stationStartLabel = formatStation(staStart);
        segments.push({
            type: 'Feature',
            geometry: slice.geometry,
            properties: {
                name: stationStartLabel,
                station_start: stationStartLabel,
                station_end: formatStation(staEnd),
                station_start_ft: staStart,
                station_end_ft: staEnd,
                segment_length_ft: Math.round(lineLengthFeet(slice) * 100) / 100,
                segment_index: i
            }
        });
    }

    return { ...output, segments, summary: { ...output.summary, segmentCount: segments.length } };
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} line
 * @param {number} distanceFeet
 * @param {number} [sampleFeet]
 * @returns {number}
 */
export function getLocalTangentBearing(line, distanceFeet, sampleFeet = DEFAULT_STATIONING_GRAPHICS.tangentSampleFt) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const total = lineLengthFeet(line);
    const d = Math.max(0, Math.min(Number(distanceFeet) || 0, total));
    const sample = Math.max(1, Number(sampleFeet) || 10);
    const back = Math.max(0, d - sample);
    const fwd = Math.min(total, d + sample);
    const p0 = turf.along(line, back, { units: 'feet' });
    const p1 = turf.along(line, fwd, { units: 'feet' });
    if (back === fwd) {
        return turf.bearing(p0, turf.along(line, Math.min(total, d + sample), { units: 'feet' }));
    }
    return turf.bearing(p0, p1);
}

/**
 * @param {import('geojson').Feature<import('geojson').Point>} stationPoint
 * @param {number} tangentBearing
 * @param {number} offsetFt
 * @param {'left'|'right'} [side]
 */
export function buildStationLabelPoint(stationPoint, tangentBearing, offsetFt, side = 'right') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const offset = Math.max(0, Number(offsetFt) || 0);
    const bearing = side === 'left' ? tangentBearing - 90 : tangentBearing + 90;
    return turf.destination(stationPoint, offset, bearing, { units: 'feet' });
}

/**
 * Bearing for vertically stacked labels aligned with route tangent.
 * @param {number} tangentBearing
 * @param {'left'|'right'} [side]
 * @returns {number}
 */
export function resolveLabelBearing(tangentBearing, side = 'right') {
    const bearing = Number(tangentBearing) || 0;
    return side === 'left' ? (bearing + 180) % 360 : bearing;
}

/**
 * Build a label point anchored to the tick end on the label side, with optional extra offset.
 * @param {import('geojson').Feature} tickFeature
 * @param {number} tangentBearing
 * @param {number} labelOffsetFt
 * @param {'left'|'right'} [side]
 */
export function buildStationLabelFromTick(tickFeature, tangentBearing, labelOffsetFt, side = 'right') {
    const normalizedSide = normalizeOffsetSide(side);
    const coords = tickFeature?.geometry?.coordinates;
    if (!coords || coords.length < 2) {
        throw new Error('Tick feature is required for label placement.');
    }
    const tickEndpoint = normalizedSide === 'left' ? coords[0] : coords[1];
    const anchor = turf.point(tickEndpoint);
    const offset = Math.max(0, Number(labelOffsetFt) || 0);
    if (offset < 0.001) return anchor;
    return buildStationLabelPoint(anchor, tangentBearing, offset, normalizedSide);
}

/**
 * @param {number} stationFeet
 * @param {number} beginSta
 * @param {number} majorIntervalFt
 */
export function isMajorStation(stationFeet, beginSta, majorIntervalFt = DEFAULT_STATIONING_GRAPHICS.majorIntervalFt) {
    const interval = Number(majorIntervalFt);
    if (!Number.isFinite(interval) || interval <= 0) return false;
    const offset = Number(stationFeet) - Number(beginSta);
    if (offset < -0.001) return false;
    const mod = offset % interval;
    return mod < 0.01 || Math.abs(mod - interval) < 0.01;
}

/**
 * @param {import('geojson').Feature<import('geojson').Point>} stationPoint
 * @param {number} tangentBearing
 * @param {number} tickLengthFt
 * @param {object} [properties]
 */
/**
 * @param {string} [side]
 * @returns {'left'|'right'}
 */
export function normalizeOffsetSide(side) {
    return String(side || 'right').toLowerCase() === 'left' ? 'left' : 'right';
}

/**
 * Parallel-offset a centerline feature perpendicular to its direction.
 * @param {import('geojson').Feature} line
 * @param {number} offsetFt
 * @param {'left'|'right'} [side]
 */
export function offsetCenterlineFeature(line, offsetFt, side = 'right') {
    if (!line?.geometry) {
        return { feature: line, warning: '' };
    }
    const offset = Math.max(0, Number(offsetFt) || 0);
    if (offset < 0.001) {
        return { feature: line, warning: '' };
    }
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const normalizedSide = normalizeOffsetSide(side);
    const miles = offset / FEET_PER_MILE;
    const signedMiles = normalizedSide === 'right' ? miles : -miles;

    try {
        const offsetLine = turf.lineOffset(line, signedMiles, { units: 'miles' });
        return {
            feature: {
                ...line,
                geometry: offsetLine.geometry,
                properties: { ...line.properties }
            },
            warning: ''
        };
    } catch (err) {
        return {
            feature: line,
            warning: err?.message || 'Centerline offset failed.'
        };
    }
}

/**
 * Offset point features perpendicular to a centerline for shared label placement.
 * @param {import('geojson').Feature[]} features
 * @param {import('geojson').Feature} centerline
 * @param {object} [options]
 */
export function offsetPointLabelsAlongCenterline(features, centerline, options = {}) {
    if (!centerline?.geometry || !features?.length) return features || [];

    const offsetFt = Math.max(0, Number(options.offsetFt) || 0);
    if (offsetFt < 0.001) return features;

    const side = normalizeOffsetSide(options.side);
    const tangentSampleFt = Number(options.tangentSampleFt) || DEFAULT_STATIONING_GRAPHICS.tangentSampleFt;

    return features.map((feature) => {
        if (!feature?.geometry) return feature;
        try {
            const snapped = nearestPointOnLineAny(feature, centerline, 'feet');
            const distAlong = Number(snapped.properties?.location ?? snapped.properties?.loc ?? 0);
            const tangent = getLocalTangentBearing(centerline, distAlong, tangentSampleFt);
            const labelPt = buildStationLabelPoint(snapped, tangent, offsetFt, side);
            return {
                ...feature,
                geometry: labelPt.geometry,
                properties: {
                    ...feature.properties,
                    label_side: side,
                    label_offset_ft: offsetFt
                }
            };
        } catch (_) {
            return feature;
        }
    });
}

/**
 * Snap mileposts to a project centerline using distance along a reference centerline.
 * @param {import('geojson').Feature[]} features
 * @param {import('geojson').Feature} referenceCenterline
 * @param {import('geojson').Feature} projectCenterline
 */
export function snapMilepostsAlongCenterline(features, referenceCenterline, projectCenterline) {
    if (!projectCenterline?.geometry) return features || [];
    return (features || []).map((feature) => {
        if (!feature?.geometry) return feature;
        try {
            const refLine = referenceCenterline?.geometry ? referenceCenterline : projectCenterline;
            const onRef = nearestPointOnLineAny(feature, refLine, 'feet');
            const distAlong = Number(onRef.properties?.location ?? 0);
            const onProject = turf.along(projectCenterline, distAlong, { units: 'feet' });
            return {
                ...feature,
                geometry: onProject.geometry,
                properties: {
                    ...feature.properties,
                    snapped_to_centerline: true,
                    distance_along_ft: Math.round(distAlong * 100) / 100
                }
            };
        } catch (_) {
            return feature;
        }
    });
}

export function buildMilepostLabelFeatures(milepostPoints, centerline, options = {}) {
    if (!centerline?.geometry || !milepostPoints?.length) return [];

    const offsetFt = Math.max(0, Number(options.offsetFt ?? options.labelOffsetFt) || 0);
    if (offsetFt < 0.001) return [];

    return offsetPointLabelsAlongCenterline(milepostPoints, centerline, {
        offsetFt,
        side: options.side ?? options.labelSide,
        tangentSampleFt: options.tangentSampleFt
    });
}

export function buildStationTick(stationPoint, tangentBearing, tickLengthFt, properties = {}) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const half = Math.max(0.1, Number(tickLengthFt) || 30) / 2;
    const left = turf.destination(stationPoint, half, tangentBearing - 90, { units: 'feet' });
    const right = turf.destination(stationPoint, half, tangentBearing + 90, { units: 'feet' });
    return {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: [left.geometry.coordinates, right.geometry.coordinates]
        },
        properties: { ...properties }
    };
}

/**
 * Civil-style stationing graphics: centerline + perpendicular ticks + offset labels.
 * @param {object} options
 */
export function generateStationingGraphics(options = {}) {
    const output = generateProjectStationingOutput(options);
    if (!output.ok) return output;

    const graphics = { ...DEFAULT_STATIONING_GRAPHICS, ...(options.graphics || {}) };
    const routeMeta = options.routeMeta || {};
    const clipMeta = options.clipMeta || {};
    const intervalFeet = options.intervalFeet ?? DEFAULT_INTERVAL_FT;
    const labelInterval = graphics.labelIntervalFt ?? intervalFeet;

    const resolved = resolveWorkingLineAndStations(
        options.centerline,
        options.beginStationFeet,
        options.endStationFeet,
        intervalFeet
    );
    if (!resolved.ok) return resolved;

    const { workingLine, beginSta, endSta, breaks, workingLen } = resolved;
    const stationTicks = [];
    const stationLabels = [];
    const beginEndMarkers = [];
    const now = new Date().toISOString();

    for (let i = 0; i < breaks.length; i++) {
        const sta = breaks[i];
        const distAlong = sta - beginSta;
        const stationLabel = formatStation(sta);
        const stationPoint = turf.along(workingLine, distAlong, { units: 'feet' });
        const tangent = getLocalTangentBearing(workingLine, distAlong, graphics.tangentSampleFt);
        const isMajor = isMajorStation(sta, beginSta, graphics.majorIntervalFt);
        const tickLen = isMajor ? graphics.majorTickLengthFt : graphics.tickLengthFt;
        const isBegin = i === 0;
        const isEnd = i === breaks.length - 1;

        const tickFeature = buildStationTick(stationPoint, tangent, tickLen, {
            name: stationLabel,
            station_label: stationLabel,
            station_feet: sta,
            distance_from_start_ft: Math.round(distAlong * 100) / 100,
            tick_length_ft: tickLen,
            tick_type: isMajor ? 'major' : 'standard',
            is_major_station: isMajor,
            route_id: routeMeta.routeId || '',
            route_alias: routeMeta.routeAlias || '',
            clip_method: clipMeta.clipMethod || CLIP_METHODS.FULL_ROUTE,
            station_index: i
        });
        stationTicks.push(tickFeature);

        // Offset label point from the tick end on the label side
        const offsetMod = distAlong % labelInterval;
        const labelAtInterval = isBegin || isEnd || offsetMod < 0.01 || Math.abs(offsetMod - labelInterval) < 0.01;
        if (labelAtInterval) {
            const labelPt = buildStationLabelFromTick(
                tickFeature,
                tangent,
                graphics.labelOffsetFt,
                graphics.labelSide
            );
            stationLabels.push({
                type: 'Feature',
                geometry: labelPt.geometry,
                properties: {
                    name: stationLabel,
                    station_label: stationLabel,
                    station_feet: sta,
                    distance_from_start_ft: Math.round(distAlong * 100) / 100,
                    label_side: graphics.labelSide,
                    is_major_station: isMajor,
                    route_id: routeMeta.routeId || '',
                    route_alias: routeMeta.routeAlias || '',
                    clip_method: clipMeta.clipMethod || CLIP_METHODS.FULL_ROUTE,
                    station_index: i
                }
            });
        }

        if (graphics.includeBeginEndMarkers && (isBegin || isEnd)) {
            const labelPt = buildStationLabelPoint(
                stationPoint,
                tangent,
                graphics.labelOffsetFt * 1.15,
                graphics.labelSide
            );
            beginEndMarkers.push({
                type: 'Feature',
                geometry: labelPt.geometry,
                properties: {
                    name: isBegin ? `Begin ${stationLabel}` : `End ${stationLabel}`,
                    station_label: stationLabel,
                    station_feet: sta,
                    marker_type: isBegin ? 'begin' : 'end',
                    distance_from_start_ft: Math.round(distAlong * 100) / 100,
                    route_id: routeMeta.routeId || '',
                    route_alias: routeMeta.routeAlias || ''
                }
            });
        }
    }

    const centerline = {
        ...output.centerline,
        properties: {
            ...output.centerline.properties,
            name: routeMeta.routeAlias || 'Project Centerline',
            route_name: routeMeta.routeAlias || '',
            total_length_ft: Math.round(workingLen * 100) / 100,
            begin_station: formatStation(beginSta),
            end_station: formatStation(endSta),
            station_interval_ft: intervalFeet,
            label_interval_ft: labelInterval,
            centerline_offset_ft: Math.max(0, Number(graphics.centerlineOffsetFt) || 0),
            centerline_offset_side: normalizeOffsetSide(graphics.centerlineOffsetSide),
            label_offset_ft: Math.max(0, Number(graphics.labelOffsetFt) || 0),
            label_side: normalizeOffsetSide(graphics.labelSide),
            created_by_widget: 'project-stationing',
            created_at: now
        }
    };

    return {
        ok: true,
        centerline,
        stationTicks,
        stationLabels,
        beginEndMarkers,
        summary: {
            beginStation: formatStation(beginSta),
            endStation: formatStation(endSta),
            beginStationFeet: beginSta,
            endStationFeet: endSta,
            tickCount: stationTicks.length,
            labelCount: stationLabels.length,
            markerCount: beginEndMarkers.length,
            segmentCount: stationTicks.length,
            lineLengthFeet: workingLen,
            intervalFeet
        },
        warnings: output.warnings || []
    };
}

/**
 * @param {object} input
 */
export function computeProjectStationing(input = {}) {
    const {
        centerline,
        beginStation,
        endStation,
        intervalFt = DEFAULT_INTERVAL_FT,
        startOffsetFt = 0,
        endOffsetFt = 0,
        centerlineOffsetFt = 0,
        centerlineOffsetSide = 'right',
        graphics = {},
        routeMeta = {},
        clipMeta = {}
    } = input;

    if (!centerline?.geometry) {
        return { ok: false, errors: ['Centerline is required.'] };
    }

    const stationResult = validateStation(beginStation);
    if (!stationResult.valid) {
        return { ok: false, errors: [stationResult.error || 'Invalid begin station.'] };
    }

    let parsedEndStation = null;
    if (endStation != null && String(endStation).trim() !== '') {
        parsedEndStation = parseStation(endStation);
        if (parsedEndStation == null) {
            return { ok: false, errors: ['Invalid end station.'] };
        }
    }

    const fullLen = lineLengthFeet(centerline);
    const trimValidation = validateTrimOffsets(startOffsetFt, endOffsetFt, fullLen, intervalFt);
    if (!trimValidation.valid) {
        return { ok: false, errors: [trimValidation.error || 'Invalid trim offsets.'] };
    }

    const trimmed = trimCenterlineByOffsets(centerline, startOffsetFt, endOffsetFt);
    if (!trimmed) {
        return { ok: false, errors: ['Trim offsets produce an empty centerline.'] };
    }

    const mergedGraphics = {
        ...DEFAULT_STATIONING_GRAPHICS,
        ...graphics,
        centerlineOffsetFt: Math.max(0, Number(centerlineOffsetFt ?? graphics.centerlineOffsetFt) || 0),
        centerlineOffsetSide: normalizeOffsetSide(centerlineOffsetSide || graphics.centerlineOffsetSide)
    };

    const warnings = [];
    let workingCenterline = trimmed;
    if (mergedGraphics.centerlineOffsetFt > 0) {
        const offsetResult = offsetCenterlineFeature(
            trimmed,
            mergedGraphics.centerlineOffsetFt,
            mergedGraphics.centerlineOffsetSide
        );
        workingCenterline = offsetResult.feature;
        if (offsetResult.warning) warnings.push(offsetResult.warning);
    }

    const result = generateStationingGraphics({
        centerline: workingCenterline,
        beginStationFeet: stationResult.value,
        endStationFeet: parsedEndStation,
        intervalFeet: intervalFt,
        routeMeta,
        clipMeta,
        graphics: mergedGraphics
    });

    if (!result.ok) return result;

    result.baseCenterline = trimmed;
    if (warnings.length) {
        result.warnings = [...(result.warnings || []), ...warnings];
    }

    return result;
}

/**
 * @param {string} routeAlias
 * @param {string|number} beginStation
 * @param {string|number} endStation
 * @param {number} intervalFt
 * @param {string} [suffix]
 */
export function buildOutputLayerName(routeAlias, beginStation, endStation, intervalFt = DEFAULT_INTERVAL_FT, suffix = '') {
    const alias = routeAlias || 'Route';
    const beginLabel = typeof beginStation === 'number' ? formatStation(beginStation) : beginStation;
    const endLabel = typeof endStation === 'number' ? formatStation(endStation) : endStation;
    const base = `${alias} Sta ${beginLabel} to ${endLabel} (${intervalFt}ft)`;
    return suffix ? `${base} ${suffix}` : base;
}
