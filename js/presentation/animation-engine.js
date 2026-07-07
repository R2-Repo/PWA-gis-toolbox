/**
 * Reusable presentation animation engine for MapLibre maps.
 */

import { runPresentationAnimationStep } from './presentation-animation-handlers.js';
import { PRESENTATION_SOURCE_ID, COMBO_FLY_RATIO } from './presentation-constants.js';

const ANIMATED_POINT_SOURCE = 'presentation-animated-point';
const ANIMATED_POINT_LAYER_SHADOW = `${ANIMATED_POINT_SOURCE}-shadow`;
const ANIMATED_POINT_LAYER_GLOW = `${ANIMATED_POINT_SOURCE}-glow`;
const ANIMATED_POINT_LAYER_SYMBOL = `${ANIMATED_POINT_SOURCE}-symbol`;
const ANIMATED_LINE_SOURCE = 'presentation-animated-line';
const PRESENTATION_LINE_LAYER = `${PRESENTATION_SOURCE_ID}-line`;
const TRAVEL_SPHERE_IMAGE_SIZE = 80;
const TRAVEL_MARKER_SIZE_SCALE = 1.42;
const TRAVEL_MARKER_BORDER_COLOR = '#ffffff';

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

function travelSphereImageId(color) {
    return `presentation-travel-sphere-${String(color || '#007aff').replace(/[^a-zA-Z0-9]/g, '')}`;
}

