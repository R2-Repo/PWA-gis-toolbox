/**
 * Reusable presentation animation engine for MapLibre maps.
 */

const PRESENTATION_SOURCE_PREFIX = 'presentation-scene';
const ANIMATED_POINT_SOURCE = 'presentation-animated-point';
const ANIMATED_LINE_SOURCE = 'presentation-animated-line';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function easeValue(t, easing) {
    const clamped = Math.min(1, Math.max(0, t));
    switch (easing) {
        case 'easeIn':
            return clamped * clamped;
        case 'easeOut':
            return 1 - (1 - clamped) * (1 - clamped);
        case 'easeInOut':
            return clamped < 0.5
                ? 2 * clamped * clamped
                : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
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
    const source = map.getSource(ANIMATED_POINT_SOURCE);
    if (!source) return;
    source.setData({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: coordinate }
        }]
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

const PRESENTATION_FIT_MAX_ZOOM = 16;
const PRESENTATION_POINT_MIN_ZOOM = 14;

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
        map.once('moveend', resolve);
        map.flyTo({ ...options, essential: true });
        setTimeout(resolve, (options.duration || 0) + 200);
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

function bearingBetween(a, b) {
    const turf = getTurf();
    if (!turf) return 0;
    return turf.bearing(turf.point(a), turf.point(b));
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
        for (const layerId of this._sceneLayers) {
            removeLayerIfExists(map, layerId);
        }
        for (const sourceId of [`${PRESENTATION_SOURCE_PREFIX}-source`]) {
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
        switch (step.type) {
            case 'none':
                return;
            case 'flyToFeature':
                return this._flyToFeature(step);
            case 'rotateAroundFeature':
                return this._rotateAroundFeature(step);
            case 'flyAlongPath':
                return this._flyAlongPath(step);
            case 'animatePointAlongLine':
                return this._animatePointAlongLine(step);
            case 'animatePoint':
                return this._animatePoint(step);
            case 'animateLinePath':
                return this._animateLinePath(step);
            default:
                return;
        }
    }

    async _flyToFeature(step) {
        const map = this.map;
        const bounds = getFeatureBounds(this.features);
        if (!bounds) return;
        await runFitToBounds(map, bounds, {
            padding: step.options?.padding ?? 80,
            pitch: step.options?.pitch ?? map.getPitch(),
            bearing: step.options?.bearing ?? map.getBearing(),
            duration: step.durationMs
        });
    }

    async _rotateAroundFeature(step) {
        const map = this.map;
        const centerCoords = getFeatureCenter(this.features);
        if (!centerCoords) return;

        const center = { lng: centerCoords[0], lat: centerCoords[1] };
        const pitch = step.options?.pitch ?? 55;
        const startBearing = step.options?.bearing ?? map.getBearing();
        const startTime = performance.now();

        map.easeTo({
            center,
            zoom: map.getZoom(),
            pitch,
            bearing: startBearing,
            duration: 500,
            essential: true
        });
        await waitForMoveEnd(map);

        await new Promise((resolve) => {
            const frame = (now) => {
                if (this._stopped) {
                    resolve();
                    return;
                }
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / step.durationMs);
                const eased = easeValue(progress, step.easing);
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
        if (!turf || !lineFeature) return;

        const path = turf.lineString(
            lineFeature.geometry.type === 'MultiLineString'
                ? lineFeature.geometry.coordinates[0]
                : lineFeature.geometry.coordinates
        );
        const samples = sampleLineCoordinates(path, 100);
        if (samples.length < 2) return;

        const startTime = performance.now();
        await new Promise((resolve) => {
            const frame = (now) => {
                if (this._stopped) {
                    resolve();
                    return;
                }
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / step.durationMs);
                const eased = easeValue(progress, step.easing);
                const index = Math.min(samples.length - 1, Math.floor(eased * (samples.length - 1)));
                const coord = samples[index];
                const next = samples[Math.min(samples.length - 1, index + 1)];
                map.easeTo({
                    center: coord,
                    bearing: bearingBetween(coord, next),
                    pitch: step.options?.pitch ?? map.getPitch(),
                    zoom: step.options?.zoom ?? map.getZoom(),
                    duration: 0,
                    essential: true
                });
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
        if (!turf || !lineFeature) return;

        const path = turf.lineString(
            lineFeature.geometry.type === 'MultiLineString'
                ? lineFeature.geometry.coordinates[0]
                : lineFeature.geometry.coordinates
        );
        const samples = sampleLineCoordinates(path, 100);
        ensureAnimatedPointLayer(map, this.style);
        const followCamera = step.options?.followCamera !== false;
        const startTime = performance.now();

        await new Promise((resolve) => {
            const frame = (now) => {
                if (this._stopped) {
                    resolve();
                    return;
                }
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / step.durationMs);
                const eased = easeValue(progress, step.easing);
                const index = Math.min(samples.length - 1, Math.floor(eased * (samples.length - 1)));
                const coord = samples[index];
                setAnimatedPoint(map, coord);
                if (followCamera) {
                    map.easeTo({ center: coord, duration: 0, essential: true });
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
        ensureAnimatedPointLayer(map, this.style);
        const center = getFeatureCenter(this.features);
        if (!center) return;
        setAnimatedPoint(map, center);

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
        if (!turf || !lineFeature) return;

        const fullCoords = lineFeature.geometry.type === 'MultiLineString'
            ? lineFeature.geometry.coordinates[0]
            : lineFeature.geometry.coordinates;
        ensureAnimatedLineLayer(map, this.style);
        const startTime = performance.now();

        await new Promise((resolve) => {
            const frame = (now) => {
                if (this._stopped) {
                    resolve();
                    return;
                }
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / step.durationMs);
                const eased = easeValue(progress, step.easing);
                const count = Math.max(2, Math.floor(eased * fullCoords.length));
                setAnimatedLine(map, fullCoords.slice(0, count));
                if (progress >= 1) {
                    setAnimatedLine(map, fullCoords);
                    resolve();
                    return;
                }
                this._rafId = requestAnimationFrame(frame);
            };
            this._rafId = requestAnimationFrame(frame);
        });
    }
}

export function createPresentationAnimationEngine(options) {
    return new PresentationAnimationEngine(options);
}
