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
import { showModal, showProgressModal, confirm } from '../ui/modals.js';
import { detectFormat } from '../import/importer.js';
import { applyImportLayerStyles } from '../import/post-import.js';
import { streamImportFile, resumeStreamImportFromCheckpoint, discardImportCheckpoint } from '../import/stream/stream-import-service.js';
import { listInterruptedCheckpoints } from '../import/stream/import-checkpoint-store.js';
import { removeWorkspaceLayer } from '../workspace/workspace-store.js';
import { removeSourceFileIfUnreferenced } from '../workspace/source-file-store.js';
import { formatBytes } from '../import/import-preflight.js';
import { assessStreamCapacity } from '../import/import-capacity-context.js';

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

async function _promptSourceCrs(file, message) {
    const { pickCrsConfirmModal } = await import('../../react/tools/mountCrsConfirmDialog.jsx');
    const { resolveCrs, getCrsWkt, normalizeCrsCode } = await import('../crs/registry.js');

    const picked = await pickCrsConfirmModal({
        layerName: file.name,
        message,
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
 * Ask the user for the source CRS of a projected CSV and resolve a proj4
 * definition the worker can use.
 * @param {File} file
 * @returns {Promise<{ code: string, def: string }|null>}
 */
async function _promptCsvSourceCrs(file) {
    return _promptSourceCrs(
        file,
        `"${file.name}" uses projected easting/northing coordinates. Choose the source coordinate system so features can be converted to WGS84 while importing.`
    );
}

async function _promptShapefileSourceCrs(file) {
    return _promptSourceCrs(
        file,
        `"${file.name}" has no .prj and coordinates look projected. Choose the source coordinate system so features can be converted to WGS84 while importing.`
    );
}

/**
 * @param {File[]} files streaming-eligible files (see stream-policy)
 * @param {{
 *   fenceBbox?: [number,number,number,number]|null,
 *   refreshUI?: () => void,
 *   selectedFields?: string[]|null,
 *   featureFilter?: object|null
 * }} [options]
 */
export async function runStreamingImportFlow(files, options = {}) {
    const { fenceBbox = null, refreshUI, selectedFields = null, featureFilter = null } = options;
    const fileList = Array.from(files || []);
    if (!fileList.length) return;

    // Ritual field/filter/fence tokens are not required — Gate B unlock is the
    // stored soft ceiling (~1M, may tighten under device/project pressure).

    const totalSourceBytes = fileList.reduce((sum, f) => sum + (f?.size || 0), 0);
    const capacityCheck = await assessStreamCapacity({
        files: fileList,
        layers: getLayers()
    });
    if (!capacityCheck.ok) {
        showToast(
            capacityCheck.denyReason
            || `Not enough browser storage for this import (~${formatBytes(totalSourceBytes)} source). Free space in Storage settings, or import a smaller subset.`,
            'error'
        );
        return;
    }
    for (const warning of capacityCheck.warnings || []) {
        showToast(warning, 'warning');
    }

    const adaptiveStoredLimit = capacityCheck.capacity?.modifiers?.storedFeatureSoftLimit ?? null;

    let progress = null;
    let cancelCurrent = null;
    let userCancelled = false;

    const openProgress = () => {
        progress = showProgressModal('Importing Large Files');
        progress.onCancel(() => {
            userCancelled = true;
            cancelCurrent?.();
            progress.close();
            showToast('Import cancelled', 'warning');
        });
    };
    openProgress();

    const addedDatasets = [];
    const errors = [];
    const importWarnings = [];
    let totalFeatures = 0;
    let totalNoGeometry = 0;
    let totalFenceFiltered = 0;
    let totalFeatureFiltered = 0;

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
                featureFilter,
                ...(adaptiveStoredLimit != null ? { maxFeatures: adaptiveStoredLimit } : {}),
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
                    // Projected CSV / shapefile — ask for the source CRS, then retry with
                    // in-worker reprojection. The progress modal closes first
                    // so it cannot block the CRS dialog.
                    const needsCrs = e?.code === 'PROJECTED_CSV_NEEDS_CRS'
                        || e?.code === 'PROJECTED_SHAPEFILE_NEEDS_CRS';
                    if (!needsCrs || userCancelled) throw e;
                    progress.close();
                    const sourceCrs = e.code === 'PROJECTED_SHAPEFILE_NEEDS_CRS'
                        ? await _promptShapefileSourceCrs(file)
                        : await _promptCsvSourceCrs(file);
                    if (userCancelled) throw Object.assign(new Error('Import cancelled'), { cancelled: true });
                    if (!sourceCrs) throw e;
                    openProgress();
                    job = startJob({ sourceCrs });
                    cancelCurrent = job.cancel;
                    result = await job.promise;
                }
                const { datasets, stats } = result;
                cancelCurrent = null;

                if (datasets.length >= 2) {
                    createImportGroupForDatasets(datasets);
                }
                const registered = [];
                try {
                    for (const ds of datasets) {
                        // Register for rollback before styling / map wiring so a
                        // mid-registration failure still cleans workspace + OPFS.
                        addedDatasets.push(ds);
                        registered.push(ds);
                        addLayer(ds, { activate: true });
                        const layerIdx = getLayers().indexOf(ds);
                        applyImportLayerStyles(ds, { mapService, getLayers, layerIndex: layerIdx });
                        await mapService.addWorkspaceLayer(ds, layerIdx, { fit: false });
                    }
                } catch (regErr) {
                    for (const ds of registered) {
                        const idx = addedDatasets.indexOf(ds);
                        if (idx >= 0) addedDatasets.splice(idx, 1);
                    }
                    await _rollbackStreamedLayers(registered);
                    throw regErr;
                }

                totalFeatures += stats.featureCount || 0;
                totalNoGeometry += stats.noGeometryCount || 0;
                totalFenceFiltered += stats.fenceFiltered || 0;
                totalFeatureFiltered += stats.featureFiltered || 0;
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
            const filterNote = totalFeatureFiltered > 0
                ? ` (${totalFeatureFiltered.toLocaleString()} features excluded by filter)`
                : '';
            showToast(
                `Imported ${totalFeatures.toLocaleString()} features into ${addedDatasets.length} ${layerWord}${fenceNote}${filterNote}`,
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

/**
 * Offer to resume or discard interrupted streaming imports (crash / tab-close).
 * Explicit Cancel still rolls back and does not leave checkpoints.
 * @param {{ refreshUI?: () => void }} [options]
 */
export async function promptInterruptedImports(options = {}) {
    let interrupted = [];
    try {
        interrupted = await listInterruptedCheckpoints();
    } catch (err) {
        logger.warn('Import', 'Failed to list import checkpoints', { message: err?.message });
        return;
    }
    if (!interrupted.length) return;

    for (const checkpoint of interrupted) {
        const pct = checkpoint.totalBytes
            ? Math.round((checkpoint.bytesProcessed / checkpoint.totalBytes) * 100)
            : null;
        const progressBit = pct != null ? ` (~${pct}% written)` : '';
        const featureBit = checkpoint.skipFeatures
            ? ` ${checkpoint.skipFeatures.toLocaleString()} features already stored.`
            : '';
        const ok = await confirm(
            'Resume interrupted import?',
            `"${checkpoint.fileName || 'Large file'}" was interrupted${progressBit}.${featureBit} Confirm resumes from the preserved source. Cancel discards the partial import.`
        );
        if (!ok) {
            try {
                await discardImportCheckpoint(checkpoint);
                showToast(`Discarded interrupted import of ${checkpoint.fileName || 'file'}`, 'info');
            } catch (err) {
                showErrorToast(handleError(err, 'Import', 'Discard interrupted import'));
            }
            continue;
        }

        let progress = null;
        try {
            progress = showProgressModal('Resuming Import');
            let cancelCurrent = null;
            let userCancelled = false;
            progress.onCancel(() => {
                userCancelled = true;
                cancelCurrent?.();
                progress.close();
                showToast('Resume cancelled', 'warning');
            });
            const job = await resumeStreamImportFromCheckpoint(checkpoint, {
                onProgress: (percent, step) => {
                    progress.update(percent, step, {
                        fileName: checkpoint.fileName,
                        fileSize: checkpoint.fileSize
                    });
                }
            });
            // resumeStreamImportFromCheckpoint returns { promise, cancel } from streamImportFile
            cancelCurrent = job.cancel;
            const result = await job.promise;
            if (userCancelled) continue;
            progress.close();

            const { datasets } = result;
            if (datasets.length >= 2) {
                createImportGroupForDatasets(datasets);
            }
            for (const ds of datasets) {
                addLayer(ds, { activate: true });
                const layerIdx = getLayers().indexOf(ds);
                applyImportLayerStyles(ds, { mapService, getLayers, layerIndex: layerIdx });
                await mapService.addWorkspaceLayer(ds, layerIdx, { fit: false });
            }
            options.refreshUI?.();
            showToast(
                `Resumed import: ${datasets.map((d) => d.name).join(', ')}`,
                'success'
            );
        } catch (err) {
            progress?.close();
            if (err?.cancelled) continue;
            showErrorToast(handleError(err, 'Import', 'Resume interrupted import'));
        }
    }
}

export default { runStreamingImportFlow, promptInterruptedImports };
