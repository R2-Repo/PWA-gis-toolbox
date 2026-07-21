/**
 * Bake smart styling rules into portable per-feature symbology (Simplestyle / KML props).
 */
import { resolveFeatureStyle, isSmartStyleActive } from '../map/style-engine.js';
import { resolveStyle as resolveUdotFiberFeatureStyle } from '../symbology/udot-fiber/resolve-style.js';

/**
 * @param {object|null} geometry
 * @returns {'point'|'line'|'polygon'}
 */
export function geometryKindFromFeature(geometry) {
    const t = geometry?.type;
    if (t === 'Point' || t === 'MultiPoint') return 'point';
    if (t === 'LineString' || t === 'MultiLineString') return 'line';
    return 'polygon';
}

/**
 * Simplestyle-spec properties for GeoJSON export.
 * @param {object} feature
 * @param {object|null} layerStyle
 * @returns {Record<string, string|number>|null}
 */
export function bakeFeatureSimpleStyle(feature, layerStyle) {
    if (!layerStyle || !isSmartStyleActive(layerStyle)) return null;
    const kind = geometryKindFromFeature(feature.geometry);
    const s = resolveFeatureStyle(layerStyle, feature, kind);

    // Prefer Bentley/ArcGIS resolved color when style pack metadata is present
    const udotKey = layerStyle?._udotFiber?.layerKey;
    if (udotKey) {
        const udot = resolveUdotFiberFeatureStyle(udotKey, feature?.properties || {});
        if (udot?.color) {
            s.strokeColor = udot.color;
            s.fillColor = udot.color;
            if (udot.width && kind === 'line') s.strokeWidth = udot.width;
        }
    }

    const props = {
        stroke: s.strokeColor,
        'stroke-width': s.strokeWidth,
        'stroke-opacity': s.strokeOpacity,
        fill: s.fillColor,
        'fill-opacity': s.fillOpacity
    };
    if (kind === 'point') {
        props['marker-color'] = s.fillColor;
        props['marker-size'] = s.pointSize <= 8 ? 'small' : s.pointSize <= 12 ? 'medium' : 'large';
    }
    return props;
}

/**
 * Flat style object for KML Style element generation.
 * @param {object} feature
 * @param {object|null} layerStyle
 * @returns {object|null}
 */
export function bakeFeatureKmlStyle(feature, layerStyle) {
    if (!layerStyle || !isSmartStyleActive(layerStyle)) return null;
    const kind = geometryKindFromFeature(feature.geometry);
    const s = resolveFeatureStyle(layerStyle, feature, kind);
    return {
        strokeColor: s.strokeColor,
        fillColor: s.fillColor,
        strokeWidth: s.strokeWidth,
        strokeOpacity: s.strokeOpacity,
        fillOpacity: s.fillOpacity,
        pointSize: s.pointSize
    };
}

/**
 * Stable key for grouping identical baked styles in KML export.
 * @param {object} flatStyle
 */
export function styleHash(flatStyle) {
    return [
        flatStyle.strokeColor,
        flatStyle.fillColor,
        flatStyle.strokeWidth,
        flatStyle.strokeOpacity,
        flatStyle.fillOpacity,
        flatStyle.pointSize
    ].join('|');
}

/**
 * Apply baked simplestyle to a feature copy.
 * @param {object} feature
 * @param {object|null} layerStyle
 */
export function withBakedSimpleStyle(feature, layerStyle) {
    const baked = bakeFeatureSimpleStyle(feature, layerStyle);
    if (!baked) return feature;
    return {
        ...feature,
        properties: { ...(feature.properties || {}), ...baked }
    };
}
