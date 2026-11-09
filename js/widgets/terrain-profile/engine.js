/**
 * Terrain profile and line-of-sight math.
 * Elevation values come from an injected sampler. This module never reads the map.
 * The sight beam is a straight absolute-elevation line. Curvature raises terrain
 * in the clearance test and does not bend the beam.
 */

export const DEFAULT_SAMPLE_SPACING_M = 30;
export const MIN_SAMPLE_SPACING_M = 1;
export const MAX_PROFILE_SAMPLES = 2000;

/** Mean earth radius used for distance and curvature. */
export const EARTH_RADIUS_M = 6_371_000;

/** Standard atmospheric refraction coefficient. */
export const REFRACTION_K = 0.13;

/** Terrain must exceed the sight line by this much to count as a block. */
const LOS_CLEARANCE_M = 0.001;

const TIMEOUT_MESSAGE = 'sampleElevations timed out waiting for the map window';
const CLOSED_MESSAGE = 'sampleElevations failed: the map window is closed';

function toRadians(deg) {
    return (deg * Math.PI) / 180;
}

/**
 * @param {number} lng1
 * @param {number} lat1
 * @param {number} lng2
 * @param {number} lat2
 * @returns {number} meters
 */
export function haversineMeters(lng1, lat1, lng2, lat2) {
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const lat1Rad = toRadians(lat1);
    const lat2Rad = toRadians(lat2);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    return EARTH_RADIUS_M * c;
}

/**
 * Earth bulge between two endpoints, including standard refraction.
 * Height in meters added to terrain before it is compared with a straight sight line.
 * Zero at either endpoint. Zero when curvature is off.
 * @param {number} distanceFromObserverM
 * @param {number} distanceFromTargetM
 * @returns {number}
 */
export function earthBulgeMeters(distanceFromObserverM, distanceFromTargetM) {
    const d1 = distanceFromObserverM;
    const d2 = distanceFromTargetM;
    if (!Number.isFinite(d1) || !Number.isFinite(d2) || d1 <= 0 || d2 <= 0) return 0;
    return (d1 * d2 * (1 - REFRACTION_K)) / (2 * EARTH_RADIUS_M);
}

function finiteOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function assertSpacing(spacingM) {
    const spacing = Number(spacingM);
    if (!Number.isFinite(spacing) || spacing < MIN_SAMPLE_SPACING_M) {
        throw new Error(`Sample spacing must be at least ${MIN_SAMPLE_SPACING_M} m.`);
    }
    return spacing;
}

function readPosition(coord, index) {
    if (!Array.isArray(coord) || coord.length < 2) {
        throw new Error(`Point ${index} must be [lng, lat].`);
    }
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        throw new Error(`Point ${index} must have finite lng and lat.`);
    }
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        throw new Error(`Point ${index} is outside longitude/latitude range.`);
    }
    return [lng, lat];
}

function assertHeight(value, label) {
    const height = Number(value);
    if (!Number.isFinite(height) || height < 0) {
        throw new Error(`${label} height must be zero or greater.`);
    }
    return height;
}

/**
 * Insert points so each step is at most `spacingM`, keeping every original vertex.
 * @param {Array<[number, number]>} coordinates
 * @param {number} [spacingM]
 * @returns {{ lng: number, lat: number, distanceM: number }[]}
 */
export function densifyCoordinates(coordinates, spacingM = DEFAULT_SAMPLE_SPACING_M) {
    if (!Array.isArray(coordinates)) {
        throw new Error('A line needs at least two points.');
    }
    const spacing = assertSpacing(spacingM);
    const positions = coordinates.map((coord, index) => readPosition(coord, index));
    if (positions.length < 2) {
        throw new Error('A line needs at least two points.');
    }

    /** @type {{ lng1: number, lat1: number, lng2: number, lat2: number, segLen: number, steps: number, startM: number }[]} */
    const segments = [];
    let count = 1;
    let startM = 0;
    for (let i = 1; i < positions.length; i += 1) {
        const [lng1, lat1] = positions[i - 1];
        const [lng2, lat2] = positions[i];
        const segLen = haversineMeters(lng1, lat1, lng2, lat2);
        if (segLen === 0) continue;
        const steps = Math.ceil(segLen / spacing);
        count += steps;
        if (count > MAX_PROFILE_SAMPLES) {
            throw new Error(
                `This line needs more than ${MAX_PROFILE_SAMPLES} samples. Increase the sample spacing.`
            );
        }
        segments.push({ lng1, lat1, lng2, lat2, segLen, steps, startM });
        startM += segLen;
    }
    if (!segments.length) {
        throw new Error('Line has no length.');
    }

    const first = segments[0];
    /** @type {{ lng: number, lat: number, distanceM: number }[]} */
    const out = [{ lng: first.lng1, lat: first.lat1, distanceM: 0 }];
    for (const seg of segments) {
        for (let s = 1; s <= seg.steps; s += 1) {
            const t = s / seg.steps;
            const lng = s === seg.steps ? seg.lng2 : seg.lng1 + (seg.lng2 - seg.lng1) * t;
            const lat = s === seg.steps ? seg.lat2 : seg.lat1 + (seg.lat2 - seg.lat1) * t;
            out.push({
                lng,
                lat,
                distanceM: seg.startM + seg.segLen * t
            });
        }
    }
    return out;
}

