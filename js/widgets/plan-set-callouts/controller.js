/**
 * Plan Set Callouts controller — UDOT Fiber leaders + per-sheet key notes.
 */

import { openReactIsland } from '../../ui/open-react-island.js';
import { getWidgetEntry } from '../widget-state-store.js';
import { buildSheetFramesGeoJson } from '../sheet-cutting/export-builder.js';
import {
    envelopeFromFeatures,
    fiberKeyOfLayer,
    isSheetFiberSnapshotLayer,
    listSheetFiberSnapshotLayers
} from '../sheet-cutting/fiber-operational.js';
import { queryFiberFeaturesByEnvelope } from '../sheet-cutting/fiber-operational-fetch.js';
import { isUdotFiberLiveDataset } from '../../symbology/udot-fiber/hover-fields.js';
import { UDOT_FIBER_LAYERS } from '../../symbology/udot-fiber/constants.js';
import { restoreCalloutSession } from './engine.js';
import {
    FIBER_CALLOUT_STEPS,
    createFiberCalloutSession,
    isFiberCalloutSession,
    restoreSheetSessionFromStore
} from './fiber-callout-engine.js';
import { notesUsedOnSheet } from './leader-placement.js';
import {
    calloutRuntimeApi,
    ensureCalloutRuntime,
    hydratePlanSetCallouts as hydrateRuntime,
    setCalloutDialogOpen,
    subscribeCalloutSession
} from './runtime.js';

function emptyFiberFeatures() {
    return { boxes: [], splices: [], conduit: [], fiber: [], cabinets: [], building: [] };
}

function stampFeatures(features, fiberKey, layerId) {
    return (features || []).map((feature) => ({
        type: 'Feature',
        ...feature,
        properties: {
            ...(feature.properties || {}),
            _udotFiberKey: fiberKey,
            _sourceLayerId: layerId
        }
    }));
}

/**
 * Prefer Sheet Cutter operational snapshots; otherwise envelope-query live Fiber.
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {object} sheetSession
 * @returns {Promise<object>}
 */
async function collectFiberFeatures(ctx, sheetSession) {
    const byKey = emptyFiberFeatures();
    const layers = ctx.getLayers() || [];
    const projectName = sheetSession?.project?.projectName || '';
    const snapshots = listSheetFiberSnapshotLayers(layers, projectName);
    const snapshotKeys = new Set(snapshots.map((layer) => fiberKeyOfLayer(layer)).filter(Boolean));

    for (const layer of snapshots) {
        const key = fiberKeyOfLayer(layer);
        if (!key || !byKey[key]) continue;
        byKey[key].push(...stampFeatures(layer.geojson?.features, key, layer.id));
    }

    const frames = buildSheetFramesGeoJson(
        (sheetSession.sheets?.sheets || []).filter((sheet) => sheet.sheetType !== 'overview'),
        sheetSession.routeLine
    );
    const envelope = envelopeFromFeatures(frames.features || []);

    for (const meta of UDOT_FIBER_LAYERS) {
        const key = meta.key;
        if (!byKey[key] || snapshotKeys.has(key) && byKey[key].length) continue;

        const live = layers.find((layer) => fiberKeyOfLayer(layer) === key && (
            isUdotFiberLiveDataset(layer) || isSheetFiberSnapshotLayer(layer)
        ));
        const fallback = layers.find((layer) => fiberKeyOfLayer(layer) === key);
        const layer = live || fallback;
        if (!layer) continue;

        const url = layer.service?.url || layer.source?.url;
        if (envelope && url && isUdotFiberLiveDataset(layer) && !isSheetFiberSnapshotLayer(layer)) {
            try {
                const result = await queryFiberFeaturesByEnvelope(url, envelope, key);
                byKey[key] = stampFeatures(result.features, key, layer.id);
                continue;
            } catch {
                /* fall through to in-memory */
            }
        }
        byKey[key] = stampFeatures(layer.geojson?.features, key, layer.id);
    }

    return byKey;
}

function linkedSheetSession() {
    const entry = getWidgetEntry('sheet-cutting');
    if (!entry?.state) return null;
    return restoreSheetSessionFromStore(entry.state);
}

function loadStoredSession() {
    const raw = getWidgetEntry('plan-set-callouts')?.state;
    if (!raw) return createFiberCalloutSession();
    try {
        const restored = restoreCalloutSession(raw);
        return isFiberCalloutSession(restored)
            ? restored
            : createFiberCalloutSession({
                projectName: restored.project?.projectName,
                projectNumber: restored.project?.projectNumber
            });
    } catch {
        return createFiberCalloutSession();
    }
}

