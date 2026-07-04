/**
 * Capture live map layer styles and bake per-feature symbology for presentation scenes.
 */
import { geometryKindFromFeature } from '../export/style-baker.js';
import { normalizeStyle, resolveFeatureStyle, compilePaint } from '../map/style-engine.js';
import { DEFAULT_PRESENTATION_STYLE } from './presentation-scene-schema.js';

/**
 * @param {object|null} mapService
 * @param {string} [layerId]
 */
export function resolveLayerStyle(mapService, layerId) {
    if (!mapService || !layerId) return null;
    const stored = mapService.getLayerStyle(layerId);
    const defaultColor = mapService.getLayerDefaultColor?.(layerId) || '#2563eb';
    return normalizeStyle(stored, defaultColor);
}

/**
 * @param {object} feature
 * @param {object|null} layerStyle
 * @returns {Record<string, string|number>|null}
 */
export function bakePresentationFeatureStyle(feature, layerStyle) {
    if (!layerStyle || !feature?.geometry) return null;
    const kind = geometryKindFromFeature(feature.geometry);
    const s = resolveFeatureStyle(layerStyle, feature, kind);
    return {
        s: s.strokeColor,
        f: s.fillColor,
        sw: s.strokeWidth,
        so: s.strokeOpacity,
        fo: s.fillOpacity,
        r: s.pointSize
    };
}

/**
 * @param {import('geojson').FeatureCollection} features
 * @param {object|null} layerStyle
 * @returns {import('geojson').FeatureCollection}
 */
export function applyPresentationStyles(features, layerStyle) {
    const list = features?.features || [];
    return {
        type: 'FeatureCollection',
        features: list.map((feature) => {
            const baked = bakePresentationFeatureStyle(feature, layerStyle);
            if (!baked) {
                return JSON.parse(JSON.stringify(feature));
            }
            return {
                ...feature,
                properties: { ...(feature.properties || {}), _ps: baked }
            };
        })
    };
}

/**
 * Bake styles using each feature's source layer tag (_plLayer).
 * @param {import('geojson').FeatureCollection} features
 * @param {object|null} mapService
 * @param {string} [layerIdProperty]
 */
export function applyPresentationStylesPerLayer(features, mapService, layerIdProperty = '_plLayer') {
    const styleCache = new Map();
    const resolveCached = (layerId) => {
        if (!layerId) return null;
        if (!styleCache.has(layerId)) {
            styleCache.set(layerId, resolveLayerStyle(mapService, layerId));
        }
        return styleCache.get(layerId);
    };

    return {
        type: 'FeatureCollection',
        features: (features?.features || []).map((feature) => {
            const props = feature?.properties || {};
            const layerId = props[layerIdProperty];
            const layerStyle = resolveCached(layerId);
            const baked = bakePresentationFeatureStyle(feature, layerStyle);
            const { [layerIdProperty]: _layerTag, ...cleanProps } = props;

            if (!baked) {
                return JSON.parse(JSON.stringify({ ...feature, properties: cleanProps }));
            }

            return {
                ...feature,
                properties: { ...cleanProps, _ps: baked }
            };
        })
    };
}

/**
 * @param {import('geojson').FeatureCollection} features
 */
export function hasBakedPresentationStyles(features) {
    return (features?.features || []).some((feature) => feature?.properties?._ps);
}

/**
 * @param {object|null} layerStyle
 * @param {import('geojson').FeatureCollection} features
 * @returns {import('./presentation-scene-schema.js').PresentationStyle}
 */
export function deriveSceneStyleFallback(layerStyle, features) {
    const firstBaked = (features?.features || []).find((f) => f?.properties?._ps)?.properties?._ps;
    if (firstBaked) {
        return {
            featureStylePreset: 'default',
            lineColor: firstBaked.s || firstBaked.f || DEFAULT_PRESENTATION_STYLE.lineColor,
            lineWidth: firstBaked.sw ?? DEFAULT_PRESENTATION_STYLE.lineWidth,
            pointRadius: firstBaked.r ?? DEFAULT_PRESENTATION_STYLE.pointRadius,
            polygonOpacity: firstBaked.fo ?? DEFAULT_PRESENTATION_STYLE.polygonOpacity
        };
    }

    if (layerStyle) {
        const line = compilePaint(layerStyle, 'line');
        const point = compilePaint(layerStyle, 'point');
        const polygon = compilePaint(layerStyle, 'polygon');
        return {
            featureStylePreset: 'default',
            lineColor: line.strokeColor || polygon.strokeColor || DEFAULT_PRESENTATION_STYLE.lineColor,
            lineWidth: line.strokeWidth ?? DEFAULT_PRESENTATION_STYLE.lineWidth,
            pointRadius: point.pointSize ?? DEFAULT_PRESENTATION_STYLE.pointRadius,
            polygonOpacity: polygon.fillOpacity ?? DEFAULT_PRESENTATION_STYLE.polygonOpacity
        };
    }

    return { ...DEFAULT_PRESENTATION_STYLE };
}
