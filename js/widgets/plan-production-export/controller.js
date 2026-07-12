/**
 * Plan Production Export controller.
 */

import { openReactIsland } from '../../ui/open-react-island.js';
import { markWidgetClosed, upsertWidgetState, serializeWidgetStore } from '../widget-state-store.js';
import {
    WIDGET_ID,
    EXPORT_STEPS,
    LINKABLE_WIDGETS,
    createPlanProductionSession,
    updateProductionProject,
    assembleFromWidgetEntries,
    linkWidgetAssembly,
    runReadinessCheck,
    setExportProfile,
    buildProductionExport,
    getExportProfileOptions,
    serializeProductionSession,
    restoreProductionSession
} from './engine.js';
import { enrichAssemblyForExport } from './export-builder.js';

function persistSession(session, open = true) {
    upsertWidgetState(WIDGET_ID, {
        open,
        state: serializeProductionSession(session)
    });
}

function downloadTextFile(filename, content, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {{ restoreState?: object }} [options]
 */
export async function openPlanProductionExport(ctx, { restoreState = null } = {}) {
    let session = restoreState
        ? restoreProductionSession(restoreState)
        : createPlanProductionSession();

    await openReactIsland({
        title: 'Plan Production Export',
        width: '620px',
        mountPath: '../../../react/widgets/mountPlanProductionExportDialog.jsx',
        mountExport: 'mountPlanProductionExportDialog',
        onClose: () => {
            markWidgetClosed(WIDGET_ID);
        },
        getProps: (close) => ({
            steps: EXPORT_STEPS,
            linkableWidgets: LINKABLE_WIDGETS,
            exportProfiles: getExportProfileOptions(),
            getLinkedWidgetEntries: () => {
                const store = serializeWidgetStore();
                return store.activeWidgets.filter((entry) =>
                    LINKABLE_WIDGETS.some((widget) => widget.id === entry.type)
                );
            },
            initialSession: session,
            onCancel: () => {
                markWidgetClosed(WIDGET_ID);
                close();
            },
            onCreateProject: (input) => {
                session = createPlanProductionSession(input);
                persistSession(session);
                return session;
            },
            onUpdateProject: (patch) => {
                session = updateProductionProject(session, patch);
                persistSession(session);
                return session;
            },
            onLinkWidgetSessions: () => {
                const store = serializeWidgetStore();
                const assembly = assembleFromWidgetEntries(store.activeWidgets);
                session = linkWidgetAssembly(session, assembly);
                persistSession(session);
                return session;
            },
            onRunReadinessCheck: () => {
                session = runReadinessCheck(session);
                persistSession(session);
                return session;
            },
            onSetExportProfile: (profileId) => {
                session = setExportProfile(session, profileId);
                persistSession(session);
                return session;
            },
            onBuildExport: () => {
                session = buildProductionExport(session);
                persistSession(session);
                return session;
            },
            onDownloadExport: () => {
                if (!session.lastExport?.files?.length) {
                    session = buildProductionExport(session);
                }
                for (const file of session.lastExport.files) {
                    downloadTextFile(file.filename, file.content, file.mimeType);
                }
                ctx.showToast(`Downloaded ${session.lastExport.files.length} export file(s)`, 'success');
                persistSession(session);
                return session;
            },
            onAddExportLayers: () => {
                const assembly = enrichAssemblyForExport({
                    ...session.assembly,
                    project: session.project,
                    readiness: session.readiness
                });

                const created = [];
                const baseName = session.project.projectName || 'Plan_Production';
                const layerDefs = [];

                if (assembly.fiberExport?.geojson) {
                    for (const [key, data] of Object.entries(assembly.fiberExport.geojson)) {
                        if (data?.features?.length) {
                            layerDefs.push({ name: `${baseName}_${key}`, data });
                        }
                    }
                }
                if (assembly.calloutExport?.geojson?.calloutMarkers?.features?.length) {
                    layerDefs.push({
                        name: `${baseName}_Callout_Markers`,
                        data: assembly.calloutExport.geojson.calloutMarkers
                    });
                }
                if (assembly.sheetExport?.layers?.sheetFrames?.features?.length) {
                    layerDefs.push({
                        name: `${baseName}_Sheet_Frames`,
                        data: assembly.sheetExport.layers.sheetFrames
                    });
                }

                for (const def of layerDefs) {
                    const dataset = ctx.createSpatialDataset(def.name, def.data, { format: 'derived' });
                    ctx.addLayer(dataset);
                    ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset));
                    created.push(dataset);
                }

                if (created.length) {
                    ctx.refreshUI();
                    ctx.showToast(`Added ${created.length} plan layer(s)`, 'success');
                } else {
                    ctx.showToast('No GeoJSON layers available to add', 'warning');
                }

                return created;
            },
            onSaveSession: () => {
                persistSession(session);
                downloadTextFile(
                    `${session.project.projectName || 'plan_production'}.json`,
                    JSON.stringify(serializeProductionSession(session), null, 2),
                    'application/json'
                );
            }
        })
    });
}
