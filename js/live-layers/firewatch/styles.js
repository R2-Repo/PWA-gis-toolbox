/**
 * MapLibre style expressions for Firewatch layers.
 */
import {
    COLORS,
    FIREFLY_PALETTES,
    HOTSPOT_AGE_RAMP,
    HOTSPOT_DEFAULT_AGE_HOURS,
    INCIDENT_ACRE_BREAKS,
    INCIDENT_ICON_SIZES,
    WILDFIRE_INCIDENT_ICON_ID
} from './constants.js';

/** Perimeter category → color */
export const PERIMETER_COLOR = [
    'match',
    ['get', 'category'],
    'prescribed', COLORS.prescribed,
    'other', COLORS.other,
    COLORS.wildfire
];

/** Legacy recency ramp (kept for tests / fallbacks). */
export const HOTSPOT_CORE_COLOR = [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'ageHours'], HOTSPOT_DEFAULT_AGE_HOURS],
    ...HOTSPOT_AGE_RAMP.flat()
];

/**
 * @param {number[]} sizes
 */
function acreStep(sizes) {
    return [
        'step',
        ['coalesce', ['to-number', ['get', 'dailyAcres']], 0],
        sizes[0],
        INCIDENT_ACRE_BREAKS[0], sizes[1],
        INCIDENT_ACRE_BREAKS[1], sizes[2],
        INCIDENT_ACRE_BREAKS[2], sizes[3],
        INCIDENT_ACRE_BREAKS[3], sizes[4]
    ];
}

export const INCIDENT_ICON_SIZE = [
    'interpolate',
    ['linear'],
    ['zoom'],
    5, acreStep(INCIDENT_ICON_SIZES[5]),
    10, acreStep(INCIDENT_ICON_SIZES[10]),
    14, acreStep(INCIDENT_ICON_SIZES[14])
];

/**
 * @param {string} datasetId
 * @param {string} sourceId
 * @param {number} opacity
 */
export function buildPerimeterLayerSpecs(datasetId, sourceId, opacity = 1) {
    const glowId = `svc-lyr-${datasetId}-glow`;
    const fillId = `svc-lyr-${datasetId}-fill`;
    const outlineId = `svc-lyr-${datasetId}-outline`;

    return [
        {
            id: glowId,
            type: 'line',
            source: sourceId,
            minzoom: 4,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': PERIMETER_COLOR,
                'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 10, 8, 14, 14],
                'line-blur': 6,
                'line-opacity': 0.32 * opacity
            }
        },
        {
            id: fillId,
            type: 'fill',
            source: sourceId,
            minzoom: 4,
            paint: {
                'fill-color': PERIMETER_COLOR,
                'fill-opacity': 0.18 * opacity
            }
        },
        {
            id: outlineId,
            type: 'line',
            source: sourceId,
            minzoom: 4,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': PERIMETER_COLOR,
                'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 10, 2, 14, 3],
                'line-opacity': 0.95 * opacity
            }
        }
    ];
}

/** Feature weight 0.08–1 (already numeric from normalize). */
const WEIGHT = ['coalesce', ['get', 'weight'], 0.08];

/**
 * Hotspot paint — circle Firefly stacks for all three feeds.
 * MapLibre rule: ["zoom"] may ONLY be the input of a top-level interpolate/step.
 * FRP / weight may appear in stop *outputs*, never wrapping a zoom interpolate.
 * @param {string} datasetId
 * @param {string} sourceId
 * @param {number} opacity
 * @param {'viirs' | 'modis' | 'noaa'} [part]
 * @param {string} [_imageId] unused (call-site compat)
 */
export function buildHotspotLayerSpecs(datasetId, sourceId, opacity = 1, part = 'viirs', _imageId = null) {
    return buildStandardHotspotCircleSpecs(datasetId, sourceId, opacity, part);
}

/**
 * Soft Firefly stack (haze → soft → neon → core).
 * @param {string} datasetId
 * @param {string} sourceId
 * @param {number} opacity
 * @param {'viirs' | 'modis' | 'noaa'} part
 */