/**
 * Min, max, gain, and loss. Null elevations are gaps: gain and loss do not cross them.
 * @param {{ elevationM: number | null }[]} samples
 */
export function summarizeElevations(samples) {
    let min = null;
    let max = null;
    let gain = 0;
    let loss = 0;
    let gapCount = 0;
    let validCount = 0;
    let prev = null;
    for (const sample of samples || []) {
        const elevation = finiteOrNull(sample?.elevationM);
        if (elevation == null) {
            gapCount += 1;
            prev = null;
            continue;
        }
        validCount += 1;
        if (min == null || elevation < min) min = elevation;
        if (max == null || elevation > max) max = elevation;
        if (prev != null) {
            const delta = elevation - prev;
            if (delta > 0) gain += delta;
            else if (delta < 0) loss -= delta;
        }
        prev = elevation;
    }
    const last = samples?.length ? samples[samples.length - 1] : null;
    return {
        min,
        max,
        gain,
        loss,
        gapCount,
        validCount,
        totalDistanceM: Number.isFinite(last?.distanceM) ? last.distanceM : 0
    };
}

/**
 * Contiguous runs of finite elevations. A null sample ends the current run.
 * @param {object[]} samples
 * @param {string} [valueKey]
 * @returns {{ distanceM: number, elevationM: number }[][]}
 */
export function profileChartSegments(samples, valueKey = 'elevationM') {
    /** @type {{ distanceM: number, elevationM: number }[][]} */
    const segments = [];
    /** @type {{ distanceM: number, elevationM: number }[]} */
    let current = [];
    for (const sample of samples || []) {
        const elevation = finiteOrNull(sample?.[valueKey]);
        if (elevation == null) {
            if (current.length) segments.push(current);
            current = [];
            continue;
        }
        current.push({ distanceM: sample.distanceM, elevationM: elevation });
    }
    if (current.length) segments.push(current);
    return segments;
}

/**
 * Keep documented closed-map and timeout messages. Wrap anything else that is not an Error.
 * @param {unknown} err
 * @returns {Error}
 */
export function elevationSampleError(err) {
    if (err instanceof Error && err.message) {
        if (err.message === TIMEOUT_MESSAGE || err.message === CLOSED_MESSAGE) return err;
        if (/sampleElevations/i.test(err.message)) return err;
        return err;
    }
    return new Error('Elevation sampling failed.');
}

/**
 * @param {{ lng: number, lat: number }[]} samples
 * @param {(points: Array<[number, number]>) => Promise<Array<number | null>>} sampleElevations
 */
export async function sampleProfileElevations(samples, sampleElevations) {
    if (typeof sampleElevations !== 'function') {
        throw new Error('Elevation sampling is not available on this map.');
    }
    const points = samples.map((sample) => [sample.lng, sample.lat]);
    let values;
    try {
        values = await sampleElevations(points);
    } catch (err) {
        throw elevationSampleError(err);
    }
    if (!Array.isArray(values) || values.length !== samples.length) {
        throw new Error('sampleElevations returned an unexpected result');
    }
    return samples.map((sample, index) => ({
        ...sample,
        elevationM: finiteOrNull(values[index])
    }));
}

/**
 * @param {{ coordinates: Array<[number, number]>, spacingM?: number, sampleElevations: Function }} input
 */
export async function buildElevationProfile(input) {
    const samples = densifyCoordinates(input?.coordinates, input?.spacingM);
    const withElevation = await sampleProfileElevations(samples, input?.sampleElevations);
    const stats = summarizeElevations(withElevation);
    return {
        mode: 'profile',
        samples: withElevation,
        stats,
        segments: profileChartSegments(withElevation)
    };
}

