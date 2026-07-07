import { createDefaultStyle, normalizeStyle } from '../map/style-engine.js';
import { resolveLiveLayer } from './catalog-schema.js';

/** @typedef {import('../map/style-engine.js').ReturnType<typeof createDefaultStyle>} LayerStyle */

export const LIVE_LAYER_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#65a30d'];

/** NOAA satellite fire detections — size and color by FRP (MW). */
export const FIREWATCH_STYLE = {
    mode: 'smart',
    strokeColor: '#ffffff',
    fillColor: '#ef4444',
    strokeWidth: 1,
    strokeOpacity: 0.95,
    fillOpacity: 0.9,
    pointSize: 5,
    pointSymbol: 'circle',
    smart: {
        defaultStyle: {
            strokeColor: '#ffffff',
            fillColor: '#ef4444',
            pointSize: 4
        },
        visualVariables: [
            {
                id: 'frp-color',
                type: 'ramp',
                field: 'FRP',
                min: 0,
                max: 300,
                ramp: 'ylOrRd',
                channel: 'both',
                geometryTarget: 'point'
            },
            {
                id: 'frp-size',
                type: 'size',
                field: 'FRP',
                min: 0,
                max: 300,
                sizeMin: 4,
                sizeMax: 16,
                geometryTarget: 'point'
            }
        ]
    }
};

/**
 * Resolve paint style for a live service layer.
 * Priority: service.style → catalog preset style → default palette color.
 * @param {object} [service]
 * @param {number} [colorIndex]
 * @returns {LayerStyle}
 */
export function resolveServiceLayerStyle(service, colorIndex = 0) {
    const defaultColor = LIVE_LAYER_COLORS[colorIndex % LIVE_LAYER_COLORS.length];
    const raw = service?.style
        ?? (service?.presetId ? resolveLiveLayer(service.presetId)?.style : null);
    return normalizeStyle(raw, defaultColor);
}

/**
 * @param {number | import('maplibre-gl').ExpressionSpecification} value
 * @param {number} opacity
 */
export function scalePaintOpacity(value, opacity) {
    if (typeof value !== 'number') return value;
    return value * opacity;
}
