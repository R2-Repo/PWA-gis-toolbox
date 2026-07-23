import { UGRC_KEY_STORAGE_KEY } from './config.js';

/**
 * @returns {string}
 */
export function getUserUgrcApiKey() {
    try {
        if (typeof localStorage === 'undefined') return '';
        return String(localStorage.getItem(UGRC_KEY_STORAGE_KEY) || '').trim();
    } catch {
        return '';
    }
}

/**
 * @param {string} key
 */
export function setUserUgrcApiKey(key) {
    const value = String(key || '').trim();
    if (typeof localStorage === 'undefined') return;
    if (!value) {
        localStorage.removeItem(UGRC_KEY_STORAGE_KEY);
        return;
    }
    localStorage.setItem(UGRC_KEY_STORAGE_KEY, value);
}

export function clearUserUgrcApiKey() {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(UGRC_KEY_STORAGE_KEY);
    } catch {
        // Ignore storage failures.
    }
}

/**
 * App-owned browser key injected at build time (PWA).
 * @returns {string}
 */
export function getEnvUgrcApiKey() {
    try {
        return String(import.meta.env?.VITE_UGRC_API_KEY || '').trim();
    } catch {
        return '';
    }
}

/**
 * Resolver order: user override → build-time env key.
 * @returns {string}
 */
export function resolveUgrcApiKey() {
    return getUserUgrcApiKey() || getEnvUgrcApiKey() || '';
}

/**
 * @returns {boolean}
 */
export function hasResolvedUgrcApiKey() {
    return Boolean(resolveUgrcApiKey());
}
