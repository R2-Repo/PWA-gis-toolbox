/**
 * Shared GIS tool / widget / workflow node registry (v1).
 */
import bus from '../core/event-bus.js';

export const TOOL_RESULT_EVENT = 'result:produced';

/** @typedef {'tool' | 'widget' | 'node'} ToolKind */
/** @typedef {'ga' | 'beta' | 'hidden'} ToolStatus */
/** @typedef {{ name: string, type: 'layer' | 'table', geometry?: string[], required?: boolean }} ToolPortDef */
/** @typedef {{ name: string, type: string, unit?: string, default?: *, min?: number, max?: number, of?: string }} ToolParamDef */
/**
 * @typedef {object} ToolRegistryContext
 * @property {AbortSignal} [signal]
 * @property {(fraction: number, msg?: string) => void} [progress]
 */

/**
 * @typedef {object} ToolRegistryEntry
 * @property {string} id
 * @property {string[]} [aliases]
 * @property {ToolKind[]} kind
 * @property {string} label
 * @property {string} [icon]
 * @property {string} [tip]
 * @property {string} [category]
 * @property {ToolStatus} status
 * @property {number} version
 * @property {string[]} [capabilities]
 * @property {Record<string, boolean>} [surfaces]
 * @property {ToolPortDef[]} [inputs]
 * @property {ToolPortDef[]} [outputs]
 * @property {ToolParamDef[]} [params]
 * @property {boolean} [workerSafe]
 * @property {(inputs: object, params: object, ctx: ToolRegistryContext) => Promise<{ layers: object[], stats: object }>} [run]
 * @property {(widgetCtx: object) => void} [open]
 * @property {string} [mapAction]
 * @property {(config: object, fromVersion: number) => object} [migrate]
 */

/** @type {Map<string, ToolRegistryEntry>} */
const byId = new Map();
/** @type {Map<string, string>} alias -> canonical id */
const aliasToId = new Map();

function freezeEntry(entry) {
    return Object.freeze({ ...entry, aliases: entry.aliases ? Object.freeze([...entry.aliases]) : undefined });
}

/**
 * @param {ToolRegistryEntry} entry
 */
export function registerTool(entry) {
    if (!entry?.id) throw new Error('registerTool: id required');
    if (!Number.isInteger(entry.version)) throw new Error(`registerTool(${entry.id}): version must be an integer`);
    if (!entry.kind?.length) throw new Error(`registerTool(${entry.id}): kind required`);
    if (!entry.status) throw new Error(`registerTool(${entry.id}): status required`);
    if (byId.has(entry.id)) throw new Error(`registerTool: duplicate id "${entry.id}"`);
    for (const alias of entry.aliases || []) {
        if (aliasToId.has(alias) || byId.has(alias)) {
            throw new Error(`registerTool(${entry.id}): alias collision "${alias}"`);
        }
        aliasToId.set(alias, entry.id);
    }
    byId.set(entry.id, freezeEntry(entry));
}

/**
 * Merge metadata onto an existing entry (e.g. attach widget open handler to a node entry).
 * @param {string} id
 * @param {Partial<ToolRegistryEntry>} patch
 */
export function augmentTool(id, patch) {
    const existing = byId.get(id);
    if (!existing) throw new Error(`augmentTool: unknown id "${id}"`);
    const kind = patch.kind ? [...new Set([...existing.kind, ...patch.kind])] : existing.kind;
    byId.set(
        id,
        freezeEntry({
            ...existing,
            ...patch,
            kind
        })
    );
}

/**
 * @param {string} idOrAlias
 * @returns {ToolRegistryEntry | undefined}
 */
export function getTool(idOrAlias) {
    if (!idOrAlias) return undefined;
    const canonical = aliasToId.get(idOrAlias) || idOrAlias;
    return byId.get(canonical);
}

/**
 * @param {{ kind?: ToolKind, status?: ToolStatus, capability?: string }} [filter]
 * @returns {ToolRegistryEntry[]}
 */
export function listTools(filter = {}) {
    let entries = [...byId.values()];
    if (filter.kind) {
        entries = entries.filter((e) => e.kind.includes(filter.kind));
    }
    if (filter.status) {
        entries = entries.filter((e) => e.status === filter.status);
    }
    if (filter.capability) {
        entries = entries.filter((e) => (e.capabilities || []).includes(filter.capability));
    }
    return entries;
}

/**
 * @param {ToolRegistryEntry | undefined} entry
 * @param {'mapPanel' | 'contextMenu' | 'palette' | 'widgetPanel'} surface
 * @param {{ v1Mode?: boolean }} [opts]
 * @returns {boolean}
 */
export function isVisible(entry, surface, opts = {}) {
    if (!entry) return false;
    const v1Mode = opts.v1Mode !== false;
    if (entry.surfaces && Object.prototype.hasOwnProperty.call(entry.surfaces, surface)) {
        return entry.surfaces[surface] === true;
    }

    if (surface === 'widgetPanel') {
        if (!entry.kind.includes('widget')) return false;
        return entry.status === 'ga' || entry.status === 'beta';
    }

    if (surface === 'palette') {
        if (!entry.kind.includes('node')) return false;
        if (!v1Mode) return true;
        return entry.status === 'ga';
    }

    if (surface === 'mapPanel' || surface === 'contextMenu') {
        if (!entry.kind.includes('tool')) return false;
        if (!v1Mode) return true;
        return entry.status === 'ga';
    }

    return entry.status !== 'hidden';
}

/**
 * @param {(payload: { id: string, layerIds?: string[], stats?: object }) => void} cb
 * @returns {() => void}
 */
export function onToolResult(cb) {
    return bus.on(TOOL_RESULT_EVENT, cb);
}

/**
 * @param {{ id: string, layerIds?: string[], stats?: object }} payload
 */
export function emitToolResult(payload) {
    bus.emit(TOOL_RESULT_EVENT, payload);
}

/**
 * @returns {{ ids: string[], aliases: [string, string][] }}
 */
export function getRegistryIndexSnapshot() {
    return {
        ids: [...byId.keys()].sort(),
        aliases: [...aliasToId.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    };
}
