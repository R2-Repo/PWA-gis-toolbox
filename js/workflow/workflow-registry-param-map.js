/**
 * Maps shared tool-registry param names to workflow canvas node config keys and units.
 * Registry contract uses SI-ish units; canvas configs keep legacy names/units until a later job.
 */

/** @typedef {{ configKey: string, registryUnit?: string, canvasUnit?: string }} RegistryParamMapEntry */

/** @type {Record<string, Record<string, RegistryParamMapEntry>>} nodeId -> paramName -> mapping */
export const REGISTRY_PARAM_TO_CANVAS = {
    buffer: {
        distance: { configKey: 'distance', registryUnit: 'm', canvasUnit: 'feet' },
        units: { configKey: 'units' }
    },
    'line-offset': {
        distance: { configKey: 'distance', registryUnit: 'm', canvasUnit: 'feet' },
        units: { configKey: 'units' }
    },
    simplify: {
        tolerance: { configKey: 'tolerance', registryUnit: 'deg', canvasUnit: 'deg' }
    },
    dissolve: {
        field: { configKey: 'field' }
    },
    sample: {
        num: { configKey: 'num' }
    },
    reproject: {
        fromCrs: { configKey: 'fromCrs' },
        toCrs: { configKey: 'toCrs' }
    },
    'spatial-join': {
        joinFields: { configKey: 'joinFields' },
        prefix: { configKey: 'prefix' }
    }
};

/**
 * Registry node params intentionally not mapped to canvas config yet (none today).
 * @type {Record<string, string[]>}
 */
export const REGISTRY_PARAMS_EXPLICITLY_UNMAPPED = {};

/**
 * @param {string} nodeId
 * @param {string} paramName
 * @returns {RegistryParamMapEntry | undefined}
 */
export function getCanvasParamMapping(nodeId, paramName) {
    return REGISTRY_PARAM_TO_CANVAS[nodeId]?.[paramName];
}
