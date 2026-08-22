/**
 * Plan Set Callouts controller — UDOT Fiber leaders + per-sheet key notes.
 */

import { openReactIsland } from '../../ui/open-react-island.js';
import { markWidgetClosed, upsertWidgetState, getWidgetEntry } from '../widget-state-store.js';
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
import {
    WIDGET_ID,
    serializeCalloutSession,
    restoreCalloutSession
} from './engine.js';
import {
    FIBER_CALLOUT_STEPS,
    addManualLeader,
    addNoteToLeader,
    createFiberCalloutSession,
    generateFiberCallouts,
    isFiberCalloutSession,
    restoreSheetSessionFromStore,
    selectCalloutSheet,
    suppressLeader,
    updateFiberCalloutProject
} from './fiber-callout-engine.js';
import { notesUsedOnSheet } from './leader-placement.js';
import { clearCalloutPreview, showCalloutPreview } from './preview.js';
import { setPlanSetCalloutMenuContext } from './context-menu-bridge.js';

function persistSession(session, open = true) {
    upsertWidgetState(WIDGET_ID, {
        open,
        state: serializeCalloutSession(session)
    });
}

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

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {{ restoreState?: object }} [options]
 */
export async function openPlanSetCallouts(ctx, { restoreState = null } = {}) {
    let session = createFiberCalloutSession();
    const raw = restoreState || getWidgetEntry(WIDGET_ID)?.state;
    if (raw) {
        try {
            const restored = restoreCalloutSession(raw);
            session = isFiberCalloutSession(restored)
                ? restored
                : createFiberCalloutSession({
                    projectName: restored.project?.projectName,
                    projectNumber: restored.project?.projectNumber
                });
        } catch {
            session = createFiberCalloutSession();
        }
    }

    const applyPreview = (next) => {
        session = next;
        persistSession(session);
        showCalloutPreview(ctx.mapService, session);
        return session;
    };

    setPlanSetCalloutMenuContext({
        isOpen: () => getWidgetEntry(WIDGET_ID)?.open === true,
        getSession: () => session,
        mapService: ctx.mapService,
        getLayers: () => ctx.getLayers() || [],
        onRemoveLeader: (leaderKey) => {
            applyPreview(suppressLeader(session, leaderKey));
            ctx.showToast?.('Callout removed', 'success');
        },
        onAddNote: (leaderKey) => {
            const text = window.prompt('Additional key note text');
            if (!text) return;
            try {
                applyPreview(addNoteToLeader(session, leaderKey, text));
            } catch (err) {
                ctx.showToast?.(err?.message || 'Could not add note', 'warning');
            }
        },
        onAddLeader: (input) => {
            try {
                applyPreview(addManualLeader(session, input));
                ctx.showToast?.('Callout added', 'success');
            } catch (err) {
                ctx.showToast?.(err?.message || 'Could not add callout', 'warning');
            }
        }
    });

    persistSession(session, true);
    if (session.leaders?.length) showCalloutPreview(ctx.mapService, session);

    await openReactIsland({
        title: 'Plan Set Callouts',
        width: '560px',
        mountPath: '../../../react/widgets/mountPlanSetCalloutsDialog.jsx',
        mountExport: 'mountPlanSetCalloutsDialog',
        onOverlayDestroy: () => {
            setPlanSetCalloutMenuContext(null);
            clearCalloutPreview(ctx.mapService);
            markWidgetClosed(WIDGET_ID);
        },
        getProps: (close) => ({
            steps: FIBER_CALLOUT_STEPS,
            initialSession: session,
            hasSheetSession: Boolean(linkedSheetSession()?.sheets?.sheets?.length),
            onCancel: () => {
                setPlanSetCalloutMenuContext(null);
                clearCalloutPreview(ctx.mapService);
                markWidgetClosed(WIDGET_ID);
                close();
            },
            onDone: () => {
                persistSession(session, false);
                setPlanSetCalloutMenuContext(null);
                clearCalloutPreview(ctx.mapService);
                markWidgetClosed(WIDGET_ID);
                ctx.showToast?.('Callouts saved for sheet PDF export', 'success');
                close();
            },
            onCreateProject: (input) => {
                session = (isFiberCalloutSession(session) && (session.leaders || []).length)
                    ? updateFiberCalloutProject(session, input)
                    : createFiberCalloutSession(input);
                persistSession(session);
                return session;
            },
            onUpdateProject: (patch) => {
                session = updateFiberCalloutProject(session, patch);
                persistSession(session);
                return session;
            },
            onSelectSheet: (sheetId) => {
                session = selectCalloutSheet(session, sheetId);
                persistSession(session);
                return session;
            },
            onGenerate: async () => {
                const sheetSession = linkedSheetSession();
                if (!sheetSession) {
                    throw new Error('Open Sheet Cutter and generate sheets first.');
                }
                const features = await collectFiberFeatures(ctx, sheetSession);
                const next = generateFiberCallouts(session, {
                    sheets: sheetSession.sheets?.sheets || [],
                    routeLine: sheetSession.routeLine,
                    sheetSetId: sheetSession.sheets?.sheetSetId,
                    frameFeatures: buildSheetFramesGeoJson(
                        (sheetSession.sheets?.sheets || []).filter((sheet) => sheet.sheetType !== 'overview'),
                        sheetSession.routeLine
                    ),
                    features
                });
                applyPreview(next);
                const count = (next.leaders || []).filter((leader) => !leader.suppressed).length;
                ctx.showToast?.(`Placed ${count} callout(s)`, 'success');
                return next;
            },
            onSuppressLeader: (leaderKey) => applyPreview(suppressLeader(session, leaderKey)),
            onAddNote: (leaderKey, text) => applyPreview(addNoteToLeader(session, leaderKey, text)),
            onAddManualNote: (text) => {
                const sheetId = session.selectedSheetId;
                const sheetLeaders = (session.leaders || []).filter((leader) => (
                    leader.sheetId === sheetId && !leader.suppressed
                ));
                const target = sheetLeaders[0];
                if (target) return applyPreview(addNoteToLeader(session, target.leaderKey, text));
                throw new Error('Generate callouts or right-click a feature to add a leader first.');
            },
            onNotesForSheet: (sheetId) => notesUsedOnSheet(session, sheetId)
        })
    });
}
