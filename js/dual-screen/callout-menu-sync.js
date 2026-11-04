/**
 * Send the open plan-set callout session to the pop-out context menu.
 * The pop-out is another window, so it does not see the main window's menu context.
 */
import bus from '../core/event-bus.js';
import { showToast } from '../ui/toast.js';
import { serializeCalloutSession } from '../widgets/plan-set-callouts/engine.js';
import dualScreenCoordinator from './coordinator.js';

let bound = false;

function plainClone(value) {
    if (value == null) return null;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

/**
 * @param {object | null} session
 * @param {object[]} [insetViews]
 */
export function publishCalloutSession(session, insetViews = []) {
    if (!dualScreenCoordinator.isActive) return;
    if (!session) {
        dualScreenCoordinator.broadcastCalloutSession({ live: false });
        return;
    }
    let bundle = null;
    try {
        bundle = plainClone(serializeCalloutSession(session));
    } catch {
        bundle = null;
    }
    if (!bundle) return;
    dualScreenCoordinator.broadcastCalloutSession({
        live: true,
        bundle,
        insetViews: plainClone(insetViews) || []
    });
}

/** Republish after the pop-out finishes its handshake. */
export function bindCalloutMenuSync() {
    if (bound) return;
    bound = true;
    bus.on('dual-screen:secondary-ready', () => {
        void import('../widgets/plan-set-callouts/runtime.js').then((runtime) => {
            const session = runtime.getCalloutRuntime()?.session || null;
            if (!session) {
                publishCalloutSession(null);
                return;
            }
            publishCalloutSession(session, runtime.getLinkedInsetViews?.() || []);
        }).catch(() => {});
    });
}

/**
 * Pop-out context-menu command, applied on the main-window callout session.
 * @param {object} payload
 * @returns {Promise<boolean>}
 */
export async function applyPopoutCalloutCommand(payload) {
    const runtime = await import('../widgets/plan-set-callouts/runtime.js');
    if (!runtime.getCalloutRuntime()) return false;
    const api = runtime.calloutRuntimeApi;
    const op = payload?.op;
    try {
        if (op === 'removeLeader') {
            api.setLeaderEnabled(payload.leaderKey, false);
            showToast('Callout turned off', 'success');
            return true;
        }
        if (op === 'addNote') {
            if (!payload.text) return false;
            api.addNote(payload.leaderKey, payload.text);
            showToast('Note added', 'success');
            return true;
        }
        if (op === 'addLeader') {
            if (!payload.input) return false;
            api.addLeader(payload.input);
            showToast('Callout turned on', 'success');
            return true;
        }
        if (op === 'setLeaders') {
            api.setLeadersEnabledForFeatures(
                payload.features || [],
                payload.enabled === true,
                payload.options || {}
            );
            return true;
        }
    } catch (err) {
        showToast(err?.message || 'Could not update callout', 'warning');
    }
    return false;
}
