/**
 * Shared layer reconstruction for session restore and Toolbox Kit import.
 */
import { analyzeSchema, analyzeTableSchema } from './data-model.js';
import { resolveLayerIdConflict, importDeferredWorkspaceFromZip } from './project-kit.js';
import {
    importWorkspaceLayerBundle,
    importWorkspaceLayerFromParts
} from '../workspace/workspace-store.js';
import { isCoverageRasterLayer, rehydrateCoverageRasters } from './coverage-raster-layer.js';
import { saveSourceFile } from '../workspace/source-file-store.js';

/**
 * Build a live dataset object from a persisted layer record.
 * @param {object} saved
 * @param {{
 *   spatial?: object,
 *   tableRows?: object[],
 *   workspaceBundle?: object,
 *   rasterSidecar?: { manifest: object[], pngBlobsByFile: Record<string, Blob> },
 *   importWorkspaceLayerBundle?: typeof importWorkspaceLayerBundle,
 *   kitZip?: object,
 *   folderKey?: string,
 *   newLayerId?: string
 * }} [payload]
 */
export async function buildDatasetFromSavedLayer(saved, payload = {}) {
    const layerId = payload.newLayerId || saved.id;

    if (saved.type === 'spatial-chunked' || saved.storage === 'workspace') {
        const bundle = payload.workspaceBundle;
        let meta = null;
        if (bundle?.deferred && payload.kitZip) {
            meta = await importDeferredWorkspaceFromZip(payload.kitZip, payload.folderKey || saved.id, {
                newLayerId: layerId,
                importWorkspaceLayerFromParts
            });
        } else if (bundle && !bundle.deferred) {
            const importFn = payload.importWorkspaceLayerBundle || importWorkspaceLayerBundle;
            meta = await importFn(bundle, { newLayerId: layerId });
        } else if (payload.kitZip && payload.folderKey) {
            meta = await importDeferredWorkspaceFromZip(payload.kitZip, payload.folderKey, {
                newLayerId: layerId,
                importWorkspaceLayerFromParts
            });
        }
        if (!meta) return null;
        return {
            id: layerId,
            name: saved.name || meta.name,
            type: 'spatial-chunked',
            storage: 'workspace',
            workspaceLayerId: layerId,
            geojson: { type: 'FeatureCollection', features: [] },
            schema: saved.schema || meta.schema,
            source: saved.source || meta.source || { file: saved.name, format: 'toolbox-kit' },
            visible: saved.visible !== false,
            active: false,
            created: saved.created || new Date().toISOString(),
            filters: saved.filters,
            scaleRangeEnabled: saved.scaleRangeEnabled,
            minScale: saved.minScale,
            maxScale: saved.maxScale,
            ...(saved.locked ? { locked: true } : {}),
            ...(saved.groupId ? { groupId: saved.groupId } : {})
        };
    }

    if (saved.type === 'spatial' && payload.spatial) {
        const schema = analyzeSchema(payload.spatial);
        let source = saved.source || { file: saved.name, format: 'toolbox-kit' };

        if (isCoverageRasterLayer({ source })) {
            if (payload.rasterSidecar?.manifest?.length) {
                const coverageRasters = await rehydrateCoverageRasters(
                    payload.rasterSidecar.manifest,
                    payload.rasterSidecar.pngBlobsByFile || {}
                );
                source = {
                    ...source,
                    coverageType: 'raster',
                    coverageRasters
                };
            } else if (source.coverageRasters?.some((r) => r.dataUrl)) {
                source = { ...source };
            }
        }

        return {
            id: layerId,
            name: saved.name,
            type: 'spatial',
            geojson: payload.spatial,
            schema,
            source,
            visible: saved.visible !== false,
            active: false,
            created: saved.created || new Date().toISOString(),
            filters: saved.filters,
            scaleRangeEnabled: saved.scaleRangeEnabled,
            minScale: saved.minScale,
            maxScale: saved.maxScale,
            ...(saved.locked ? { locked: true } : {}),
            ...(saved.groupId ? { groupId: saved.groupId } : {})
        };
    }

    if (saved.type === 'table' && payload.tableRows) {
        const fields = payload.tableRows.length > 0 ? Object.keys(payload.tableRows[0]) : [];
        const schema = analyzeTableSchema(payload.tableRows, fields);
        return {
            id: layerId,
            name: saved.name,
            type: 'table',
            rows: payload.tableRows,
            schema,
            source: saved.source || { file: saved.name, format: 'toolbox-kit' },
            visible: saved.visible !== false,
            active: false,
            created: saved.created || new Date().toISOString(),
            filters: saved.filters,
            ...(saved.locked ? { locked: true } : {})
        };
    }

    if (saved.type === 'service' && saved.service) {
        return {
            id: layerId,
            name: saved.name,
            type: 'service',
            service: { ...saved.service },
            source: saved.source || { format: 'live-service', url: saved.service.url },
            visible: saved.visible !== false,
            active: false,
            created: saved.created || new Date().toISOString(),
            geojson: { type: 'FeatureCollection', features: [] },
            ...(saved.schema ? { schema: saved.schema } : {}),
            ...(saved.locked ? { locked: true } : {}),
            ...(saved.groupId ? { groupId: saved.groupId } : {})
        };
    }

    return null;
}