/**
 * Curvature and standard refraction are on unless `curvature` is explicitly false.
 * @param {{ samples: object[], observerHeightM: number, targetHeightM: number, curvature?: boolean }} input
 */
export function evaluateLineOfSight(input) {
    const samples = input?.samples;
    if (!Array.isArray(samples) || samples.length < 2) {
        throw new Error('Line of sight needs an observer and a target.');
    }
    const observerHeightM = assertHeight(input.observerHeightM, 'Observer');
    const targetHeightM = assertHeight(input.targetHeightM, 'Target');
    const curvature = input.curvature !== false;
    const total = samples[samples.length - 1].distanceM;
    if (!Number.isFinite(total) || total <= 0) {
        throw new Error('Line has no length.');
    }
    const observerGround = finiteOrNull(samples[0].elevationM);
    const targetGround = finiteOrNull(samples[samples.length - 1].elevationM);
    if (observerGround == null || targetGround == null) {
        throw new Error('No terrain elevation at the observer or target.');
    }

    const observerAbsoluteM = observerGround + observerHeightM;
    const targetAbsoluteM = targetGround + targetHeightM;
    const annotated = samples.map((sample) => {
        const bulgeM = curvature
            ? earthBulgeMeters(sample.distanceM, total - sample.distanceM)
            : 0;
        const ground = finiteOrNull(sample.elevationM);
        return {
            ...sample,
            bulgeM,
            effectiveM: ground == null ? null : ground + bulgeM
        };
    });

    let obstruction = null;
    for (let index = 1; index < annotated.length - 1; index += 1) {
        const sample = annotated[index];
        if (sample.effectiveM == null) continue;
        const losM = observerAbsoluteM + (sample.distanceM / total) * (targetAbsoluteM - observerAbsoluteM);
        if (sample.effectiveM > losM + LOS_CLEARANCE_M) {
            obstruction = {
                index,
                lng: sample.lng,
                lat: sample.lat,
                distanceM: sample.distanceM,
                elevationM: sample.elevationM,
                effectiveM: sample.effectiveM,
                losM,
                bulgeM: sample.bulgeM
            };
            break;
        }
    }

    return {
        visible: !obstruction,
        curvature,
        observerAbsoluteM,
        targetAbsoluteM,
        observerHeightM,
        targetHeightM,
        samples: annotated,
        obstruction,
        stats: summarizeElevations(annotated),
        segments: profileChartSegments(annotated, 'effectiveM')
    };
}

/**
 * @param {object | null | undefined} state
 * @returns {{ is3d: boolean, terrain: boolean, pitch: number, bearing: number }}
 */
export function normalizeTerrainView(state) {
    const pitch = Number(state?.pitch);
    const bearing = Number(state?.bearing);
    return {
        is3d: !!state?.is3d,
        terrain: !!state?.terrain,
        pitch: Number.isFinite(pitch) ? pitch : 0,
        bearing: Number.isFinite(bearing) ? bearing : 0
    };
}

/**
 * Pitch and bearing match within `epsilon` degrees, and the 3D/terrain flags match.
 * @param {object | null | undefined} a
 * @param {object | null | undefined} b
 * @param {number} [epsilon]
 */
export function terrainViewsMatch(a, b, epsilon = 0.75) {
    const left = normalizeTerrainView(a);
    const right = normalizeTerrainView(b);
    return left.is3d === right.is3d
        && left.terrain === right.terrain
        && Math.abs(left.pitch - right.pitch) <= epsilon
        && Math.abs(left.bearing - right.bearing) <= epsilon;
}

/**
 * Endpoint grounds and heights for the straight AMSL line.
 * Ground stays un-exaggerated meters. The map layer exaggerates ground once.
 * @param {object} sight
 * @param {number} total
 * @returns {object | null}
 */
function sightAltitudeFrame(sight, total) {
    const samples = sight?.samples;
    const observerGroundM = finiteOrNull(samples?.[0]?.elevationM);
    const targetGroundM = finiteOrNull(samples?.[samples.length - 1]?.elevationM);
    if (observerGroundM == null || targetGroundM == null) return null;
    let observerHeightM = Number(sight.observerHeightM);
    let targetHeightM = Number(sight.targetHeightM);
    if (!Number.isFinite(observerHeightM) && Number.isFinite(Number(sight.observerAbsoluteM))) {
        observerHeightM = Number(sight.observerAbsoluteM) - observerGroundM;
    }
    if (!Number.isFinite(targetHeightM) && Number.isFinite(Number(sight.targetAbsoluteM))) {
        targetHeightM = Number(sight.targetAbsoluteM) - targetGroundM;
    }
    if (!Number.isFinite(observerHeightM) || !Number.isFinite(targetHeightM)) return null;
    return {
        observerGroundM,
        targetGroundM,
        observerHeightM,
        targetHeightM,
        totalDistanceM: total
    };
}