function adjustColorHex(hex, amount) {
    const normalized = String(hex || '#007aff').replace('#', '');
    const parsed = Number.parseInt(normalized, 16);
    if (!Number.isFinite(parsed)) return hex || '#007aff';
    const r = Math.min(255, Math.max(0, (parsed >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((parsed >> 8) & 0xff) + amount));
    const b = Math.min(255, Math.max(0, (parsed & 0xff) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function hexToRgb(hex) {
    const normalized = String(hex || '#007aff').replace('#', '');
    const parsed = Number.parseInt(normalized, 16);
    if (!Number.isFinite(parsed)) return { r: 0, g: 122, b: 255 };
    return { r: (parsed >> 16) & 0xff, g: (parsed >> 8) & 0xff, b: parsed & 0xff };
}

function rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case rn:
                h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
                break;
            case gn:
                h = ((bn - rn) / d + 2) / 6;
                break;
            default:
                h = ((rn - gn) / d + 4) / 6;
                break;
        }
    }
    return { h: h * 360, s, l };
}

function hslToHex(h, s, l) {
    const hue = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hue < 60) {
        r = c; g = x;
    } else if (hue < 120) {
        r = x; g = c;
    } else if (hue < 180) {
        g = c; b = x;
    } else if (hue < 240) {
        g = x; b = c;
    } else if (hue < 300) {
        r = x; b = c;
    } else {
        r = c; b = x;
    }
    const toByte = (value) => Math.round(Math.min(255, Math.max(0, (value + m) * 255)));
    return `#${[toByte(r), toByte(g), toByte(b)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Warm accent when the line color is neutral/gray. */
function deriveContrastingMarkerColor(lineColor) {
    const { r, g, b } = hexToRgb(lineColor);
    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < 0.12) return '#ff6b35';
    const complementHue = (h + 168) % 360;
    const markerSaturation = Math.min(0.92, s + 0.2);
    const markerLightness = l > 0.58 ? 0.46 : Math.min(0.58, l + 0.14);
    return hslToHex(complementHue, markerSaturation, markerLightness);
}

function scaledTravelMarkerRadius(pointRadius) {
    return (pointRadius ?? 8) * TRAVEL_MARKER_SIZE_SCALE;
}

/**
 * Canvas-drawn sphere with ground shadow, white border, and specular highlight.
 * @param {string} lineColor
 */
function createTravelSphereImageData(lineColor) {
    if (typeof document === 'undefined') return null;
    const color = deriveContrastingMarkerColor(lineColor);
    const size = TRAVEL_SPHERE_IMAGE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cx = size / 2;
    const anchorY = size * 0.88;
    const sphereRadius = size * 0.28;
    const sphereCy = anchorY - sphereRadius * 0.92;
    const borderWidth = 3.5;

    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(cx, anchorY, sphereRadius * 0.95, sphereRadius * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = TRAVEL_MARKER_BORDER_COLOR;
    ctx.beginPath();
    ctx.arc(cx, sphereCy, sphereRadius + borderWidth * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.24)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, sphereCy, sphereRadius + borderWidth * 0.55 + 0.5, 0, Math.PI * 2);
    ctx.stroke();

    const bodyGradient = ctx.createRadialGradient(
        cx - sphereRadius * 0.42,
        sphereCy - sphereRadius * 0.42,
        sphereRadius * 0.12,
        cx + sphereRadius * 0.08,
        sphereCy + sphereRadius * 0.12,
        sphereRadius * 1.05
    );
    bodyGradient.addColorStop(0, adjustColorHex(color, 72));
    bodyGradient.addColorStop(0.38, color);
    bodyGradient.addColorStop(1, adjustColorHex(color, -58));
    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.arc(cx, sphereCy, sphereRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(cx, sphereCy, sphereRadius - 0.5, Math.PI * 0.15, Math.PI * 1.05);
    ctx.stroke();

    const highlight = ctx.createRadialGradient(
        cx - sphereRadius * 0.38,
        sphereCy - sphereRadius * 0.48,
        0,
        cx - sphereRadius * 0.38,
        sphereCy - sphereRadius * 0.48,
        sphereRadius * 0.55
    );
    highlight.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    highlight.addColorStop(0.45, 'rgba(255, 255, 255, 0.18)');
    highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = highlight;
    ctx.beginPath();
    ctx.arc(cx - sphereRadius * 0.18, sphereCy - sphereRadius * 0.28, sphereRadius * 0.38, 0, Math.PI * 2);
    ctx.fill();

    return ctx.getImageData(0, 0, size, size);
}

function ensureTravelSphereImage(map, lineColor) {
    const imageId = travelSphereImageId(lineColor);
    if (map.hasImage(imageId)) return imageId;
    const imageData = createTravelSphereImageData(lineColor);
    if (!imageData) return null;
    map.addImage(imageId, imageData, { pixelRatio: 2 });
    return imageId;
}

function travelSphereIconSize(pointRadius) {
    const sphereDiameterPx = TRAVEL_SPHERE_IMAGE_SIZE * 0.56;
    return Math.max(0.2, (pointRadius * 2) / sphereDiameterPx);
}

function removeAnimatedPointLayers(map, style = {}) {
    removeLayerIfExists(map, `${ANIMATED_POINT_SOURCE}-circle`);
    removeLayerIfExists(map, ANIMATED_POINT_LAYER_SHADOW);
    removeLayerIfExists(map, ANIMATED_POINT_LAYER_GLOW);
    removeLayerIfExists(map, ANIMATED_POINT_LAYER_SYMBOL);
    removeSourceIfExists(map, ANIMATED_POINT_SOURCE);
    const imageId = travelSphereImageId(style.lineColor ?? '#007aff');
    if (map.hasImage?.(imageId)) {
        map.removeImage(imageId);
    }
}

function ensureAnimatedPointLayer(map, style = {}) {
    const lineColor = style.lineColor ?? '#007aff';
    const markerColor = deriveContrastingMarkerColor(lineColor);
    const markerRadius = scaledTravelMarkerRadius(style.pointRadius);
    removeAnimatedPointLayers(map, style);

    map.addSource(ANIMATED_POINT_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
        id: ANIMATED_POINT_LAYER_SHADOW,
        type: 'circle',
        source: ANIMATED_POINT_SOURCE,
        paint: {
            'circle-radius': markerRadius * 1.15,
            'circle-color': '#000000',
            'circle-opacity': 0.22,
            'circle-blur': 0.65,
            'circle-translate': [1, 3],
            'circle-translate-anchor': 'viewport',
            'circle-pitch-alignment': 'viewport'
        }
    });

    map.addLayer({
        id: ANIMATED_POINT_LAYER_GLOW,
        type: 'circle',
        source: ANIMATED_POINT_SOURCE,
        paint: {
            'circle-radius': markerRadius * 1.45,
            'circle-color': markerColor,
            'circle-opacity': 0.22,
            'circle-blur': 0.85,
            'circle-pitch-alignment': 'viewport'
        }
    });

    const imageId = ensureTravelSphereImage(map, lineColor);
    if (imageId) {
        map.addLayer({
            id: ANIMATED_POINT_LAYER_SYMBOL,
            type: 'symbol',
            source: ANIMATED_POINT_SOURCE,
            layout: {
                'icon-image': imageId,
                'icon-size': travelSphereIconSize(markerRadius),
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-pitch-alignment': 'viewport',
                'icon-rotation-alignment': 'viewport'
            }
        });
        return;
    }

    map.addLayer({
        id: `${ANIMATED_POINT_SOURCE}-circle`,
        type: 'circle',
        source: ANIMATED_POINT_SOURCE,
        paint: {
            'circle-radius': markerRadius,
            'circle-color': markerColor,
            'circle-stroke-color': TRAVEL_MARKER_BORDER_COLOR,
            'circle-stroke-width': 3,
            'circle-opacity': 0.95,
            'circle-pitch-alignment': 'viewport'
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

function mapEasingFn(name) {
    return (t) => easeValue(t, name);
}

function waitForCameraMove(map, durationMs, timeoutMs = 15000) {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            map.off('moveend', finish);
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(finish, Math.max(durationMs + 250, timeoutMs));
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
 * Smooth camera fly using MapLibre's native easing (better tile loading than per-frame jumpTo).
 * @param {import('maplibre-gl').Map} map
 * @param {object} from
 * @param {object} to
 * @param {object} [options]
 */
function runCinematicCameraFly(map, from, to, options = {}) {
    const duration = options.duration ?? 3000;
    const easing = options.easing ?? 'easeInOut';
    const shouldStop = options.shouldStop ?? (() => false);

    if (shouldStop()) return Promise.resolve();

    if (duration === 0) {
        map.jumpTo({
            center: to.center,
            zoom: to.zoom,
            pitch: to.pitch,
            bearing: to.bearing,
            essential: true,
            freezeElevation: true
        });
        return Promise.resolve();
    }

    map.stop();
    map.jumpTo({
        center: from.center,
        zoom: from.zoom,
        pitch: from.pitch,
        bearing: from.bearing,
        essential: true,
        freezeElevation: true
    });

    map.easeTo({
        center: to.center,
        zoom: to.zoom,
        pitch: to.pitch,
        bearing: to.bearing,
        duration,
        easing: mapEasingFn(easing),
        essential: true,
        freezeElevation: true
    });

    return waitForCameraMove(map, duration).then(() => {
        if (shouldStop()) return;
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

    map.jumpTo({
        center: state.currentCenter,
        bearing: state.currentBearing,
        pitch: step.options?.pitch ?? map.getPitch(),
        zoom: step.options?.zoom ?? map.getZoom(),
        essential: true,
        freezeElevation: true
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
        this._rafIds = new Set();
        this._sceneLayers = [];
    }

    _registerRafId(id) {
        this._rafIds.add(id);
        this._rafId = id;
    }

    stop() {
        this._stopped = true;
        for (const id of this._rafIds) {
            cancelAnimationFrame(id);
        }
        this._rafIds.clear();
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
        removeAnimatedPointLayers(map, this.style);
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
        const entryFromCurrent = step.options?.entryFromCurrent === true;
        const startPitch = entryFromCurrent ? map.getPitch() : 0;

        await runCinematicCameraFly(map, {
            center: [startCenter.lng, startCenter.lat],
            zoom: startZoom,
            pitch: startPitch,
            bearing: startBearing
        }, {
            center: orbitCenter,
            zoom: endZoom,
            pitch: targetPitch,
            bearing: targetBearing
        }, {
            duration: flyDurationMs,
            easing,
            shouldStop: () => this._stopped
        });
        if (this._stopped) return;

        map.stop();
        map.easeTo({
            bearing: map.getBearing() + orbitDegrees,
            duration: orbitDurationMs,
            easing: mapEasingFn(easing),
            essential: true,
            freezeElevation: true
        });
        await waitForCameraMove(map, orbitDurationMs);
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
        const entryFromCurrent = step.options?.entryFromCurrent === true;
        const startPitch = entryFromCurrent ? map.getPitch() : 0;

        map.jumpTo({
            center: startCenter,
            zoom: startZoom,
            pitch: startPitch,
            bearing: startBearing,
            essential: true
        });

        await runCinematicCameraFly(map, {
            center: [startCenter.lng, startCenter.lat],
            zoom: startZoom,
            pitch: startPitch,
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
            setRafId: (id) => { this._registerRafId(id); }
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
                setRafId: (id) => { this._registerRafId(id); }
            });
            startBearing = map.getBearing();
        }

        const orbitEasing = step.easing || 'cinematic';
        map.stop();
        map.easeTo({
            bearing: startBearing + (step.options?.degrees ?? 360),
            duration: orbitDuration,
            easing: mapEasingFn(orbitEasing),
            essential: true,
            freezeElevation: true
        });
        await waitForCameraMove(map, orbitDuration);
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
                this._registerRafId(requestAnimationFrame(frame));
            };
            this._registerRafId(requestAnimationFrame(frame));
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
                this._registerRafId(requestAnimationFrame(frame));
            };
            this._registerRafId(requestAnimationFrame(frame));
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
        const symbolLayerId = ANIMATED_POINT_LAYER_SYMBOL;
        const fallbackLayerId = `${ANIMATED_POINT_SOURCE}-circle`;
        await new Promise((resolve) => {
            const frame = (now) => {
                if (this._stopped) {
                    resolve();
                    return;
                }
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / step.durationMs);
                const pulse = 1 + Math.sin(progress * Math.PI * 4) * 0.35;
                if (map.getLayer(symbolLayerId)) {
                    map.setLayoutProperty(
                        symbolLayerId,
                        'icon-size',
                        travelSphereIconSize(scaledTravelMarkerRadius(baseRadius * pulse))
                    );
                } else if (map.getLayer(fallbackLayerId)) {
                    map.setPaintProperty(fallbackLayerId, 'circle-radius', scaledTravelMarkerRadius(baseRadius * pulse));
                }
                if (progress >= 1) {
                    resolve();
                    return;
                }
                this._registerRafId(requestAnimationFrame(frame));
            };
            this._registerRafId(requestAnimationFrame(frame));
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
                    this._registerRafId(requestAnimationFrame(frame));
                };
                this._registerRafId(requestAnimationFrame(frame));
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
