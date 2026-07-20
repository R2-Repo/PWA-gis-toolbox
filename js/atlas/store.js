/**
 * In-memory Atlas entity cache loaded from DatabaseService.
 * Shared domain code reads from here; persistence goes through platform services.
 */
import bus from '../core/event-bus.js';

/** @type {import('./types.js').AtlasSnapshot} */
const snapshot = {
    loaded: false,
    hubs: [],
    channels: [],
    drops: [],
    devices: [],
    sites: [],
    findings: [],
    pingResults: {},
    selection: null,
    areaResults: null,
    activeSession: null,
    stats: null
};

/**
 * @returns {import('./types.js').AtlasSnapshot}
 */
export function getAtlasSnapshot() {
    return snapshot;
}

/**
 * @param {Partial<import('./types.js').AtlasSnapshot>} patch
 */
export function patchAtlasSnapshot(patch) {
    Object.assign(snapshot, patch);
    bus.emit('atlas:changed', snapshot);
}

/**
 * @param {import('./types.js').AtlasSelection | null} selection
 */
export function setAtlasSelection(selection) {
    snapshot.selection = selection;
    bus.emit('atlas:selection', selection);
}

/**
 * @param {string} ip
 * @param {import('./types.js').PingStatusEntry} entry
 */
export function setPingStatus(ip, entry) {
    snapshot.pingResults = { ...snapshot.pingResults, [ip]: entry };
    bus.emit('atlas:ping', { ip, entry, pingResults: snapshot.pingResults });
}

/**
 * @param {Record<string, import('./types.js').PingStatusEntry>} map
 */
export function setPingStatuses(map) {
    snapshot.pingResults = { ...snapshot.pingResults, ...map };
    bus.emit('atlas:ping', { pingResults: snapshot.pingResults });
}

export function clearPingStatuses() {
    snapshot.pingResults = {};
    bus.emit('atlas:ping', { pingResults: snapshot.pingResults });
}

/**
 * Reset cache (e.g. before reload).
 */
export function resetAtlasSnapshot() {
    snapshot.loaded = false;
    snapshot.hubs = [];
    snapshot.channels = [];
    snapshot.drops = [];
    snapshot.devices = [];
    snapshot.sites = [];
    snapshot.findings = [];
    snapshot.pingResults = {};
    snapshot.selection = null;
    snapshot.areaResults = null;
    snapshot.activeSession = null;
    snapshot.stats = null;
    bus.emit('atlas:changed', snapshot);
}
