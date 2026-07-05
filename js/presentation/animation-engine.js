/**
 * Reusable presentation animation engine for MapLibre maps.
 */

import { runPresentationAnimationStep } from './presentation-animation-handlers.js';
import { PRESENTATION_SOURCE_ID, COMBO_FLY_RATIO } from './presentation-constants.js';

const ANIMATED_POINT_SOURCE = 'presentation-animated-point';
const ANIMATED_LINE_SOURCE = 'presentation-animated-line';
const PRESENTATION_LINE_LAYER = `${PRESENTATION_SOURCE_ID}-line`;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function cinematicEase(t) {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
}

function easeValue(t, easing) {
    const clamped = Math.min(1, Math.max(0, t));
    switch (easing) {
        case 'easeIn':
            return clamped * clamped;
        case 'easeOut':
            return 1 - (1 - clamped) * (1 - clamped);
        case 'easeInOut':
        case 'cinematic':
            return cinematicEase(clamped);
        default:
            return clamped;
    }
}

function getTurf() {
    return globalThis.turf;
}

/**
 * @param {import('geojson').FeatureCollection} featureCollection
 */
export function getFeatureBounds(featureCollection) {
    const turf = getTurf();
    if (!turf || !featureCollection?.features?.length) return null;
    try {
        const bbox = turf.bbox(featureCollection);
        return [[bbox[0], bbox[1]], [bbox[2], bbox[3]]];
    } catch {
        return null;
    }
}

/**
 * @param {import('geojson').FeatureCollection} featureCollection
 */
export function getFeatureCenter(featureCollection) {
    const turf = getTurf();
    if (!turf || !featureCollection?.features?.length) return null;
    try {
        const center = turf.center(featureCollection);
        return center.geometry.coordinates;
    } catch {
        return null;
    }
}

/**
 * @param {import('geojson').FeatureCollection} featureCollection
 */
function getPrimaryLineFeature(featureCollection) {
    return (featureCollection?.features || []).find((feature) => {
        const type = feature?.geometry?.type;
        return type === 'LineString' || type === 'MultiLineString';
    }) || null;
}

/**
 * @param {import('geojson').FeatureCollection} featureCollection
 * @returns {number[][]}
 */
function getPointCoordinates(featureCollection) {
    const coords = [];
    for (const feature of featureCollection?.features || []) {
        const type = feature?.geometry?.type;
        if (type === 'Point') {
            coords.push(feature.geometry.coordinates);
        } else if (type === 'MultiPoint') {
            coords.push(...feature.geometry.coordinates);
        }
    }
    return coords;
}

function removeLayerIfExists(map, layerId) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
}

function removeSourceIfExists(map, sourceId) {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
}

function ensureAnimatedPointLayer(map, style = {}) {
    removeLayerIfExists(map, `${ANIMATED_POINT_SOURCE}-circle`);
    removeSourceIfExists(map, ANIMATED_POINT_SOURCE);
    map.addSource(ANIMATED_POINT_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer({
        id: `${ANIMATED_POINT_SOURCE}-circle`,
        type: 'circle',
        source: ANIMATED_POINT_SOURCE,
        paint: {
            'circle-radius': style.pointRadius ?? 8,
            'circle-color': style.lineColor ?? '#007aff',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-opacity': 0.95
        }
    });
}

function ensureAnimatedLineLayer(map, style = {}) {
    removeLayerIfExists(map, `${ANIMATED_LINE_SOURCE}-line`);
    removeSourceIfExists(map, ANIMATED_LINE_SOURCE);
    map.addSource(ANIMATED_LINE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer({
        id: `${ANIMATED_LINE_SOURCE}-line`,
        type: 'line',
        source: ANIMATED_LINE_SOURCE,
        paint: {
            'line-color': style.lineColor ?? '#007aff',
            'line-width': style.lineWidth ?? 5,
            'line-opacity': 0.95
        }
    });
}

function setAnimatedPoint(map, coordinate) {
    setAnimatedPoints(map, [coordinate]);
}

function setAnimatedPoints(map, coordinates) {
    const source = map.getSource(ANIMATED_POINT_SOURCE);
    if (!source || !coordinates?.length) return;
    source.setData({
        type: 'FeatureCollection',
        features: coordinates.map((coordinate) => ({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: coordinate }
        }))
    });
}

function setAnimatedLine(map, coordinates) {
    const source = map.getSource(ANIMATED_LINE_SOURCE);
    if (!source || !coordinates?.length) return;
    source.setData({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates }
        }]
    });
}

