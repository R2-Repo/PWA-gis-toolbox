/**
 * Shared symbology registry for plan-production features.
 * Features store symbolKey values; MapLibre expressions resolve display styles.
 */

/** @type {Record<string, object>} */
export const SYMBOL_REGISTRY = {
    'conduit-proposed': {
        kind: 'line',
        color: '#2563eb',
        width: 3,
        dash: [],
        casing: { color: '#ffffff', width: 5 },
        displayOffset: 0,
        labelTemplate: '{ductCount} × {diameter} {productType} – {installationMethod}'
    },
    'conduit-existing': {
        kind: 'line',
        color: '#6b7280',
        width: 2,
        dash: [4, 2],
        casing: null,
        displayOffset: 0,
        labelTemplate: 'Existing {diameter} {productType}'
    },
    'fiber-proposed': {
        kind: 'line',
        color: '#f59e0b',
        width: 2,
        dash: [2, 1],
        casing: { color: '#1f2937', width: 4 },
        displayOffset: 4,
        labelTemplate: '{strandCount}F {cableType}'
    },
    'alignment-guide': {
        kind: 'line',
        color: '#94a3b8',
        width: 2,
        dash: [6, 4],
        casing: null,
        displayOffset: 0,
        labelTemplate: '{routeName}'
    },
    'structure-junction-box': {
        kind: 'point',
        icon: 'junction-box',
        size: 1,
        labelTemplate: '{assetType} – {size}'
    },
    'structure-vault': {
        kind: 'point',
        icon: 'vault',
        size: 1.1,
        labelTemplate: '{assetType} – {size}'
    },
    'structure-splice': {
        kind: 'point',
        icon: 'splice-enclosure',
        size: 1,
        labelTemplate: '{enclosureType}'
    },
    'callout-triangle': {
        kind: 'callout',
        shape: 'triangle',
        fill: '#ffffff',
        outline: '#111827'
    },
    'callout-square': {
        kind: 'callout',
        shape: 'square',
        fill: '#ffffff',
        outline: '#111827'
    },
    'callout-octagon': {
        kind: 'callout',
        shape: 'octagon',
        fill: '#ffffff',
        outline: '#111827'
    }
};

/**
 * @param {string} symbolKey
 * @returns {object|null}
 */
export function getSymbolDefinition(symbolKey) {
    return SYMBOL_REGISTRY[symbolKey] || null;
}

/**
 * @param {string} template
 * @param {Record<string, unknown>} attributes
 * @returns {string}
 */
export function renderLabelTemplate(template, attributes = {}) {
    if (!template) return '';
    return template.replace(/\{([^}]+)\}/g, (_, key) => {
        const value = attributes[key.trim()];
        if (value == null || value === '') return '';
        return String(value);
    }).replace(/\s+/g, ' ').replace(/\s+–\s*$/g, '').trim();
}

/**
 * @param {string} symbolKey
 * @param {Record<string, unknown>} attributes
 * @returns {string}
 */
export function buildFeatureLabel(symbolKey, attributes = {}) {
    const def = getSymbolDefinition(symbolKey);
    if (!def?.labelTemplate) return '';
    return renderLabelTemplate(def.labelTemplate, attributes);
}
