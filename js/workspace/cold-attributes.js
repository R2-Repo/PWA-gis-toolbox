/**
 * Pure helpers for hot/cold attribute splits (master plan §10).
 * Hot = map/identify/edit working set; cold = detach-for-export sidecar.
 */

import { isInternalFeatureProp } from './feature-identity.js';

/**
 * Split properties into hot vs cold by field name list.
 * @param {object} properties
 * @param {string[]|Set<string>} coldFieldNames
 * @returns {{ hot: object, cold: object }}
 */
export function splitHotColdProperties(properties = {}, coldFieldNames = []) {
    const coldSet = coldFieldNames instanceof Set
        ? coldFieldNames
        : new Set(coldFieldNames || []);
    const hot = {};
    const cold = {};
    for (const [key, value] of Object.entries(properties || {})) {
        if (isInternalFeatureProp(key)) continue;
        if (coldSet.has(key)) cold[key] = value;
        else hot[key] = value;
    }
    return { hot, cold };
}

/**
 * Join cold under hot (hot wins on key conflicts).
 * @param {object|null|undefined} hot
 * @param {object|null|undefined} cold
 * @returns {object}
 */
export function joinHotColdProperties(hot, cold) {
    if (!cold || !Object.keys(cold).length) return { ...(hot || {}) };
    return { ...cold, ...(hot || {}) };
}

/**
 * Move named fields from hot into cold (mutates neither input).
 * @param {object} hotProperties
 * @param {object} coldProperties
 * @param {string[]} fieldNames
 * @returns {{ hot: object, cold: object, moved: string[] }}
 */
export function detachFieldsFromHot(hotProperties = {}, coldProperties = {}, fieldNames = []) {
    const hot = { ...hotProperties };
    const cold = { ...coldProperties };
    const moved = [];
    for (const name of fieldNames) {
        if (!name || isInternalFeatureProp(name)) continue;
        if (!Object.prototype.hasOwnProperty.call(hot, name)) continue;
        cold[name] = hot[name];
        delete hot[name];
        moved.push(name);
    }
    return { hot, cold, moved };
}

/**
 * @param {string[]} existing
 * @param {string[]} added
 * @returns {string[]}
 */
export function mergeColdFieldNames(existing = [], added = []) {
    const out = new Set(existing || []);
    for (const name of added || []) {
        if (name && !isInternalFeatureProp(name)) out.add(name);
    }
    return [...out];
}

export default {
    splitHotColdProperties,
    joinHotColdProperties,
    detachFieldsFromHot,
    mergeColdFieldNames
};