function initialStepFor(session) {
    if ((session?.leaders || []).length) return 3;
    if (session?.project?.projectName && session.project.projectName !== 'Plan Set Callouts') return 2;
    return 1;
}

/**
 * Restore map callouts after a workspace import even if the dialog is closed.
 * @param {import('../widget-types.js').WidgetContext} ctx
 */
export function hydratePlanSetCallouts(ctx) {
    return hydrateRuntime(ctx);
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {{ restoreState?: object }} [options]
 */
export async function openPlanSetCallouts(ctx, { restoreState = null } = {}) {
    let session = restoreState
        ? (isFiberCalloutSession(restoreState)
            ? restoreState
            : (() => {
                try {
                    const restored = restoreCalloutSession(restoreState);
                    return isFiberCalloutSession(restored) ? restored : loadStoredSession();
                } catch {
                    return loadStoredSession();
                }
            })())
        : loadStoredSession();

    const runtime = ensureCalloutRuntime(ctx, session);
    session = runtime.session;
    setCalloutDialogOpen(true);

    await openReactIsland({
        title: 'Plan Set Callouts',
        width: '560px',
        mountPath: '../../../react/widgets/mountPlanSetCalloutsDialog.jsx',
        mountExport: 'mountPlanSetCalloutsDialog',
            onClose: () => calloutRuntimeApi.onDialogClosed(),
        getProps: (close) => ({
            steps: FIBER_CALLOUT_STEPS,
            initialSession: session,
            initialStep: initialStepFor(session),
            hasSheetSession: Boolean(linkedSheetSession()?.sheets?.sheets?.length),
            insetViews: linkedSheetSession()?.sheets?.insetViews || [],
            onCancel: () => {
                calloutRuntimeApi.onDialogClosed();
                close();
            },
            onDone: () => {
                ctx.showToast?.(
                    'Callouts stay on the map. Drag a number to move it; right-click a feature to turn one on or off. Reopen this widget to continue.',
                    'success'
                );
                calloutRuntimeApi.onDialogClosed();
                close();
            },
            onCreateProject: (input) => {
                const current = calloutRuntimeApi.getSession();
                return (isFiberCalloutSession(current) && (current.leaders || []).length)
                    ? calloutRuntimeApi.updateProject(input)
                    : calloutRuntimeApi.persistSession(createFiberCalloutSession(input), true);
            },
            onUpdateProject: (patch) => calloutRuntimeApi.updateProject(patch),
            onSelectSheet: (sheetId) => calloutRuntimeApi.selectSheet(sheetId),
            onGenerate: async () => {
                const sheetSession = linkedSheetSession();
                if (!sheetSession) {
                    throw new Error('Open Sheet Cutter and generate sheets first.');
                }
                const features = await collectFiberFeatures(ctx, sheetSession);
                const next = calloutRuntimeApi.generate({
                    sheets: sheetSession.sheets?.sheets || [],
                    routeLine: sheetSession.routeLine,
                    sheetSetId: sheetSession.sheets?.sheetSetId,
                    frameFeatures: buildSheetFramesGeoJson(
                        (sheetSession.sheets?.sheets || []).filter((sheet) => sheet.sheetType !== 'overview'),
                        sheetSession.routeLine
                    ),
                    features
                });
                const onCount = (next.leaders || []).filter((leader) => (
                    !leader.suppressed && leader.enabled !== false
                )).length;
                ctx.showToast?.(
                    onCount
                        ? `Placed ${onCount} callout(s)`
                        : 'Candidates ready — all callouts start off. Turn them on from Review or right-click a feature.',
                    'success'
                );
                return next;
            },
            onToggleLeader: (leaderKey, enabled) => calloutRuntimeApi.setLeaderEnabled(leaderKey, enabled),
            onSuppressLeader: (leaderKey) => calloutRuntimeApi.setLeaderEnabled(leaderKey, false),
            onAddNote: (leaderKey, text) => calloutRuntimeApi.addNote(leaderKey, text),
            onAddManualNote: (text) => {
                const current = calloutRuntimeApi.getSession();
                const sheetId = current.selectedSheetId;
                const sheetLeaders = (current.leaders || []).filter((leader) => (
                    leader.sheetId === sheetId && !leader.suppressed && leader.enabled !== false
                ));
                const target = sheetLeaders[0];
                if (target) return calloutRuntimeApi.addNote(target.leaderKey, text);
                throw new Error('Turn on a callout first, or right-click a feature on the map.');
            },
            onNotesForSheet: (sheetId) => notesUsedOnSheet(
                calloutRuntimeApi.getSession(),
                sheetId,
                { insetViews: linkedSheetSession()?.sheets?.insetViews || [], page: 'corridor' }
            ),
            onSubscribeSession: (listener) => subscribeCalloutSession(listener)
        })
    });
}