export function buildStandardHotspotCircleSpecs(datasetId, sourceId, opacity = 1, part = 'viirs') {
    const color = (FIREFLY_PALETTES[part] || FIREFLY_PALETTES.viirs).core;
    const isNoaa = part === 'noaa';

    // NOAA: smaller + high-FRP more transparent.
    const frp = isNoaa
        ? { haze: 0.2, soft: 0.15, neon: 0.1, core: 0.06 }
        : { haze: 0.4, soft: 0.3, neon: 0.2, core: 0.12 };
    const size = isNoaa
        ? {
            haze: [4, 3.5, 8, 5, 12, 6.5, 16, 8],
            soft: [4, 2.5, 8, 3.5, 12, 4.5, 16, 5.5],
            neon: [4, 1.8, 8, 2.4, 12, 3, 16, 3.6],
            core: [4, 1.5, 8, 2, 12, 2.5, 16, 3]
        }
        : {
            haze: [4, 5, 8, 7, 12, 9, 16, 11],
            soft: [4, 3.5, 8, 5, 12, 6.5, 16, 8],
            neon: [4, 2.4, 8, 3.2, 12, 4, 16, 5],
            core: [4, 1.8, 8, 2.5, 12, 3.2, 16, 4]
        };

    /** Zoom-top interpolate; FRP bump only in stop outputs. */
    const radiusAt = (stops, frpScale) => [
        'interpolate', ['linear'], ['zoom'],
        stops[0], ['+', stops[1], ['*', frpScale, WEIGHT]],
        stops[2], ['+', stops[3], ['*', frpScale, WEIGHT]],
        stops[4], ['+', stops[5], ['*', frpScale, WEIGHT]],
        stops[6], ['+', stops[7], ['*', frpScale, WEIGHT]]
    ];

    /** Opacity: zoom on top; NOAA multiplies weight fade in outputs. */
    const opacityAt = (z4, z8, z12) => {
        const a4 = z4 * opacity;
        const a8 = z8 * opacity;
        const a12 = z12 * opacity;
        if (!isNoaa) {
            return ['interpolate', ['linear'], ['zoom'], 4, a4, 8, a8, 12, a12];
        }
        const fade = ['interpolate', ['linear'], WEIGHT, 0.08, 1, 0.5, 0.55, 1, 0.32];
        return [
            'interpolate', ['linear'], ['zoom'],
            4, ['*', a4, fade],
            8, ['*', a8, fade],
            12, ['*', a12, fade]
        ];
    };

    return [
        {
            id: `svc-lyr-${datasetId}-haze`,
            type: 'circle',
            source: sourceId,
            minzoom: 4,
            paint: {
                'circle-radius': radiusAt(size.haze, frp.haze),
                'circle-color': color,
                'circle-blur': 1,
                'circle-opacity': opacityAt(0.04, 0.06, 0.08),
                'circle-stroke-width': 0
            }
        },
        {
            id: `svc-lyr-${datasetId}-soft`,
            type: 'circle',
            source: sourceId,
            minzoom: 4,
            paint: {
                'circle-radius': radiusAt(size.soft, frp.soft),
                'circle-color': color,
                'circle-blur': 0.75,
                'circle-opacity': opacityAt(0.07, 0.1, 0.12),
                'circle-stroke-width': 0
            }
        },
        {
            id: `svc-lyr-${datasetId}-neon`,
            type: 'circle',
            source: sourceId,
            minzoom: 4,
            paint: {
                'circle-radius': radiusAt(size.neon, frp.neon),
                'circle-color': color,
                'circle-blur': 0.35,
                'circle-opacity': opacityAt(0.14, 0.2, 0.24),
                'circle-stroke-width': 0
            }
        },
        {
            id: `svc-lyr-${datasetId}-core`,
            type: 'circle',
            source: sourceId,
            minzoom: 4,
            paint: {
                'circle-radius': radiusAt(size.core, frp.core),
                'circle-color': color,
                'circle-blur': 0,
                'circle-opacity': opacityAt(0.55, 0.7, 0.8),
                'circle-stroke-width': 0
            }
        }
    ];
}

/**
 * Minimal 2-circle fallback if the full stack fails at addLayer.
 * @param {string} datasetId
 * @param {string} sourceId
 * @param {number} opacity
 * @param {'viirs' | 'modis' | 'noaa'} part
 */
export function buildHotspotFallbackSpecs(datasetId, sourceId, opacity = 1, part = 'viirs') {
    const color = (FIREFLY_PALETTES[part] || FIREFLY_PALETTES.viirs).core;
    return [
        {
            id: `svc-lyr-${datasetId}-soft`,
            type: 'circle',
            source: sourceId,
            minzoom: 4,
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 6, 14, 8],
                'circle-color': color,
                'circle-blur': 0.7,
                'circle-opacity': 0.15 * opacity,
                'circle-stroke-width': 0
            }
        },
        {
            id: `svc-lyr-${datasetId}-core`,
            type: 'circle',
            source: sourceId,
            minzoom: 4,
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 10, 3.5, 14, 4.5],
                'circle-color': color,
                'circle-blur': 0,
                'circle-opacity': 0.75 * opacity,
                'circle-stroke-width': 0
            }
        }
    ];
}

/**
 * @param {string} datasetId
 * @param {string} sourceId
 * @param {number} opacity
 */
export function buildIncidentLayerSpecs(datasetId, sourceId, opacity = 1) {
    const iconId = `svc-lyr-${datasetId}-icon`;
    const labelId = `svc-lyr-${datasetId}-label`;

    return [
        {
            id: iconId,
            type: 'symbol',
            source: sourceId,
            minzoom: 4,
            filter: ['==', ['get', 'hasName'], 1],
            layout: {
                'symbol-placement': 'point',
                'icon-image': WILDFIRE_INCIDENT_ICON_ID,
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-size': INCIDENT_ICON_SIZE
            },
            paint: {
                'icon-opacity': 0.95 * opacity
            }
        },
        {
            id: labelId,
            type: 'symbol',
            source: sourceId,
            minzoom: 8.5,
            filter: ['==', ['get', 'hasName'], 1],
            layout: {
                'text-field': ['get', 'incidentName'],
                'text-font': ['Noto Sans Regular'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 12, 12, 15, 14],
                'text-offset': [0, 0.3],
                'text-anchor': 'top',
                'text-optional': true,
                'text-allow-overlap': false
            },
            paint: {
                'text-color': COLORS.label,
                'text-halo-color': COLORS.labelHalo,
                'text-halo-width': 1.4,
                'text-opacity': 1 * opacity
            }
        }
    ];
}
