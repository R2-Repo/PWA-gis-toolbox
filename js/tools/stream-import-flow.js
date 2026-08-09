/**
 * High-capacity import flow — UI orchestration for streaming large files into
 * workspace-backed layers. Mirrors handleFileImport's progress/cancel/rollback
 * behavior, but data goes worker → IndexedDB instead of into memory.
 */
import logger from '../core/logger.js';
import { handleError } from '../core/error-handler.js';
import { addLayer, removeLayer, getLayers } from '../core/state.js';
import { createImportGroupForDatasets } from '../core/layer-groups.js';
import sessionStore from '../core/session-store.js';
import mapService from '../map/map-service.js';
import { showToast, showErrorToast } from '../ui/toast.js';
import { showModal, showProgressModal } from '../ui/modals.js';
import { detectFormat } from '../import/importer.js';
import { applyImportLayerStyles } from '../import/post-import.js';
import { streamImportFile } from '../import/stream/stream-import-service.js';
import { removeWorkspaceLayer } from '../workspace/workspace-store.js';
import { removeSourceFileIfUnreferenced } from '../workspace/source-file-store.js';

async function _rollbackStreamedLayers(datasets) {
    for (const ds of datasets) {
        mapService.removeLayer(ds.id);
        removeLayer(ds.id);
        try {
            await removeWorkspaceLayer(ds.workspaceLayerId || ds.id);
        } catch { /* best effort */ }
    }
    for (const ds of datasets) {
        if (ds.source?.opfsKey) {
            await removeSourceFileIfUnreferenced(ds.source.opfsKey, getLayers());
        }
    }
}

/** gis importMode applies to the KML pipeline (zip may be a KMZ in disguise). */
const KML_FAMILY = new Set(['kml', 'kmz', 'xml', 'zip']);

/**
 * Ask the user for the source CRS of a projected CSV and resolve a proj4
 * definition the worker can use.
 * @param {File} file
 * @returns {Promise<{ code: string, def: string }|null>}
 */
async function _promptCsvSourceCrs(file) {
    const { pickCrsConfirmModal } = await import('../../react/tools/mountCrsConfirmDialog.jsx');
    const { resolveCrs, getCrsWkt, normalizeCrsCode } = await import('../crs/registry.js');

    const picked = await pickCrsConfirmModal({
        layerName: file.name,
        message: `"${file.name}" uses projected easting/northing coordinates. Choose the source coordinate system so features can be converted to WGS84 while importing.`,
        defaultCrs: 'EPSG:6337'
    });
    if (!picked) return null;

    const code = normalizeCrsCode(picked);
    const def = await resolveCrs(code);
    const workerDef = def && def.startsWith('+') ? def : getCrsWkt(code);
    if (!workerDef) {
        showToast(`No projection definition available for ${code}.`, 'error');
        return null;
    }
    return { code, def: workerDef };
}

/**
 * @param {File[]} files streaming-eligible files (see stream-policy)
 * @param {{
 *   fenceBbox?: [number,number,number,number]|null,
 *   refreshUI?: () => void,
 *   selectedFields?: string[]|null
 * }} [options]
 */
