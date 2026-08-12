/**
 * Global app activity (busy) bus — refcounted, delayed header indicator.
 * Auto-wires TaskRunner + workflow runs; suppresses when a progress modal is open.
 */
import bus from '../core/event-bus.js';
import { yieldToUI } from '../core/task-runner.js';
import { subscribeModalEvents } from './modals.js';

const SHOW_DELAY_MS = 1000;
const MIN_VISIBLE_MS = 250;

let _refcount = 0;
let _label = '';
let _tokenSeq = 0;
/** @type {Map<number, string>} */
const _activeLabels = new Map();
/** @type {Set<(state: AppActivityState) => void>} */
const _subscribers = new Set();

let _showTimer = null;
let _hideTimer = null;
let _visible = false;
let _visibleSince = 0;
let _progressModalCount = 0;
let _wired = false;

/** @typedef {{ busy: boolean, visible: boolean, label: string, suppressed: boolean }} AppActivityState */

function _currentLabel() {
    if (_activeLabels.size === 0) return '';
    // Prefer the most recently begun label
    let last = '';
    for (const label of _activeLabels.values()) last = label || last;
    return last || 'Working…';
}

function _snapshot() {
    const busy = _refcount > 0;
    const suppressed = _progressModalCount > 0;
    return {
        busy,
        visible: _visible && !suppressed,
        label: _label || 'Working…',
        suppressed
    };
}

function _notify() {
    const state = _snapshot();
    _subscribers.forEach((fn) => {
        try { fn(state); } catch { /* keep activity delivery resilient */ }
    });
}

function _clearShowTimer() {
    if (_showTimer != null) {
        clearTimeout(_showTimer);
        _showTimer = null;
    }
}

function _clearHideTimer() {
    if (_hideTimer != null) {
        clearTimeout(_hideTimer);
        _hideTimer = null;
    }
}

function _scheduleShow() {
    _clearHideTimer();
    if (_visible || _showTimer != null) return;
    _showTimer = setTimeout(() => {
        _showTimer = null;
        if (_refcount <= 0) return;
        _visible = true;
        _visibleSince = Date.now();
        _label = _currentLabel();
        _notify();
    }, SHOW_DELAY_MS);
}

function _scheduleHide() {
    _clearShowTimer();
    if (!_visible) {
        _label = '';
        _notify();
        return;
    }
    const elapsed = Date.now() - _visibleSince;
    const remain = Math.max(0, MIN_VISIBLE_MS - elapsed);
    _clearHideTimer();
    _hideTimer = setTimeout(() => {
        _hideTimer = null;
        if (_refcount > 0) return;
        _visible = false;
        _visibleSince = 0;
        _label = '';
        _notify();
    }, remain);
}

/**
 * @param {string} [label]
 * @returns {number} token for endActivity
 */
export function beginActivity(label = 'Working…') {
    ensureAppActivityWired();
    const token = ++_tokenSeq;
    _refcount += 1;
    _activeLabels.set(token, label || 'Working…');
    _label = _currentLabel();
    if (_refcount === 1) {
        _scheduleShow();
    } else if (_visible) {
        _notify();
    }
    return token;
}

/**
 * @param {number} token
 */
export function endActivity(token) {
    if (!_activeLabels.has(token)) return;
    _activeLabels.delete(token);
    _refcount = Math.max(0, _refcount - 1);
    _label = _currentLabel();
    if (_refcount === 0) {
        _scheduleHide();
    } else if (_visible) {
        _notify();
    }
}

/**
 * @param {string} label
 * @param {() => (any|Promise<any>)} fn
 */
export async function withActivity(label, fn) {
    const token = beginActivity(label);
    try {
        await yieldToUI();
        return await fn();
    } finally {
        endActivity(token);
    }
}

/**
 * @param {(state: AppActivityState) => void} listener
 * @returns {() => void}
 */
export function subscribeAppActivity(listener) {
    if (typeof listener !== 'function') {
        throw new Error('subscribeAppActivity requires a listener function');
    }
    ensureAppActivityWired();
    _subscribers.add(listener);
    try { listener(_snapshot()); } catch { /* ignore */ }
    return () => _subscribers.delete(listener);
}

export function getAppActivityState() {
    return _snapshot();
}

/** @type {Map<string, number>} task id → activity token */
const _taskTokens = new Map();
let _workflowToken = null;

function _onTaskStart(data) {
    const id = data?.id;
    if (id == null || _taskTokens.has(id)) return;
    const name = data?.name ? String(data.name) : 'Working…';
    _taskTokens.set(id, beginActivity(name));
}

function _onTaskEnd(data) {
    const id = data?.id;
    const token = _taskTokens.get(id);
    if (token == null) return;
    _taskTokens.delete(id);
    endActivity(token);
}

function _onWorkflowStart() {
    if (_workflowToken != null) return;
    _workflowToken = beginActivity('Running pipeline…');
}

function _onWorkflowDone() {
    if (_workflowToken == null) return;
    const token = _workflowToken;
    _workflowToken = null;
    endActivity(token);
}

function _onModalEvent(event) {
    if (!event || !event.type) return;
    if (event.type === 'showProgress') {
        _progressModalCount += 1;
        _notify();
        return;
    }
    if (event.type === 'removeProgress') {
        _progressModalCount = Math.max(0, _progressModalCount - 1);
        _notify();
    }
}

/**
 * Wire bus + modal listeners once (safe to call repeatedly).
 */
export function ensureAppActivityWired() {
    if (_wired) return;
    _wired = true;
    bus.on('task:start', _onTaskStart);
    bus.on('task:end', _onTaskEnd);
    bus.on('workflow:run-start', _onWorkflowStart);
    bus.on('workflow:run-done', _onWorkflowDone);
    subscribeModalEvents(_onModalEvent);
}

// Eager wire when the module is imported (App mounts ActivityIndicator).
ensureAppActivityWired();

export default {
    beginActivity,
    endActivity,
    withActivity,
    subscribeAppActivity,
    getAppActivityState,
    ensureAppActivityWired
};
