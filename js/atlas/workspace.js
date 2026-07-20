/**
 * Network Atlas workspace mode helpers (shared; no Tauri imports).
 */
import { getState, setUIState } from '../core/state.js';
import bus from '../core/event-bus.js';
import { getPlatformBundle } from '../platform/create-platform.js';
import { hasCapability } from '../platform/contracts.js';

const STORAGE_KEY = 'gis-toolbox-workspace-mode';

/** @typedef {'gis' | 'atlas'} WorkspaceMode */

/**
 * @returns {boolean}
 */
export function isAtlasAvailable() {
    const { platform } = getPlatformBundle();
    return hasCapability(platform, 'localSqlite');
}

/**
 * @returns {WorkspaceMode}
 */
export function getWorkspaceMode() {
    const mode = getState().ui?.workspaceMode;
    return mode === 'atlas' ? 'atlas' : 'gis';
}

/**
 * @param {WorkspaceMode} mode
 * @param {{ force?: boolean }} [opts]
 */
export function setWorkspaceMode(mode, opts = {}) {
    const next = mode === 'atlas' ? 'atlas' : 'gis';
    if (next === 'atlas' && !opts.force && !isAtlasAvailable()) {
        bus.emit('atlas:unavailable', { reason: 'Network Atlas requires the Windows desktop app' });
        return getWorkspaceMode();
    }
    setUIState('workspaceMode', next);
    try {
        localStorage.setItem(STORAGE_KEY, next);
    } catch {
        /* ignore */
    }
    bus.emit('workspace:mode', next);
    return next;
}

/**
 * Restore last mode from localStorage when Atlas is available.
 */
export function restoreWorkspaceMode() {
    if (!isAtlasAvailable()) {
        setUIState('workspaceMode', 'gis');
        return 'gis';
    }
    let saved = 'gis';
    try {
        saved = localStorage.getItem(STORAGE_KEY) || 'gis';
    } catch {
        saved = 'gis';
    }
    const mode = saved === 'atlas' ? 'atlas' : 'gis';
    setUIState('workspaceMode', mode);
    return mode;
}

/**
 * Toggle Atlas ↔ GIS.
 * @returns {WorkspaceMode}
 */
export function toggleAtlasWorkspace() {
    const current = getWorkspaceMode();
    return setWorkspaceMode(current === 'atlas' ? 'gis' : 'atlas');
}