/**
 * Straight beam from observer height above ground to target height above ground.
 * The obstruction sample is the last visible point and the first blocked point.
 * `altitudeM` is absolute elevation (ground + height). `altitudeFrame` splits
 * that line so the map can exaggerate ground without exaggerating the height.
 * @param {object | null | undefined} sight
 * @returns {{ visible: object[], blocked: object[], altitudeFrame?: object }}
 */
export function buildSightBeam(sight) {
    const samples = sight?.samples;
    if (!Array.isArray(samples) || samples.length < 2) return { visible: [], blocked: [] };
    const total = Number(samples[samples.length - 1].distanceM);
    const start = Number(sight.observerAbsoluteM);
    const end = Number(sight.targetAbsoluteM);
    if (!Number.isFinite(total) || total < 0 || !Number.isFinite(start) || !Number.isFinite(end)) {
        return { visible: [], blocked: [] };
    }
    const points = samples.map((sample) => {
        const distanceM = Number(sample.distanceM) || 0;
        const t = total > 0 ? distanceM / total : 0;
        return {
            lng: sample.lng,
            lat: sample.lat,
            distanceM,
            altitudeM: start + (t * (end - start))
        };
    });
    const altitudeFrame = sightAltitudeFrame(sight, total);
    const cut = sight.obstruction?.index;
    if (!Number.isInteger(cut) || cut <= 0 || cut >= points.length - 1) {
        return altitudeFrame
            ? { visible: points, blocked: [], altitudeFrame }
            : { visible: points, blocked: [] };
    }
    return {
        visible: points.slice(0, cut + 1),
        blocked: points.slice(cut),
        ...(altitudeFrame ? { altitudeFrame } : {})
    };
}

/**
 * Curvature defaults on. Pass `curvature: false` to skip earth bulge and refraction.
 * @param {{ observer: [number, number], target: [number, number], observerHeightM: number, targetHeightM: number, spacingM?: number, curvature?: boolean, sampleElevations: Function }} input
 */
export async function buildLineOfSight(input) {
    if (!Array.isArray(input?.observer) || !Array.isArray(input?.target)) {
        throw new Error('Pick an observer point and a target point.');
    }
    const path = densifyCoordinates([input.observer, input.target], input.spacingM);
    const withElevation = await sampleProfileElevations(path, input.sampleElevations);
    const sight = evaluateLineOfSight({
        samples: withElevation,
        observerHeightM: input.observerHeightM,
        targetHeightM: input.targetHeightM,
        curvature: input.curvature
    });
    return {
        mode: 'los',
        ...sight,
        beam: buildSightBeam(sight)
    };
}

/**
 * @param {object} result
 * @returns {{ type: 'FeatureCollection', features: object[] }}
 */
export function buildTerrainFeatureCollection(result) {
    const lineCoords = (result?.samples || [])
        .filter((sample) => Number.isFinite(sample?.lng) && Number.isFinite(sample?.lat))
        .map((sample) => [sample.lng, sample.lat]);
    /** @type {object[]} */
    const features = [];
    if (lineCoords.length >= 2) {
        features.push({
            type: 'Feature',
            properties: {
                kind: result.mode === 'los' ? 'line-of-sight' : 'profile',
                visible: result.mode === 'los' ? !!result.visible : null,
                minM: result.stats?.min ?? null,
                maxM: result.stats?.max ?? null,
                gainM: result.stats?.gain ?? null,
                lossM: result.stats?.loss ?? null,
                distanceM: result.stats?.totalDistanceM ?? null,
                curvature: result.mode === 'los' ? !!result.curvature : false
            },
            geometry: { type: 'LineString', coordinates: lineCoords }
        });
    }
    if (result?.obstruction && Number.isFinite(result.obstruction.lng) && Number.isFinite(result.obstruction.lat)) {
        features.push({
            type: 'Feature',
            properties: {
                kind: 'obstruction',
                distanceM: result.obstruction.distanceM,
                elevationM: result.obstruction.elevationM
            },
            geometry: {
                type: 'Point',
                coordinates: [result.obstruction.lng, result.obstruction.lat]
            }
        });
    }
    return { type: 'FeatureCollection', features };
}

