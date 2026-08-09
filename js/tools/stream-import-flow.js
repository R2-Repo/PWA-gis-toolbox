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

/**
 * @param {File[]} files streaming-eligible files (see stream-policy)
 * @param {{
 *   fenceBbox?: [number,number,number,number]|null,
 *   refreshUI?: () => void
 * }} [options]
 */
export async function runStreamingImportFlow(files, options = {}) {
    const { fenceBbox = null, refreshUI } = options;
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

            const job = streamImportFile(file, {
                format,
                fenceBbox,
                onProgress: (percent, step) => {
                    progress.update(percent, `${prefix}${step}`, {
                        fileName: file.name,
                        fileSize: file.size,
                        fileIndex: i,
                        fileCount: fileList.length
                    });
                }
            });
            cancelCurrent = job.cancel;

            try {
                const { datasets, stats } = await job.promise;
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