/**
 * Reconstruct a workspace-backed layer when IndexedDB workspace data already exists locally.
 * @param {object} saved
 * @param {string} [newLayerId]
 */
export function buildDatasetFromWorkspaceRef(saved, newLayerId = saved.id) {
    const workspaceLayerId = saved.workspaceLayerId || saved.id;
    return {
        id: newLayerId,
        name: saved.name,
        type: 'spatial-chunked',
        storage: 'workspace',
        workspaceLayerId,
        geojson: { type: 'FeatureCollection', features: [] },
        schema: saved.schema,
        source: saved.source || { file: saved.name, format: 'session' },
        visible: saved.visible !== false,
        active: false,
        created: saved.created || new Date().toISOString(),
        filters: saved.filters,
        scaleRangeEnabled: saved.scaleRangeEnabled,
        minScale: saved.minScale,
        maxScale: saved.maxScale,
        ...(saved.locked ? { locked: true } : {}),
        ...(saved.groupId ? { groupId: saved.groupId } : {})
    };
}

/**
 * @param {{
 *   layersSection: object,
 *   mode?: 'replace'|'merge',
 *   existingLayerIds?: Set<string>,
 *   importWorkspaceLayerBundle?: typeof importWorkspaceLayerBundle
 * }} options
 * @returns {Promise<{ datasets: object[], styles: object, activeLayerId: string|null, idMap: Map<string,string> }>}
 */
export async function prepareLayersFromKitSection(options) {
    const {
        layersSection,
        mode = 'replace',
        existingLayerIds = new Set(),
        importWorkspaceLayerBundle: importWorkspace = importWorkspaceLayerBundle,
        kitZip = null
    } = options;

    const idMap = new Map();
    const usedIds = mode === 'merge' ? new Set(existingLayerIds) : new Set();
    const datasets = [];
    const styles = { ...(layersSection.styles || {}) };
    const remappedStyles = {};

    // Restore OPFS source sidecars before layers attach (so opfsKey resolves).
    if (kitZip && layersSection.sources) {
        for (const [key, entries] of Object.entries(layersSection.sources)) {
            const entry = (entries || [])[0];
            if (!entry?.path) continue;
            const zipEntry = kitZip.file(entry.path);
            if (!zipEntry) continue;
            const buf = await zipEntry.async('arraybuffer');
            const file = new File([buf], entry.fileName || 'source', {
                type: 'application/octet-stream'
            });
            await saveSourceFile(key, file);
        }
    }

    for (const saved of layersSection.index || []) {
        let targetId = saved.id;
        if (mode === 'merge') {
            targetId = resolveLayerIdConflict(saved.id, usedIds);
        }
        usedIds.add(targetId);
        if (targetId !== saved.id) idMap.set(saved.id, targetId);

        const wsBundle = layersSection.workspace?.[saved.id];
        const deferredInfo = layersSection.workspaceDeferred?.[saved.id];

        const dataset = await buildDatasetFromSavedLayer(saved, {
            newLayerId: targetId,
            spatial: layersSection.spatial?.[saved.id],
            tableRows: layersSection.tables?.[saved.id],
            workspaceBundle: wsBundle,
            rasterSidecar: layersSection.rasters?.[saved.id],
            importWorkspaceLayerBundle: importWorkspace,
            kitZip: (wsBundle?.deferred || deferredInfo) ? kitZip : null,
            folderKey: deferredInfo?.folderKey || saved.id
        });

        if (!dataset) continue;
        datasets.push(dataset);

        if (styles[saved.id]) {
            remappedStyles[targetId] = styles[saved.id];
        }
    }

    let activeLayerId = layersSection.activeLayerId || null;
    if (activeLayerId && idMap.has(activeLayerId)) {
        activeLayerId = idMap.get(activeLayerId);
    } else if (activeLayerId && mode === 'merge' && existingLayerIds.has(activeLayerId)) {
        activeLayerId = idMap.get(activeLayerId) || datasets[datasets.length - 1]?.id || null;
    }

    return { datasets, styles: remappedStyles, activeLayerId, idMap };
}

export default {
    buildDatasetFromSavedLayer,
    buildDatasetFromWorkspaceRef,
    prepareLayersFromKitSection
};
