/**
 * Value inheritance helpers for plan-production features.
 */

export const INHERITANCE_SOURCES = {
    PROJECT_DEFAULT: 'project_default',
    ASSEMBLY: 'assembly',
    PARENT_FEATURE: 'parent_feature',
    LAST_USED: 'last_used',
    MANUAL_OVERRIDE: 'manual_override'
};

/**
 * @typedef {object} InheritedValue
 * @property {unknown} value
 * @property {string} source
 * @property {string} [sourceLabel]
 * @property {boolean} overridden
 */

/**
 * @param {object} input
 * @returns {InheritedValue}
 */
export function createInheritedValue({
    value,
    source = INHERITANCE_SOURCES.PROJECT_DEFAULT,
    sourceLabel = '',
    overridden = false
}) {
    return { value, source, sourceLabel, overridden: !!overridden };
}

/**
 * Resolve a value using the project hierarchy.
 * Manual override always wins.
 *
 * @param {object} input
 * @returns {InheritedValue}
 */
export function resolveInheritedValue({
    manualOverride,
    parentValue,
    parentLabel = '',
    assemblyValue,
    assemblyLabel = '',
    projectDefault,
    lastUsedValue
}) {
    if (manualOverride !== undefined && manualOverride !== null && manualOverride !== '') {
        return createInheritedValue({
            value: manualOverride,
            source: INHERITANCE_SOURCES.MANUAL_OVERRIDE,
            sourceLabel: 'Manual override',
            overridden: true
        });
    }
    if (parentValue !== undefined && parentValue !== null && parentValue !== '') {
        return createInheritedValue({
            value: parentValue,
            source: INHERITANCE_SOURCES.PARENT_FEATURE,
            sourceLabel: parentLabel || 'Parent feature'
        });
    }
    if (assemblyValue !== undefined && assemblyValue !== null && assemblyValue !== '') {
        return createInheritedValue({
            value: assemblyValue,
            source: INHERITANCE_SOURCES.ASSEMBLY,
            sourceLabel: assemblyLabel || 'Active assembly'
        });
    }
    if (lastUsedValue !== undefined && lastUsedValue !== null && lastUsedValue !== '') {
        return createInheritedValue({
            value: lastUsedValue,
            source: INHERITANCE_SOURCES.LAST_USED,
            sourceLabel: 'Last used'
        });
    }
    return createInheritedValue({
        value: projectDefault,
        source: INHERITANCE_SOURCES.PROJECT_DEFAULT,
        sourceLabel: 'Project default'
    });
}

/**
 * @param {InheritedValue} inherited
 * @returns {string}
 */
export function formatInheritanceHint(inherited) {
    if (!inherited || inherited.overridden) return '';
    if (!inherited.sourceLabel) return '';
    return `Inherited from: ${inherited.sourceLabel}`;
}