export async function runStreamingImportFlow(files, options = {}) {
    const { fenceBbox = null, refreshUI, selectedFields = null } = options;
    const fileList = Array.from(files || []);
    if (!fileList.length) return;

    const progress = showProgressModal('Importing Large Files');
    let cancelCurrent = null;
    let userCancelled = false;

    progress.onCancel(() => {
        userCancelled = true;
        cancelCurrent?.();
        progress.close();
        showToast('Import cancelled', 'warning');
    });

    const addedDatasets = [];
    const errors = [];
    const importWarnings = [];
    let totalFeatures = 0;
    let totalNoGeometry = 0;
    let totalFenceFiltered = 0;

    sessionStore.pauseSessionSave();
    try {
        for (let i = 0; i < fileList.length; i++) {
            if (userCancelled) break;
            const file = fileList[i];
            const prefix = fileList.length > 1 ? `File ${i + 1}/${fileList.length}: ` : '';
            const format = detectFormat(file);

            const startJob = (extraOptions = {}) => streamImportFile(file, {
                format,
                fenceBbox,
                selectedFields,
                // Large KML/KMZ import as simplified GIS layers (presentation
                // bloat stripped) — matches the Import Optimizer recommendation.
                importMode: KML_FAMILY.has(format) ? 'gis' : undefined,
                onProgress: (percent, step) => {
                    progress.update(percent, `${prefix}${step}`, {
                        fileName: file.name,
                        fileSize: file.size,
                        fileIndex: i,
                        fileCount: fileList.length
                    });
                },
                ...extraOptions
            });

            let job = startJob();
            cancelCurrent = job.cancel;

            try {
                let result;
                try {
                    result = await job.promise;
                } catch (e) {
                    // Projected CSV — ask for the source CRS, then retry with
                    // in-worker reprojection.
                    if (e?.code !== 'PROJECTED_CSV_NEEDS_CRS' || userCancelled) throw e;
                    const sourceCrs = await _promptCsvSourceCrs(file);
                    if (!sourceCrs) throw e;
                    job = startJob({ sourceCrs });
                    cancelCurrent = job.cancel;
                    result = await job.promise;
                }
                const { datasets, stats } = result;
                cancelCurrent = null;

                if (datasets.length >= 2) {
                    createImportGroupForDatasets(datasets);
                }
                for (const ds of datasets) {
                    addLayer(ds, { activate: true });
                    const layerIdx = getLayers().indexOf(ds);
                    applyImportLayerStyles(ds, { mapService, getLayers, layerIndex: layerIdx });
                    await mapService.addWorkspaceLayer(ds, layerIdx, { fit: false });
                    addedDatasets.push(ds);
                }

                totalFeatures += stats.featureCount || 0;
                totalNoGeometry += stats.noGeometryCount || 0;
                totalFenceFiltered += stats.fenceFiltered || 0;
                if (stats.warnings?.length) {
                    importWarnings.push(...stats.warnings.map((w) => `${file.name}: ${w}`));
                }
                logger.info('StreamImport', 'File imported', {
                    file: file.name,
                    features: stats.featureCount,
                    layers: datasets.length
                });
            } catch (e) {
                cancelCurrent = null;
                if (e?.cancelled || userCancelled) {
                    userCancelled = true;
                    break;
                }
                errors.push({ file: file.name, error: e });
                logger.error('StreamImport', 'File import failed', { file: file.name, error: e.message });
            }
        }

        if (userCancelled) {
            await _rollbackStreamedLayers(addedDatasets);
            refreshUI?.();
            return;
        }

        progress.close();

        if (addedDatasets.length) {
            await mapService.scheduleFitToLayers(addedDatasets.map((ds) => ds.id));
            const layerWord = addedDatasets.length === 1 ? 'layer' : 'layers';
            const fenceNote = fenceBbox && totalFenceFiltered > 0
                ? ` (${totalFenceFiltered.toLocaleString()} features outside fence excluded)`
                : '';
            showToast(
                `Imported ${totalFeatures.toLocaleString()} features into ${addedDatasets.length} ${layerWord}${fenceNote}`,
                'success'
            );
            if (totalNoGeometry > 0) {
                showToast(
                    `${totalNoGeometry.toLocaleString()} feature(s) have no geometry and will not draw on the map`,
                    'warning'
                );
            }
            for (const warning of importWarnings) {
                showToast(warning, 'warning');
            }
            refreshUI?.();
        }

        if (errors.length) {
            const body = errors
                .map(({ file, error }) => `<p><strong>${file}:</strong> ${error.message}</p>`)
                .join('');
            showModal(addedDatasets.length ? 'Import Summary' : 'Import Failed', body, { width: '480px' });
        }
    } catch (e) {
        progress.close();
        await _rollbackStreamedLayers(addedDatasets);
        if (e?.cancelled || userCancelled) return;
        const classified = handleError(e, 'Import', 'Streaming import');
        showErrorToast(classified);
    } finally {
        sessionStore.resumeSessionSave(true);
    }
}

export default { runStreamingImportFlow };