function setPresentationLineLayerVisible(map, visible) {
    if (!map?.getLayer?.(PRESENTATION_LINE_LAYER)) return;
    map.setLayoutProperty(
        PRESENTATION_LINE_LAYER,
        'visibility',
        visible ? 'visible' : 'none'
    );
}

const PRESENTATION_FIT_MAX_ZOOM = 16;
const PRESENTATION_POINT_MIN_ZOOM = 14;
const OVERVIEW_EXPAND_FACTOR = 3.5;
const OVERVIEW_MAX_ZOOM = 11;
const OVERVIEW_ZOOM_GAP = 2.5;

/**
 * @param {[[number, number], [number, number]]} bounds
 * @param {number} [factor]
 */
function expandBounds(bounds, factor = OVERVIEW_EXPAND_FACTOR) {
    const [[west, south], [east, north]] = bounds;
    const centerLng = (west + east) / 2;
    const centerLat = (south + north) / 2;
    const halfWidth = Math.max(Math.abs(east - west) / 2, 0.0005) * factor;
    const halfHeight = Math.max(Math.abs(north - south) / 2, 0.0005) * factor;
    return [[centerLng - halfWidth, centerLat - halfHeight], [centerLng + halfWidth, centerLat + halfHeight]];
}

/**
 * Estimate overview zoom from geographic span (fallback when no map is available).
 * @param {[[number, number], [number, number]]} bounds
 */
function estimateZoomFromBounds(bounds) {
    const [[west, south], [east, north]] = bounds;
    const centerLat = (south + north) / 2;
    const latRad = (centerLat * Math.PI) / 180;
    const widthDeg = Math.max(Math.abs(east - west), 0.001);
    const heightDeg = Math.max(Math.abs(north - south), 0.001);
    const maxSpan = Math.max(widthDeg * Math.cos(latRad), heightDeg);
    const zoom = Math.log2(360 / maxSpan) - 0.5;
    return Math.max(1, Math.min(OVERVIEW_MAX_ZOOM, zoom));
}

/**
 * Compute a wide overview camera for fly-to presentations.
 * @param {import('geojson').FeatureCollection} featureCollection
 * @param {object} [options]
 * @param {import('maplibre-gl').Map} [options.map]
 * @param {number} [options.padding]
 * @param {number} [options.bearing]
 * @param {number} [options.targetZoom] — ensure overview is at least this many levels wider
 */
export function computeOverviewCamera(featureCollection, options = {}) {
    const bounds = getFeatureBounds(featureCollection);
    if (!bounds) return null;

    const expanded = expandBounds(bounds, options.expandFactor ?? OVERVIEW_EXPAND_FACTOR);
    const centerCoords = getFeatureCenter(featureCollection) || [
        (expanded[0][0] + expanded[1][0]) / 2,
        (expanded[0][1] + expanded[1][1]) / 2
    ];
    const padding = options.padding ?? 120;
    const bearing = options.bearing ?? 0;

    const map = options.map;
    let overviewZoom = estimateZoomFromBounds(expanded);

    if (map?.fitBounds) {
        const saved = {
            center: map.getCenter(),
            zoom: map.getZoom(),
            pitch: map.getPitch(),
            bearing: map.getBearing()
        };
        try {
            map.fitBounds(expanded, {
                padding,
                duration: 0,
                maxZoom: OVERVIEW_MAX_ZOOM,
                essential: true
            });
            overviewZoom = map.getZoom();
            map.jumpTo({
                center: saved.center,
                zoom: saved.zoom,
                pitch: saved.pitch,
                bearing: saved.bearing,
                essential: true
            });
        } catch {
            // use estimate
        }
    }

    if (options.targetZoom != null) {
        overviewZoom = Math.min(overviewZoom, options.targetZoom - OVERVIEW_ZOOM_GAP);
    }
    overviewZoom = Math.max(1, Math.min(OVERVIEW_MAX_ZOOM, overviewZoom));

    return {
        center: centerCoords,
        zoom: overviewZoom,
        pitch: 0,
        bearing
    };
}

/**
 * Measure the camera that tightly frames features without leaving the map changed.
 * @param {import('maplibre-gl').Map} map
 * @param {import('geojson').FeatureCollection} featureCollection
 * @param {object} [options]
 */
