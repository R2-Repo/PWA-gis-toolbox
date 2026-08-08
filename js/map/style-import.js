/**
 * Detect embedded simplestyle symbology and convert to smart style rules.
 */
import { getCategoricalColors } from './color-ramps.js';
import { createDefaultStyle, normalizeStyle } from './style-engine.js';

const SIMPLE_KEYS = ['stroke', 'fill', 'marker-color'];

/**
 * @param {object[]} features
 * @returns {{ hasSimpleStyle: boolean, varyingProperty: string|null, distinctCount: number }|null}
 */
export function detectEmbeddedSimpleStyle(features) {
    if (!features?.length) return null;

    for (const key of SIMPLE_KEYS) {
        const values = new Set();
        let count = 0;
        for (const f of features) {
            const v = f.properties?.[key];
            if (v == null || v === '') continue;
            count++;
            values.add(String(v));
        }
        if (count > 0 && values.size > 1) {
            return { hasSimpleStyle: true, varyingProperty: key, distinctCount: values.size };
        }
    }
    return { hasSimpleStyle: false, varyingProperty: null, distinctCount: 0 };
}

/**
 * @param {object[]} features
 * @param {string} property
 * @param {string} [defaultColor]
 * @param {object|null} [existingStyle] optional current layer style (preserves labels)
 */
export function convertSimpleStyleToSmart(features, property = 'stroke', defaultColor = '#2563eb', existingStyle = null) {
    const counts = new Map();
    for (const f of features) {
        const v = f.properties?.[property];
        if (v == null || v === '') continue;
        const key = String(v);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const sorted = [...counts.keys()];
    const colors = getCategoricalColors(sorted.length);
    const classes = sorted.map((value, i) => ({
        value,
        label: value,
        color: value.startsWith('#') ? value : colors[i],
        style: {}
    }));

    const style = normalizeStyle(createDefaultStyle(defaultColor));
    style.mode = 'smart';
    style.smart = {
        defaultStyle: { ...style },
        visualVariables: [{
            id: `vv-import-${Date.now()}`,
            type: 'unique',
            field: property,
            channel: property === 'stroke' ? 'stroke' : 'fill',
            classes,
            defaultColor: '#94a3b8'
        }],
        filterRules: []
    };
    if (existingStyle?.labels) {
        style.labels = { ...existingStyle.labels };
    }
    return style;
}

/**
 * @param {object} layer
 * @param {string} defaultColor
 * @param {object|null} [existingStyle]
 */
export function convertLayerSimpleStyleToSmart(layer, defaultColor = '#2563eb', existingStyle = null) {
    const detection = detectEmbeddedSimpleStyle(layer.geojson?.features || []);
    if (!detection?.hasSimpleStyle || !detection.varyingProperty) return null;
    return convertSimpleStyleToSmart(
        layer.geojson.features,
        detection.varyingProperty,
        defaultColor,
        existingStyle
    );
}
