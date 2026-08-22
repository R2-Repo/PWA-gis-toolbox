/**
 * Persistent Plan Set Callouts runtime.
 * Map preview, drag, and right-click actions stay live after Done/close.
 */

import { markWidgetClosed, upsertWidgetState, getWidgetEntry } from '../widget-state-store.js';
import {
    WIDGET_ID,
    serializeCalloutSession,
    restoreCalloutSession
} from './engine.js';
import {
    addNoteToLeader,
    createFiberCalloutSession,
    enableOrAddLeader,
    generateFiberCallouts,
    isFiberCalloutSession,
    moveLeaderBubble,
    restoreSheetSessionFromStore,
    selectCalloutSheet,
    setLeaderEnabled,
    updateFiberCalloutProject
} from './fiber-callout-engine.js';
import { setPlanSetCalloutMenuContext } from './context-menu-bridge.js';
import {
    hideCalloutPreviewForCapture,
    installCalloutDrag,
    showCalloutPreview,
    uninstallCalloutDrag
} from './preview.js';

/** @type {null | {
 *   ctx: object,
 *   session: object,
 *   dialogOpen: boolean,
 *   onSession: ((session: object) => void)|null
 * }} */
let runtime = null;

function persist(session, open) {
    upsertWidgetState(WIDGET_ID, {
        open: open ?? (runtime?.dialogOpen === true),
        state: serializeCalloutSession(session)
    });
}

function applySession(session, { persistOpen } = {}) {
    if (!runtime) return session;
    runtime.session = session;
    persist(session, persistOpen);
    showCalloutPreview(runtime.ctx.mapService, session);
    wireMenu();
    wireDrag();
    runtime.onSession?.(session);
    return session;
}

function wireMenu() {
    if (!runtime) return;
    setPlanSetCalloutMenuContext({
        isActive: () => Boolean(runtime),
        isOpen: () => runtime?.dialogOpen === true,
        getSession: () => runtime?.session,
        mapService: runtime.ctx.mapService,
        getLayers: () => runtime.ctx.getLayers?.() || [],
        onRemoveLeader: (leaderKey) => {
            applySession(setLeaderEnabled(runtime.session, leaderKey, false));
            runtime.ctx.showToast?.('Callout turned off', 'success');
        },
        onAddNote: (leaderKey) => {
            const text = window.prompt('Additional key note text');
            if (!text) return;
            try {
                applySession(addNoteToLeader(runtime.session, leaderKey, text));
            } catch (err) {
                runtime.ctx.showToast?.(err?.message || 'Could not add note', 'warning');
            }
        },
        onAddLeader: (input) => {
            try {
                applySession(enableOrAddLeader(runtime.session, {
                    ...input,
                    sheetId: input.sheetId || runtime.session.selectedSheetId
                }));
                runtime.ctx.showToast?.('Callout turned on', 'success');
            } catch (err) {
                runtime.ctx.showToast?.(err?.message || 'Could not add callout', 'warning');
            }
        }
    });
}

function wireDrag() {
    if (!runtime) return;
    installCalloutDrag(runtime.ctx.mapService, {
        isEnabled: () => Boolean(runtime),
        onDrag: (leaderKey, coord) => {
            runtime.session = moveLeaderBubble(runtime.session, leaderKey, coord);
            showCalloutPreview(runtime.ctx.mapService, runtime.session);
        },
        onCommit: (leaderKey, coord) => {
            applySession(moveLeaderBubble(runtime.session, leaderKey, coord));
        }
    });
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {object} [session]
 * @returns {object}
 */
export function ensureCalloutRuntime(ctx, session) {
    if (runtime && runtime.ctx === ctx) {
        if (session) applySession(session);
        return runtime;
    }
    if (runtime && runtime.ctx !== ctx) {
        uninstallCalloutDrag(runtime.ctx.mapService);
        runtime = null;
    }
    runtime = {
        ctx,
        session: session || createFiberCalloutSession(),
        dialogOpen: false,
        onSession: null
    };
    persist(runtime.session);
    wireMenu();
    wireDrag();
    showCalloutPreview(ctx.mapService, runtime.session);
    return runtime;
}

/**
 * Restore map callouts after a workspace import even if the dialog is closed.
 * @param {import('../widget-types.js').WidgetContext} ctx
 */
export function hydratePlanSetCallouts(ctx) {
    const entry = getWidgetEntry(WIDGET_ID);
    if (!entry?.state) return null;
    let session = null;
    try {
        session = restoreCalloutSession(entry.state);
    } catch {
        return null;
    }
    if (!isFiberCalloutSession(session)) return null;
    if (!(session.leaders || []).length && !(session.notes || []).length) return null;
    return ensureCalloutRuntime(ctx, session);
}

/**
 * @returns {object|null}
 */
export function getCalloutRuntime() {
    return runtime;
}

/**
 * @returns {object[] }
 */
export function getLinkedInsetViews() {
    const entry = getWidgetEntry('sheet-cutting');
    if (!entry?.state) return [];
    return restoreSheetSessionFromStore(entry.state)?.sheets?.insetViews || [];
}

/**
 * Refresh preview after Sheet Cutter detail boxes change.
 */
export function refreshCalloutRuntimePreview() {
    if (!runtime) return;
    showCalloutPreview(runtime.ctx.mapService, runtime.session);
}

/**
 * @param {object} mapService
 * @returns {() => void}
 */
export function hideCalloutRuntimeForCapture(mapService) {
    return hideCalloutPreviewForCapture(mapService);
}

/**
 * @param {boolean} open
 */
export function setCalloutDialogOpen(open) {
    if (!runtime) return;
    runtime.dialogOpen = Boolean(open);
    persist(runtime.session, runtime.dialogOpen);
}

/**
 * @param {(session: object) => void} listener
 */
export function subscribeCalloutSession(listener) {
    if (!runtime) return () => {};
    runtime.onSession = listener;
    return () => {
        if (runtime?.onSession === listener) runtime.onSession = null;
    };
}

export const calloutRuntimeApi = {
    getSession: () => runtime?.session,
    persistSession: (session, open) => applySession(session, { persistOpen: open }),
    updateProject: (input) => applySession(updateFiberCalloutProject(runtime.session, input)),
    selectSheet: (sheetId) => applySession(selectCalloutSheet(runtime.session, sheetId)),
    generate: (input) => applySession(generateFiberCallouts(runtime.session, input)),
    setLeaderEnabled: (key, enabled) => applySession(setLeaderEnabled(runtime.session, key, enabled)),
    addNote: (leaderKey, text) => applySession(addNoteToLeader(runtime.session, leaderKey, text)),
    addLeader: (input) => applySession(enableOrAddLeader(runtime.session, input)),
    moveBubble: (leaderKey, bubble) => applySession(moveLeaderBubble(runtime.session, leaderKey, bubble)),
    onDialogClosed: () => {
        if (!runtime) return;
        runtime.dialogOpen = false;
        markWidgetClosed(WIDGET_ID);
        persist(runtime.session, false);
        showCalloutPreview(runtime.ctx.mapService, runtime.session);
    }
};