export function computeFeatureFitCamera(map, featureCollection, options = {}) {
    if (!map) return null;
    const bounds = getFeatureBounds(featureCollection);
    if (!bounds) return null;

    const padding = options.padding ?? 80;
    const maxZoom = options.maxZoom ?? PRESENTATION_FIT_MAX_ZOOM;
    const pitch = options.pitch ?? map.getPitch();
    const bearing = options.bearing ?? map.getBearing();

    if (isDegenerateBounds(bounds)) {
        const centerLng = (bounds[0][0] + bounds[1][0]) / 2;
        const centerLat = (bounds[0][1] + bounds[1][1]) / 2;
        return {
            center: [centerLng, centerLat],
            zoom: Math.min(maxZoom, PRESENTATION_POINT_MIN_ZOOM),
            pitch,
            bearing
        };
    }

    const saved = {
        center: map.getCenter(),
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing()
    };

    try {
        map.fitBounds(bounds, {
            padding,
            maxZoom,
            pitch,
            duration: 0,
            essential: true
        });
        const result = {
            center: [map.getCenter().lng, map.getCenter().lat],
            zoom: map.getZoom(),
            pitch,
            bearing
        };
        map.jumpTo({
            center: saved.center,
            zoom: saved.zoom,
            pitch: saved.pitch,
            bearing: saved.bearing,
            essential: true
        });
        return result;
    } catch {
        return null;
    }
}

function waitForMoveEnd(map, timeoutMs = 15000) {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            map.off('moveend', finish);
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(finish, timeoutMs);
        map.once('moveend', finish);
    });
}

function runFlyTo(map, options) {
    return new Promise((resolve) => {
        if ((options.duration ?? 0) === 0) {
            map.jumpTo({ ...options, essential: true });
            resolve();
            return;
        }
        map.once('moveend', resolve);
        map.flyTo({ ...options, essential: true });
        setTimeout(resolve, (options.duration || 0) + 200);
    });
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function lerpBearing(from, to, t) {
    const delta = ((to - from + 540) % 360) - 180;
    return from + delta * t;
}

/**
 * Smooth camera fly with pitch, zoom, center, and bearing animated in sync from frame one.
 * @param {import('maplibre-gl').Map} map
 * @param {object} from
 * @param {object} to
 * @param {object} [options]
 */
function runCinematicCameraFly(map, from, to, options = {}) {
    const duration = options.duration ?? 3000;
    const easing = options.easing ?? 'easeInOut';
    const shouldStop = options.shouldStop ?? (() => false);
    const setRafId = options.setRafId;

    if (duration === 0) {
        map.jumpTo({
            center: to.center,
            zoom: to.zoom,
            pitch: to.pitch,
            bearing: to.bearing,
            essential: true
        });
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const startTime = performance.now();
        const frame = (now) => {
            if (shouldStop()) {
                resolve();
                return;
            }
            const progress = Math.min(1, (now - startTime) / duration);
            const eased = easeValue(progress, easing);

            map.jumpTo({
                center: [
                    lerp(from.center[0], to.center[0], eased),
                    lerp(from.center[1], to.center[1], eased)
                ],
                zoom: lerp(from.zoom, to.zoom, eased),
                pitch: lerp(from.pitch, to.pitch, eased),
                bearing: lerpBearing(from.bearing, to.bearing, eased),
                essential: true
            });

            if (progress >= 1) {
                resolve();
                return;
            }
            const id = requestAnimationFrame(frame);
            setRafId?.(id);
        };
        const id = requestAnimationFrame(frame);
        setRafId?.(id);
    });
}

/**
 * @param {[[number, number], [number, number]]} bounds
 */
function isDegenerateBounds(bounds) {
    const [[west, south], [east, north]] = bounds;
    return Math.abs(west - east) < 1e-9 && Math.abs(south - north) < 1e-9;
}

/**
 * Fit the map to feature bounds. MapLibre flyTo does not accept bounds — use fitBounds.
 * @param {import('maplibre-gl').Map} map
 * @param {[[number, number], [number, number]]} bounds
 * @param {object} [options]
 */
function runFitToBounds(map, bounds, options = {}) {
    const {
        padding = 80,
        maxZoom = PRESENTATION_FIT_MAX_ZOOM,
        pitch,
        bearing,
        duration = 0
    } = options;

    const resolvedPitch = pitch ?? map.getPitch();
    const resolvedBearing = bearing ?? map.getBearing();

    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            map.off('moveend', finish);
            if (resolvedBearing !== 0 && !isDegenerateBounds(bounds)) {
                map.setBearing(resolvedBearing);
            }
            resolve();
        };

        map.once('moveend', finish);
        setTimeout(finish, duration + 200);

        if (isDegenerateBounds(bounds)) {
            const centerLng = (bounds[0][0] + bounds[1][0]) / 2;
            const centerLat = (bounds[0][1] + bounds[1][1]) / 2;
            const targetZoom = Math.min(
                maxZoom,
                Math.max(map.getZoom?.() ?? 10, PRESENTATION_POINT_MIN_ZOOM)
            );
            map.flyTo({
                center: [centerLng, centerLat],
                zoom: targetZoom,
                pitch: resolvedPitch,
                bearing: resolvedBearing,
                duration,
                essential: true
            });
            return;
        }

        map.fitBounds(bounds, {
            padding,
            maxZoom,
            pitch: resolvedPitch,
            duration,
            essential: true
        });
    });
}

