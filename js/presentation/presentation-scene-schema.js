/** @typedef {'present'} PresentationMode */

/**
 * @typedef {object} PresentationLayout
 * @property {boolean} fullscreen
 * @property {boolean} splash
 * @property {boolean} panels
 * @property {boolean} tools
 * @property {boolean} header
 * @property {boolean} showLogo
 * @property {boolean} showHomeButton
 * @property {string} homeUrl
 */

/**
 * @typedef {object} PresentationCamera
 * @property {boolean} useCurrent
 * @property {boolean} [fitToFeatures]
 * @property {[number, number]} [center]
 * @property {number} [zoom]
 * @property {number} [pitch]
 * @property {number} [bearing]
 * @property {number} [padding]
 * @property {boolean} [resetNorth]
 * @property {number} [startDelayMs]
 */

/**
 * @typedef {object} PresentationStyle
 * @property {string} featureStylePreset
 * @property {string} lineColor
 * @property {number} lineWidth
 * @property {number} pointRadius
 * @property {number} polygonOpacity
 */

/**
 * @typedef {object} PresentationAnimationStep
 * @property {string} id
 * @property {string} type
 * @property {number} durationMs
 * @property {number} delayMs
 * @property {string} easing
 * @property {string} [target]
 * @property {boolean} [loop]
 * @property {object} [options]
 */

/**
 * @typedef {object} PresentationCallout
 * @property {string} id
 * @property {string} text
 * @property {[number, number]} coordinate
 * @property {number} startMs
 * @property {number} endMs
 * @property {string} [anchor]
 * @property {boolean} [followMapPoint]
 */

/**
 * @typedef {object} PresentationMapView
 * @property {string} [basemap]
 * @property {boolean} [enable3D]
 */

/**
 * @typedef {object} PresentationScene
 * @property {number} version
 * @property {PresentationMode} mode
 * @property {string} createdBy
 * @property {PresentationLayout} layout
 * @property {PresentationCamera} camera
 * @property {PresentationMapView} mapView
 * @property {import('geojson').FeatureCollection} features
 * @property {PresentationStyle} style
 * @property {PresentationAnimationStep[]} animations
 * @property {PresentationCallout[]} callouts
 * @property {{ title?: string, subtitle?: string, generatedAt?: string }} metadata
 */

export const PRESENTATION_SCENE_VERSION = 1;
export const PRESENTATION_HOME_URL = 'https://gis-toolbox.com';
export const PRESENTATION_BASE_URL = 'https://gis-toolbox.com/';

/** @type {PresentationLayout} */
export const DEFAULT_PRESENTATION_LAYOUT = {
    fullscreen: true,
    splash: false,
    panels: false,
    tools: false,
    header: false,
    showLogo: true,
    showHomeButton: true,
    homeUrl: PRESENTATION_HOME_URL
};

/** @type {PresentationMapView} */
export const DEFAULT_PRESENTATION_MAP_VIEW = {
    basemap: 'voyager',
    enable3D: true
};

/** @type {PresentationStyle} */
export const DEFAULT_PRESENTATION_STYLE = {
    featureStylePreset: 'default',
    lineColor: '#007aff',
    lineWidth: 5,
    pointRadius: 7,
    polygonOpacity: 0.35
};

/**
 * @param {Partial<PresentationScene>} [overrides]
 * @returns {PresentationScene}
 */
export function createDefaultScene(overrides = {}) {
    return {
        version: PRESENTATION_SCENE_VERSION,
        mode: 'present',
        createdBy: 'gis-toolbox',
        layout: { ...DEFAULT_PRESENTATION_LAYOUT, ...(overrides.layout || {}) },
        camera: {
            useCurrent: true,
            center: [0, 0],
            zoom: 14,
            pitch: 45,
            bearing: 0,
            padding: 80,
            resetNorth: false,
            startDelayMs: 0,
            ...(overrides.camera || {})
        },
        mapView: { ...DEFAULT_PRESENTATION_MAP_VIEW, ...(overrides.mapView || {}) },
        features: overrides.features || { type: 'FeatureCollection', features: [] },
        style: { ...DEFAULT_PRESENTATION_STYLE, ...(overrides.style || {}) },
        animations: overrides.animations || [],
        callouts: overrides.callouts || [],
        metadata: {
            title: '',
            subtitle: '',
            generatedAt: new Date().toISOString(),
            ...(overrides.metadata || {})
        }
    };
}

/**
 * Compact scene keys for URL encoding.
 * @param {PresentationScene} scene
 */
export function compactScene(scene) {
    return {
        v: scene.version,
        m: scene.mode,
        l: scene.layout,
        c: scene.camera,
        mv: scene.mapView,
        f: scene.features,
        s: scene.style,
        a: scene.animations,
        co: scene.callouts,
        md: scene.metadata
    };
}

/**
 * @param {object} compact
 * @returns {PresentationScene}
 */
export function expandScene(compact) {
    if (!compact || typeof compact !== 'object') {
        throw new Error('Invalid presentation scene payload');
    }
    return createDefaultScene({
        version: compact.v ?? compact.version ?? PRESENTATION_SCENE_VERSION,
        mode: compact.m ?? compact.mode ?? 'present',
        layout: compact.l ?? compact.layout,
        camera: compact.c ?? compact.camera,
        mapView: compact.mv ?? compact.mapView,
        features: compact.f ?? compact.features,
        style: compact.s ?? compact.style,
        animations: compact.a ?? compact.animations,
        callouts: compact.co ?? compact.callouts,
        metadata: compact.md ?? compact.metadata
    });
}