/**
 * Session graphics: observer and target dots, plus the profile line when a result exists.
 * @param {number[] | null | undefined} observer
 * @param {number[] | null | undefined} target
 * @param {object | null | undefined} result
 * @returns {{ type: 'FeatureCollection', features: object[] }}
 */
export function buildLineOfSiteOverlayFeatures(observer, target, result) {
    /** @type {object[]} */
    const features = [];
    const pushPoint = (coord, kind, label) => {
        if (!Array.isArray(coord) || coord.length < 2) return;
        const lng = Number(coord[0]);
        const lat = Number(coord[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
        features.push({
            type: 'Feature',
            properties: { kind, label },
            geometry: { type: 'Point', coordinates: [lng, lat] }
        });
    };
    pushPoint(observer, 'observer', 'Observer');
    pushPoint(target, 'target', 'Target');
    if (result) features.push(...buildTerrainFeatureCollection(result).features);
    return { type: 'FeatureCollection', features };
}

/** Names of the project layers created by Add to map. */
export const LOS_ADDED_LAYER_NAMES = {
    visible: 'Line of Site visible',
    blocked: 'Line of Site blocked',
    endpoints: 'Line of Site observer and target',
    obstruction: 'Line of Site obstruction',
    profile: 'Line of Site terrain profile'
};

function lineStringFromPoints(points, altitudeKey) {
    const coordinates = [];
    for (const point of points || []) {
        const lng = Number(point?.lng);
        const lat = Number(point?.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        const z = finiteOrNull(point?.[altitudeKey]);
        coordinates.push(z == null ? [lng, lat] : [lng, lat, z]);
    }
    return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null;
}

/**
 * Clearance is sight-line altitude minus effective terrain (ground plus bulge).
 * Positive clears. Negative is how far the terrain blocks the sight line.
 * @param {object | null | undefined} result
 * @returns {Array<number | null>}
 */
function clearanceSeries(result) {
    const samples = result?.samples || [];
    if (samples.length < 2) return [];
    const total = Number(samples[samples.length - 1].distanceM);
    const start = Number(result?.observerAbsoluteM);
    const end = Number(result?.targetAbsoluteM);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(start) || !Number.isFinite(end)) {
        return samples.map(() => null);
    }
    return samples.map((sample) => {
        const effective = finiteOrNull(sample?.effectiveM);
        if (effective == null) return null;
        const distance = Number(sample.distanceM) || 0;
        return start + ((distance / total) * (end - start)) - effective;
    });
}

function minFinite(values) {
    let min = null;
    for (const value of values || []) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        if (min == null || value < min) min = value;
    }
    return min;
}

function resultAttributes(result, overrides = {}) {
    const stats = result?.stats || {};
    const distance = Number.isFinite(stats.totalDistanceM) ? stats.totalDistanceM : null;
    return {
        distanceM: distance,
        totalDistanceM: distance,
        observerHeightM: finiteOrNull(result?.observerHeightM),
        targetHeightM: finiteOrNull(result?.targetHeightM),
        observerAbsoluteM: finiteOrNull(result?.observerAbsoluteM),
        targetAbsoluteM: finiteOrNull(result?.targetAbsoluteM),
        visible: result?.visible ? 'yes' : 'no',
        clearanceM: null,
        curvature: !!result?.curvature,
        minM: stats.min ?? null,
        maxM: stats.max ?? null,
        gainM: stats.gain ?? null,
        lossM: stats.loss ?? null,
        gapCount: stats.gapCount ?? null,
        validCount: stats.validCount ?? null,
        ...overrides
    };
}

function featureCollection(features) {
    return { type: 'FeatureCollection', features };
}

/**
 * Project layers for every map graphic the widget draws.
 * The dialog chart uses the same beam, terrain profile, and obstruction.
 * @param {object | null | undefined} result
 * @returns {{ role: string, name: string, geojson: { type: 'FeatureCollection', features: object[] } }[]}
 */
export function buildLineOfSiteMapLayers(result) {
    if (!result || result.mode !== 'los') return [];
    const samples = Array.isArray(result.samples) ? result.samples : [];
    if (samples.length < 2) return [];
    const beam = (result.beam?.visible?.length || result.beam?.blocked?.length)
        ? result.beam
        : buildSightBeam(result);
    const series = clearanceSeries(result);
    const cut = result.obstruction?.index;
    const hasCut = Number.isInteger(cut) && cut > 0 && cut < samples.length - 1;
    const overallClearance = hasCut && result.obstruction
        && Number.isFinite(result.obstruction.losM)
        && Number.isFinite(result.obstruction.effectiveM)
        ? result.obstruction.losM - result.obstruction.effectiveM
        : minFinite(series);
    /** @type {{ role: string, name: string, geojson: { type: 'FeatureCollection', features: object[] } }[]} */
    const layers = [];

    const profile = lineStringFromPoints(samples, 'elevationM');
    if (profile) {
        layers.push({
            role: 'profile',
            name: LOS_ADDED_LAYER_NAMES.profile,
            geojson: featureCollection([{
                type: 'Feature',
                properties: resultAttributes(result, {
                    kind: 'profile',
                    clearanceM: overallClearance
                }),
                geometry: profile
            }])
        });
    }

    const visibleLine = lineStringFromPoints(beam?.visible, 'altitudeM');
    if (visibleLine) {
        const visiblePoints = beam.visible;
        layers.push({
            role: 'beam-visible',
            name: LOS_ADDED_LAYER_NAMES.visible,
            geojson: featureCollection([{
                type: 'Feature',
                properties: resultAttributes(result, {
                    kind: 'beam-visible',
                    visible: 'yes',
                    clearanceM: minFinite(hasCut ? series.slice(0, cut) : series),
                    startAltitudeM: finiteOrNull(visiblePoints[0]?.altitudeM),
                    endAltitudeM: finiteOrNull(visiblePoints[visiblePoints.length - 1]?.altitudeM)
                }),
                geometry: visibleLine
            }])
        });
    }

    const blockedLine = lineStringFromPoints(beam?.blocked, 'altitudeM');
    if (blockedLine) {
        const blockedPoints = beam.blocked;
        layers.push({
            role: 'beam-blocked',
            name: LOS_ADDED_LAYER_NAMES.blocked,
            geojson: featureCollection([{
                type: 'Feature',
                properties: resultAttributes(result, {
                    kind: 'beam-blocked',
                    visible: 'no',
                    clearanceM: minFinite(hasCut ? series.slice(cut) : series),
                    startAltitudeM: finiteOrNull(blockedPoints[0]?.altitudeM),
                    endAltitudeM: finiteOrNull(blockedPoints[blockedPoints.length - 1]?.altitudeM)
                }),
                geometry: blockedLine
            }])
        });
    }

    const endpoints = [];
    const pushEndpoint = (sample, label, kind, distanceM, clearanceM) => {
        const lng = Number(sample?.lng);
        const lat = Number(sample?.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
        endpoints.push({
            type: 'Feature',
            properties: resultAttributes(result, {
                kind,
                label,
                distanceM,
                clearanceM,
                elevationM: finiteOrNull(sample.elevationM)
            }),
            geometry: { type: 'Point', coordinates: [lng, lat] }
        });
    };
    const total = Number(samples[samples.length - 1].distanceM);
    pushEndpoint(samples[0], 'Observer', 'observer', 0, series[0] ?? null);
    pushEndpoint(
        samples[samples.length - 1],
        'Target',
        'target',
        Number.isFinite(total) ? total : null,
        series[series.length - 1] ?? null
    );
    if (endpoints.length) {
        layers.push({
            role: 'endpoints',
            name: LOS_ADDED_LAYER_NAMES.endpoints,
            geojson: featureCollection(endpoints)
        });
    }

    const obstruction = result.obstruction;
    if (obstruction && Number.isFinite(obstruction.lng) && Number.isFinite(obstruction.lat)) {
        layers.push({
            role: 'obstruction',
            name: LOS_ADDED_LAYER_NAMES.obstruction,
            geojson: featureCollection([{
                type: 'Feature',
                properties: resultAttributes(result, {
                    kind: 'obstruction',
                    visible: 'no',
                    distanceM: Number.isFinite(obstruction.distanceM) ? obstruction.distanceM : null,
                    clearanceM: Number.isFinite(obstruction.losM) && Number.isFinite(obstruction.effectiveM)
                        ? obstruction.losM - obstruction.effectiveM
                        : null,
                    elevationM: finiteOrNull(obstruction.elevationM),
                    effectiveM: finiteOrNull(obstruction.effectiveM),
                    losM: finiteOrNull(obstruction.losM),
                    bulgeM: finiteOrNull(obstruction.bulgeM)
                }),
                geometry: {
                    type: 'Point',
                    coordinates: [obstruction.lng, obstruction.lat]
                }
            }])
        });
    }

    return layers;
}