function sampleLineCoordinates(lineFeature, steps = 120) {
    const turf = getTurf();
    if (!turf || !lineFeature) return [];
    const coords = [];
    for (let i = 0; i <= steps; i += 1) {
        const point = turf.along(lineFeature, (i / steps) * turf.length(lineFeature), { units: 'kilometers' });
        coords.push(point.geometry.coordinates);
    }
    return coords;
}

/**
 * @param {import('geojson').Feature} lineFeature
 */
function buildPathLineFromFeature(lineFeature) {
    const turf = getTurf();
    if (!turf || !lineFeature?.geometry) return null;
    const coords = lineFeature.geometry.type === 'MultiLineString'
        ? lineFeature.geometry.coordinates[0]
        : lineFeature.geometry.coordinates;
    if (!coords || coords.length < 2) return null;
    return turf.lineString(coords);
}

/**
 * @param {import('geojson').LineString | import('geojson').MultiLineString} geometry
 */
function getLineGeometryCoordinates(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'LineString') return geometry.coordinates;
    if (geometry.type === 'MultiLineString') return geometry.coordinates.flat();
    return [];
}

/**
 * Coordinates from path start to a distance along the line (constant-speed draw).
 * @param {import('geojson').Feature<import('geojson').LineString>} path
 * @param {number} distanceKm
 */
function sliceLinePathToDistance(path, distanceKm) {
    const turf = getTurf();
    if (!turf || !path) return [];
    const totalLength = turf.length(path, { units: 'kilometers' });
    if (totalLength <= 0) return [];

    if (distanceKm <= 0) {
        const start = turf.along(path, 0, { units: 'kilometers' });
        const coord = start.geometry.coordinates;
        return [coord, coord];
    }
    if (distanceKm >= totalLength) {
        return path.geometry.coordinates;
    }

    const slice = turf.lineSliceAlong(path, 0, distanceKm, { units: 'kilometers' });
    const coords = getLineGeometryCoordinates(slice.geometry);
    if (coords.length >= 2) return coords;
    if (coords.length === 1) return [coords[0], coords[0]];
    return [];
}

function bearingBetween(a, b) {
    const turf = getTurf();
    if (!turf) return 0;
    return turf.bearing(turf.point(a), turf.point(b));
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} path
 * @param {number} distanceKm
 */
function pointAlongPath(path, distanceKm) {
    const turf = getTurf();
    if (!turf || !path) return null;
    const totalLength = turf.length(path, { units: 'kilometers' });
    if (totalLength <= 0) return null;
    const clamped = Math.min(totalLength, Math.max(0, distanceKm));
    return turf.along(path, clamped, { units: 'kilometers' }).geometry.coordinates;
}

/** Tunables for cinematic Follow path camera. */
const PATH_FOLLOW = {
    lookAheadRatio: 0.22,
    lookAheadMinKm: 0.05,
    lookAheadMaxKm: 3.5,
    bearingSmoothSec: 1.05,
    centerSmoothSec: 0.5
};

/** Look-ahead distance for cinematic path-following camera. */
function computePathLookAheadKm(totalLengthKm) {
    return Math.min(
        PATH_FOLLOW.lookAheadMaxKm,
        Math.max(PATH_FOLLOW.lookAheadMinKm, totalLengthKm * PATH_FOLLOW.lookAheadRatio)
    );
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} path
 * @param {number} distanceKm
 * @param {number} lookAheadKm
 * @param {number} totalLengthKm
 */
function bearingAlongPath(path, distanceKm, lookAheadKm, totalLengthKm) {
    const from = pointAlongPath(path, distanceKm);
    if (!from) return 0;
    const aheadKm = Math.min(totalLengthKm, distanceKm + lookAheadKm);
    const to = pointAlongPath(path, aheadKm);
    if (!to) return 0;
    if (Math.abs(aheadKm - distanceKm) < 1e-9) {
        const fallback = pointAlongPath(path, Math.min(totalLengthKm, distanceKm + 0.001));
        return fallback ? bearingBetween(from, fallback) : 0;
    }
    return bearingBetween(from, to);
}

function lerpAngle(fromDeg, toDeg, t) {
    const clampedT = Math.min(1, Math.max(0, t));
    const delta = ((toDeg - fromDeg + 540) % 360) - 180;
    return fromDeg + delta * clampedT;
}

function expSmoothFactor(deltaMs, timeConstantSec) {
    return 1 - Math.exp(-deltaMs / (timeConstantSec * 1000));
}

function lerpCoord(from, to, t) {
    const s = Math.min(1, Math.max(0, t));
    return [from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s];
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {import('geojson').Feature<import('geojson').LineString>} path
 * @param {number} distanceKm
 * @param {number} lookAheadKm
 * @param {number} totalLengthKm
 * @param {import('./presentation-scene-schema.js').PresentationAnimationStep} step
 * @param {{ currentCenter: number[] | null, currentBearing: number }} state
 * @param {number} deltaMs
 */
function applySmoothedPathFollowCamera(map, path, distanceKm, lookAheadKm, totalLengthKm, step, state, deltaMs) {
    const targetCenter = pointAlongPath(path, distanceKm);
    if (!targetCenter) return false;

    const targetBearing = bearingAlongPath(path, distanceKm, lookAheadKm, totalLengthKm);
    const bearingT = expSmoothFactor(deltaMs, PATH_FOLLOW.bearingSmoothSec);
    const centerT = expSmoothFactor(deltaMs, PATH_FOLLOW.centerSmoothSec);
    state.currentBearing = lerpAngle(state.currentBearing, targetBearing, bearingT);
    state.currentCenter = state.currentCenter
        ? lerpCoord(state.currentCenter, targetCenter, centerT)
        : targetCenter;

    map.easeTo({
        center: state.currentCenter,
        bearing: state.currentBearing,
        pitch: step.options?.pitch ?? map.getPitch(),
        zoom: step.options?.zoom ?? map.getZoom(),
        duration: 0,
        essential: true
    });
    return true;
}

export class PresentationAnimationEngine {
    /**
     * @param {object} options
     * @param {import('maplibre-gl').Map} options.map
     * @param {import('geojson').FeatureCollection} options.features
     * @param {import('./presentation-scene-schema.js').PresentationStyle} [options.style]
     */
    constructor({ map, features, style = {} }) {
        this.map = map;
        this.features = features;
        this.style = style;
        this._stopped = false;
        this._rafId = null;
        this._sceneLayers = [];
    }

    stop() {
        this._stopped = true;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    reset() {
        this.stop();
        this._stopped = false;
    }

    cleanup() {
        this.stop();
        const map = this.map;
        if (!map) return;
        removeLayerIfExists(map, `${ANIMATED_POINT_SOURCE}-circle`);
        removeSourceIfExists(map, ANIMATED_POINT_SOURCE);
        removeLayerIfExists(map, `${ANIMATED_LINE_SOURCE}-line`);
        removeSourceIfExists(map, ANIMATED_LINE_SOURCE);
        setPresentationLineLayerVisible(map, true);
        for (const layerId of this._sceneLayers) {
            removeLayerIfExists(map, layerId);
        }
        for (const sourceId of [PRESENTATION_SOURCE_ID]) {
            removeSourceIfExists(map, sourceId);
        }
        this._sceneLayers = [];
    }

    /**
     * @param {import('./presentation-scene-schema.js').PresentationCamera} camera
     */
    async applyCamera(camera = {}) {
        const map = this.map;
        if (!map) return;

        if (camera.resetNorth) {
            map.setBearing(0);
        }

        if (camera.startDelayMs > 0) {
            await sleep(camera.startDelayMs);
            if (this._stopped) return;
        }

        if (camera.fitToFeatures) {
            const bounds = getFeatureBounds(this.features);
            if (bounds) {
                await runFitToBounds(map, bounds, {
                    padding: camera.padding ?? 80,
                    pitch: camera.pitch ?? map.getPitch(),
                    bearing: camera.bearing ?? map.getBearing(),
                    duration: 0
                });
                return;
            }
        }

        if (camera.useCurrent) {
            return;
        }

        await runFlyTo(map, {
            center: camera.center,
            zoom: camera.zoom,
            pitch: camera.pitch ?? 0,
            bearing: camera.bearing ?? 0,
            duration: 0
        });
    }

    /**
     * @param {import('./presentation-scene-schema.js').PresentationAnimationStep[]} steps
     */
    async playSequence(steps = []) {
        for (const step of steps) {
            if (this._stopped) return;
            if (step.delayMs > 0) {
                await sleep(step.delayMs);
                if (this._stopped) return;
            }
            await this.playStep(step);
            if (this._stopped) return;
            if (!step.loop) continue;
            await this.playStep(step);
        }
    }

    /**
     * @param {import('./presentation-scene-schema.js').PresentationAnimationStep} step
     */
    async playStep(step) {
        return runPresentationAnimationStep(this, step);
    }

    async _flyToFeature(step) {
        await this._runCinematicFlyTo(step);
    }

    async _flyToFeatureThenOrbit(step) {
        const flyDurationMs = step.options?.flyDurationMs
            ?? Math.round((step.durationMs ?? 10000) * COMBO_FLY_RATIO);
        const orbitDurationMs = step.options?.orbitDurationMs
            ?? ((step.durationMs ?? 10000) - flyDurationMs);
        await this._runFlyThenOrbitCombined(step, flyDurationMs, orbitDurationMs);
    }

    async _runFlyThenOrbitCombined(step, flyDurationMs, orbitDurationMs) {
        const map = this.map;
        const bounds = getFeatureBounds(this.features);
        const centerCoords = getFeatureCenter(this.features);
        if (!bounds || !centerCoords) return;

        const padding = step.options?.padding ?? 80;
        const requestedPitch = step.options?.pitch;
        const targetPitch = (requestedPitch != null && requestedPitch > 5) ? requestedPitch : 55;
        const targetBearing = step.options?.bearing ?? map.getBearing();
        const easing = step.easing || 'cinematic';

        const fit = computeFeatureFitCamera(map, this.features, {
            padding,
            pitch: targetPitch,
            bearing: targetBearing
        });
        if (!fit) return;

        const startCenter = map.getCenter();
        const startZoom = map.getZoom();
        const startBearing = map.getBearing();
        const endZoom = Math.max(fit.zoom, startZoom + 0.5);
        const orbitCenter = [centerCoords[0], centerCoords[1]];
        const orbitDegrees = step.options?.degrees ?? 360;

        const crossfadeMs = Math.min(1800, Math.round(flyDurationMs * 0.24));
        const approachDuration = flyDurationMs + crossfadeMs;
        const orbitStartMs = Math.max(0, flyDurationMs - Math.round(crossfadeMs * 0.6));
        const totalDuration = flyDurationMs + orbitDurationMs;
        const orbitSpan = Math.max(1, totalDuration - orbitStartMs);

        map.jumpTo({
            center: startCenter,
            zoom: startZoom,
            pitch: 0,
            bearing: startBearing,
            essential: true
        });

        const from = {
            center: [startCenter.lng, startCenter.lat],
            zoom: startZoom,
            pitch: 0,
            bearing: startBearing
        };
        const to = {
            center: orbitCenter,
            zoom: endZoom,
            pitch: targetPitch,
            bearing: targetBearing
        };

        await new Promise((resolve) => {
            const startTime = performance.now();
            const frame = (now) => {
                if (this._stopped) {
                    resolve();
                    return;
                }

                const elapsed = now - startTime;
                const approachT = Math.min(1, elapsed / approachDuration);
                const approachE = easeValue(approachT, easing);

                const center = [
                    lerp(from.center[0], to.center[0], approachE),
                    lerp(from.center[1], to.center[1], approachE)
                ];
                const zoom = lerp(from.zoom, to.zoom, approachE);
                const pitch = lerp(from.pitch, to.pitch, approachE);
                const approachBearing = lerpBearing(from.bearing, to.bearing, approachE);

                let orbitAngle = 0;
                if (elapsed >= orbitStartMs) {
                    const orbitT = Math.min(1, (elapsed - orbitStartMs) / orbitSpan);
                    const orbitE = easeValue(orbitT, easing);
                    orbitAngle = orbitE * orbitDegrees;
                }

                map.jumpTo({
                    center,
                    zoom,
                    pitch,
                    bearing: approachBearing + orbitAngle,
                    essential: true
                });

                if (elapsed >= totalDuration) {
                    resolve();
                    return;
                }
                this._rafId = requestAnimationFrame(frame);
            };
            this._rafId = requestAnimationFrame(frame);
        });
    }

    async _runCinematicFlyTo(step, overrides = {}) {
        const map = this.map;
        const bounds = getFeatureBounds(this.features);
        if (!bounds) return;

        const padding = step.options?.padding ?? 80;
        const requestedPitch = step.options?.pitch;
        const targetPitch = (requestedPitch != null && requestedPitch > 5) ? requestedPitch : 55;
        const targetBearing = step.options?.bearing ?? map.getBearing();

        const target = computeFeatureFitCamera(map, this.features, {
            padding,
            pitch: targetPitch,
            bearing: targetBearing
        });
        if (!target) return;

        const featureCenter = getFeatureCenter(this.features);
        if (featureCenter) {
            target.center = featureCenter;
        }

        const startCenter = map.getCenter();
        const startZoom = map.getZoom();
        const startBearing = map.getBearing();
        const endZoom = Math.max(target.zoom, startZoom + 0.5);
        const duration = overrides.durationMs ?? step.durationMs ?? 3000;

        map.jumpTo({
            center: startCenter,
            zoom: startZoom,
            pitch: 0,
            bearing: startBearing,
            essential: true
        });

        await runCinematicCameraFly(map, {
            center: [startCenter.lng, startCenter.lat],
            zoom: startZoom,
            pitch: 0,
            bearing: startBearing
        }, {
            center: target.center,
            zoom: endZoom,
            pitch: targetPitch,
            bearing: targetBearing
        }, {
            duration,
            easing: step.easing || 'cinematic',
            shouldStop: () => this._stopped,
            setRafId: (id) => { this._rafId = id; }
        });
    }

    async _rotateAroundFeature(step) {
        await this._runOrbitRotation(step, { skipSetup: true });
    }

    async _runOrbitRotation(step, { durationMs, skipSetup = false } = {}) {
        const map = this.map;
        const centerCoords = getFeatureCenter(this.features);
        if (!centerCoords) return;

        const orbitDuration = durationMs ?? step.durationMs ?? 6000;
        let startBearing = map.getBearing();

        if (!skipSetup) {
            const pitch = step.options?.pitch ?? 55;
            startBearing = step.options?.bearing ?? startBearing;
            const bounds = getFeatureBounds(this.features);

            if (bounds) {
                await runFitToBounds(map, bounds, {
                    padding: step.options?.padding ?? 80,
                    pitch,
                    bearing: startBearing,
                    duration: 0
                });
            }

            const center = { lng: centerCoords[0], lat: centerCoords[1] };
            const settleFrom = map.getCenter();
            await runCinematicCameraFly(map, {
                center: [settleFrom.lng, settleFrom.lat],
                zoom: map.getZoom(),
                pitch: map.getPitch(),
                bearing: startBearing
            }, {
                center: [center.lng, center.lat],
                zoom: map.getZoom(),
                pitch,
                bearing: startBearing
            }, {
                duration: 700,
                easing: 'cinematic',
                shouldStop: () => this._stopped,
                setRafId: (id) => { this._rafId = id; }
            });
            startBearing = map.getBearing();
        }

        const startTime = performance.now();
        const orbitEasing = step.easing || 'cinematic';
        await new Promise((resolve) => {
            const frame = (now) => {
                if (this._stopped) {
                    resolve();
                    return;
                }
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / orbitDuration);
                const eased = easeValue(progress, orbitEasing);
                const bearing = startBearing + eased * (step.options?.degrees ?? 360);
                map.setBearing(bearing);
                if (progress >= 1) {
                    resolve();
                    return;
                }
                this._rafId = requestAnimationFrame(frame);
            };
            this._rafId = requestAnimationFrame(frame);
        });
    }

    async _flyAlongPath(step) {
        const map = this.map;
        const turf = getTurf();
        const lineFeature = getPrimaryLineFeature(this.features);
        const path = buildPathLineFromFeature(lineFeature);
        if (!turf || !path) return;

        const totalLength = turf.length(path, { units: 'kilometers' });
        if (totalLength <= 0) return;

        const lookAheadKm = computePathLookAheadKm(totalLength);
        const cameraState = {
            currentCenter: pointAlongPath(path, 0),
            currentBearing: bearingAlongPath(path, 0, lookAheadKm, totalLength)
        };
        const startTime = performance.now();
        let lastFrameTime = startTime;

        await new Promise((resolve) => {
            const frame = (now) => {
                if (this._stopped) {
                    resolve();
                    return;
                }
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / step.durationMs);
                const eased = easeValue(progress, step.easing);
                const distanceKm = eased * totalLength;
                const deltaMs = Math.max(1, now - lastFrameTime);
                lastFrameTime = now;
                applySmoothedPathFollowCamera(
                    map,
                    path,
                    distanceKm,
                    lookAheadKm,
                    totalLength,
                    step,
                    cameraState,
                    deltaMs
                );
                if (progress >= 1) {
                    resolve();
                    return;
                }
                this._rafId = requestAnimationFrame(frame);
            };
            this._rafId = requestAnimationFrame(frame);
        });
    }

    async _animatePointAlongLine(step) {
        const map = this.map;
        const turf = getTurf();
        const lineFeature = getPrimaryLineFeature(this.features);
        const path = buildPathLineFromFeature(lineFeature);
        if (!turf || !path) return;

        const totalLength = turf.length(path, { units: 'kilometers' });
        if (totalLength <= 0) return;

        ensureAnimatedPointLayer(map, this.style);
        const followCamera = step.options?.followCamera !== false;
        const lookAheadKm = computePathLookAheadKm(totalLength);
        const startMarker = pointAlongPath(path, 0);
        const cameraState = followCamera ? {
            currentCenter: startMarker,
            currentBearing: bearingAlongPath(path, 0, lookAheadKm, totalLength)
        } : null;
        const startTime = performance.now();
        let lastFrameTime = startTime;

        if (startMarker) {
            setAnimatedPoint(map, startMarker);
        }

        await new Promise((resolve) => {
            const frame = (now) => {
                if (this._stopped) {
                    resolve();
                    return;
                }
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / step.durationMs);
                const eased = easeValue(progress, step.easing);
                const distanceKm = eased * totalLength;
                const markerCoord = pointAlongPath(path, distanceKm);
                if (markerCoord) {
                    setAnimatedPoint(map, markerCoord);
                    if (followCamera && cameraState) {
                        const deltaMs = Math.max(1, now - lastFrameTime);
                        lastFrameTime = now;
                        applySmoothedPathFollowCamera(
                            map,
                            path,
                            distanceKm,
                            lookAheadKm,
                            totalLength,
                            step,
                            cameraState,
                            deltaMs
                        );
                    }
                }
                if (progress >= 1) {
                    resolve();
                    return;
                }
                this._rafId = requestAnimationFrame(frame);
            };
            this._rafId = requestAnimationFrame(frame);
        });
    }

    async _animatePoint(step) {
        const map = this.map;
        const pointCoords = getPointCoordinates(this.features);
        if (!pointCoords.length) return;

        ensureAnimatedPointLayer(map, this.style);
        setAnimatedPoints(map, pointCoords);

        const startTime = performance.now();
        const baseRadius = this.style.pointRadius ?? 7;
        await new Promise((resolve) => {
            const frame = (now) => {
                if (this._stopped) {
                    resolve();
                    return;
                }
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / step.durationMs);
                const pulse = 1 + Math.sin(progress * Math.PI * 4) * 0.35;
                const layerId = `${ANIMATED_POINT_SOURCE}-circle`;
                if (map.getLayer(layerId)) {
                    map.setPaintProperty(layerId, 'circle-radius', baseRadius * pulse);
                }
                if (progress >= 1) {
                    resolve();
                    return;
                }
                this._rafId = requestAnimationFrame(frame);
            };
            this._rafId = requestAnimationFrame(frame);
        });
    }

    async _animateLinePath(step) {
        const map = this.map;
        const turf = getTurf();
        const lineFeature = getPrimaryLineFeature(this.features);
        const path = buildPathLineFromFeature(lineFeature);
        if (!turf || !path) return;

        const totalLength = turf.length(path, { units: 'kilometers' });
        if (totalLength <= 0) return;

        ensureAnimatedLineLayer(map, this.style);
        setPresentationLineLayerVisible(map, false);
        setAnimatedLine(map, sliceLinePathToDistance(path, 0));

        const startTime = performance.now();
        try {
            await new Promise((resolve) => {
                const frame = (now) => {
                    if (this._stopped) {
                        resolve();
                        return;
                    }
                    const elapsed = now - startTime;
                    const progress = Math.min(1, elapsed / step.durationMs);
                    const eased = easeValue(progress, step.easing);
                    const distanceKm = eased * totalLength;
                    setAnimatedLine(map, sliceLinePathToDistance(path, distanceKm));
                    if (progress >= 1) {
                        resolve();
                        return;
                    }
                    this._rafId = requestAnimationFrame(frame);
                };
                this._rafId = requestAnimationFrame(frame);
            });
        } finally {
            setPresentationLineLayerVisible(map, true);
            removeLayerIfExists(map, `${ANIMATED_LINE_SOURCE}-line`);
            removeSourceIfExists(map, ANIMATED_LINE_SOURCE);
        }
    }
}

export function createPresentationAnimationEngine(options) {
    return new PresentationAnimationEngine(options);
}
