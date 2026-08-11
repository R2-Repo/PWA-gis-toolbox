import { useEffect, useRef, useState } from 'react';

import {
    preflightFiles,
    formatBytes,
    preflightFile,
    PREFLIGHT_LEVEL
} from '../../js/import/import-preflight.js';
import { scanFilesForImport } from '../../js/import/import-scan.js';
import { mergeScanFieldNames } from '../../js/import/import-field-filter.js';
import { detectFormat } from '../../js/import/importer.js';
import { assessImportRoute, assessImportRouteFromScans } from '../../js/import/import-routing.js';
import { isProjectKitFile } from '../../js/core/project-kit.js';
import { ImportFieldSelector } from './ImportFieldSelector.jsx';
import { ImportOptionCard } from './ImportOptionCard.jsx';
import { ImportProgressPanel } from './ImportProgressPanel.jsx';
import { LiveLayerCatalogPicker } from './LiveLayerCatalogPicker.jsx';
import { ImportFeatureFilterPanel } from './ImportFeatureFilterPanel.jsx';
import { useFeatureFilterState, useImportValueScan } from './useImportValueScan.js';
import { hasActiveFeatureFilter, validateFeatureFilter } from '../../js/import/import-feature-filter.js';
import { STORED_FEATURE_LIMIT } from '../../js/import/import-admission.js';
import { useImportStoreEstimate } from './useImportStoreEstimate.js';
import { ImportFencePlaceControl } from './ImportFencePlaceControl.jsx';

const LOCAL_FILE_ACCEPT = '.geojson,.json,.csv,.tsv,.txt,.xlsx,.xls,.kml,.kmz,.gpx,.zip,.xml,.gis-toolbox,.gtbx';

export function ImportFlowDialog({
    onCancel,
    onImportFiles,
    onOpenArcGIS,
    onOpenPhotoMapper,
    onOpenFence,
    onClearFence = null,
    onOpenProjectKit,
    onOpenDraw,
    catalogLiveLayers = [],
    onAddCatalogLiveLayer,
    onOptimizeImport,
    onStreamImport = null,
    hasActiveFence = false,
    fenceBbox = null,
    initialFiles = null,
    initialScans = null,
    initialSelectedFields = null,
    initialFeatureFilter = null,
    startAtFieldPick = false
}) {
    void initialScans;
    const fileInputRef = useRef(null);
    const cancelImportRef = useRef(null);
    const [localDragOver, setLocalDragOver] = useState(false);
    const [kitDragOver, setKitDragOver] = useState(false);
    const [error, setError] = useState('');
    const [pendingFiles, setPendingFiles] = useState([]);
    const [scanning, setScanning] = useState(false);
    const [fieldNames, setFieldNames] = useState([]);
    const [selectedFields, setSelectedFields] = useState([]);
    const [importScans, setImportScans] = useState([]);
    const [routeAssessment, setRouteAssessment] = useState(null);
    const [streamFiles, setStreamFiles] = useState([]);
    const [streamEstimate, setStreamEstimate] = useState(null);
    const [readyToImport, setReadyToImport] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importProgress, setImportProgress] = useState({ percent: 0, step: 'Starting import…' });
    const [importView, setImportView] = useState('chooser');
    const { featureFilter, setFeatureFilter, resetFeatureFilter } = useFeatureFilterState();
    const [fenceActive, setFenceActive] = useState(hasActiveFence === true);

    useEffect(() => {
        setFenceActive(hasActiveFence === true);
    }, [hasActiveFence]);

    const valueScan = useImportValueScan({
        files: pendingFiles,
        fieldNames,
        enabled: readyToImport && fieldNames.length > 0 && !importing
    });

    const storeEstimate = useImportStoreEstimate({
        files: pendingFiles,
        fieldNames,
        selectedFields,
        featureFilter,
        totalFeatureEstimate: streamEstimate
            ?? valueScan.valueCatalog?.rowCount
            ?? null,
        hasFence: fenceActive === true,
        fenceBbox: Array.isArray(fenceBbox) ? fenceBbox : null,
        enabled: readyToImport && streamFiles.length > 0 && !importing
    });

    /** Large-file stream path: unlock unless we know stored features exceed the soft ceiling. */
    const streamImportReady = streamFiles.length === 0 || storeEstimate.readyToImport;

    const resetImportStep = () => {
        setReadyToImport(false);
        setFieldNames([]);
        setSelectedFields([]);
        setImportScans([]);
        setRouteAssessment(null);
        setStreamFiles([]);
        setStreamEstimate(null);
        setScanning(false);
        setImporting(false);
        setImportProgress({ percent: 0, step: 'Starting import…' });
        cancelImportRef.current = null;
        resetFeatureFilter();
    };

    const backToChooser = () => {
        setImportView('chooser');
        setPendingFiles([]);
        setError('');
        setLocalDragOver(false);
        resetImportStep();
    };

    const openLocalFilesScreen = () => {
        setError('');
        setImportView('localFiles');
        setLocalDragOver(false);
    };

    const openLocalFilePicker = () => {
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
            fileInputRef.current.click();
        }
    };

    const localFilesDropHandlers = {
        onDragEnter: (e) => {
            preventDragDefaults(e);
            setLocalDragOver(true);
        },
        onDragOver: (e) => {
            preventDragDefaults(e);
            setLocalDragOver(true);
        },
        onDragLeave: (e) => {
            preventDragDefaults(e);
            setLocalDragOver(false);
        },
        onDrop: (e) => {
            preventDragDefaults(e);
            setLocalDragOver(false);
            void handleFiles(e.dataTransfer?.files);
        }
    };

    const runPreflight = (fileList) => {
        const files = Array.from(fileList || []);
        setPendingFiles(files);
        resetImportStep();
        return files;
    };

    const applyScans = (files, scans) => {
        setImportScans(scans);
        const names = mergeScanFieldNames(scans);
        setFieldNames(names);
        setSelectedFields(names);
        setRouteAssessment(assessImportRouteFromScans(scans));
        setReadyToImport(true);
    };

    const startImport = async (files, importOptions = {}, uiFromParent = null) => {
        if (!files?.length) return;

        const fields = importOptions.selectedFields ?? selectedFields;
        if (fieldNames.length > 0 && (!fields || fields.length === 0)) {
            setError('Select at least one field to import.');
            return;
        }

        const filterError = validateFeatureFilter(featureFilter);
        if (filterError) {
            setError(filterError);
            return;
        }

        const activeFeatureFilter = hasActiveFeatureFilter(featureFilter) ? featureFilter : null;

        // Streaming path — only block when estimate is known over the soft ceiling.
        if (streamFiles.length > 0 && onStreamImport) {
            if (!storeEstimate.readyToImport) {
                setError(
                    storeEstimate.blockReason
                    || `Estimated features are over the ${(storeEstimate.estimate?.limitFeatures ?? STORED_FEATURE_LIMIT).toLocaleString()} stored-feature limit. Tighten your filter or fence.`
                );
                return;
            }
            const fieldsReduced = fieldNames.length > 0
                && fields?.length > 0
                && fields.length < fieldNames.length;
            onStreamImport(files, {
                selectedFields: fieldsReduced ? fields : null,
                featureFilter: activeFeatureFilter,
                allowStreamImport: true
            });
            return;
        }

        const check = preflightFiles(files);
        if (check.reject) {
            setError(check.messages.join(' '));
            return;
        }

        setError('');
        const fileList = Array.from(files);
        const kitOnly = fileList.length > 0 && fileList.every(isProjectKitFile);

        if (kitOnly) {
            try {
                await onImportFiles?.(fileList, {
                    preflightConfirmed: true,
                    selectedFields: fieldNames.length ? fields : null,
                    useWorkspace: importOptions.useWorkspace ?? routeAssessment?.useWorkspace,
                    ...importOptions
                }, {
                    onComplete: () => onCancel?.(),
                    onAborted: () => {}
                });
            } catch (err) {
                setError(err?.message || 'Unable to import project file.');
            }
            return;
        }

        setImporting(true);
        setImportProgress({ percent: 0, step: 'Starting import…' });

        const ui = uiFromParent || {
            onProgress: (p) => setImportProgress(p),
            onCancelReady: (fn) => { cancelImportRef.current = fn; },
            close: () => onCancel?.(),
            onAborted: () => setImporting(false)
        };

        try {
            await onImportFiles?.(files, {
                preflightConfirmed: true,
                selectedFields: fieldNames.length ? fields : null,
                useWorkspace: importOptions.useWorkspace ?? routeAssessment?.useWorkspace,
                featureFilter: activeFeatureFilter,
                ...importOptions
            }, {
                ...ui,
                onAborted: ui.onAborted || (() => setImporting(false))
            });
        } catch (err) {
            setImporting(false);
            setError(err?.message || 'Unable to start import.');
        }
    };

    const prepareImportOptions = async (files, existingScans = null) => {
        setScanning(true);
        setError('');
        try {
            const scans = existingScans ?? await scanFilesForImport(files);
            applyScans(files, scans);
        } catch (err) {
            setError(err?.message || 'Could not scan files.');
            setReadyToImport(true);
        } finally {
            setScanning(false);
        }
    };

    const handleFiles = async (fileList) => {
        const files = runPreflight(fileList);
        if (files.length === 0) return;

        // Leave the empty Local Files setup screen immediately (picker + drag-drop).
        setScanning(true);
        setError('');

        // Large streamable files use streaming import — field pick, not a size error.
        if (onStreamImport) {
            try {
                const { partitionStreamingFiles } = await import('../../js/import/stream/stream-policy.js');
                const partition = await partitionStreamingFiles(files);
                if (partition.rejectedFiles.length) {
                    setScanning(false);
                    setPendingFiles([]);
                    setError(partition.rejectedFiles.map((r) => r.message).join(' '));
                    return;
                }
                if (partition.streamFiles.length) {
                    setStreamFiles(partition.streamFiles);
                    let scans = [];
                    try {
                        scans = await scanFilesForImport(files);
                    } catch {
                        /* head-only sniffing failed — import all fields */
                    }
                    setScanning(false);
                    setImportScans(scans);
                    const streamNames = new Set(partition.streamFiles.map((f) => f.name));
                    const estimate = scans
                        .filter((s) => streamNames.has(s.fileName) && s.featureEstimate)
                        .reduce((sum, s) => sum + s.featureEstimate, 0);
                    setStreamEstimate(estimate > 0 ? estimate : null);
                    const names = mergeScanFieldNames(scans);
                    setFieldNames(names);
                    setSelectedFields(names);
                    setRouteAssessment(null);
                    setReadyToImport(true);
                    return;
                }
            } catch {
                /* fall through to the standard flow */
            }
        }

        const check = preflightFiles(files);
        if (check.reject) {
            setScanning(false);
            setPendingFiles([]);
            setError(check.messages.join(' '));
            return;
        }

        if (files.every(isProjectKitFile)) {
            setScanning(false);
            setReadyToImport(true);
            setFieldNames([]);
            setSelectedFields([]);
            setRouteAssessment(null);
            return;
        }

        const shouldPreScan = files.some((f) => {
            const pf = preflightFile(f);
            const fmt = detectFormat(f);
            return pf.level === PREFLIGHT_LEVEL.SOFT || fmt === 'zip' || fmt === 'kmz';
        });

        let scans = [];
        if (shouldPreScan) {
            try {
                scans = await scanFilesForImport(files);
            } catch (err) {
                setScanning(false);
                setPendingFiles([]);
                setError(err?.message || 'Could not scan files.');
                return;
            }
        }

        const assessment = await assessImportRoute(files, { scans });
        if (assessment.route === 'optimizer' && onOptimizeImport) {
            setScanning(false);
            onOptimizeImport(files);
            return;
        }

        if (scans.length) {
            setScanning(false);
            applyScans(files, scans);
        } else {
            await prepareImportOptions(files);
        }
    };

    const handleKitDrop = (fileList) => {
        const files = Array.from(fileList || []).filter(isProjectKitFile);
        if (!files.length) {
            setError('Drop a .gis-toolbox or .gtbx file on this card.');
            return;
        }
        void handleFiles(files);
    };

    const preventDragDefaults = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    useEffect(() => {
        if (!startAtFieldPick || !initialFiles?.length) return;

        let cancelled = false;
        void (async () => {
            await handleFiles(initialFiles);
            if (cancelled) return;

            if (Array.isArray(initialSelectedFields) && initialSelectedFields.length) {
                setSelectedFields((prev) => {
                    if (!prev.length) return initialSelectedFields;
                    const allowed = new Set(prev);
                    const clipped = initialSelectedFields.filter((name) => allowed.has(name));
                    return clipped.length ? clipped : prev;
                });
            }

            if (initialFeatureFilter) {
                setFeatureFilter(initialFeatureFilter);
            }
        })();

        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap
    }, []);

    const isKitOnly = pendingFiles.length > 0 && pendingFiles.every(isProjectKitFile);
    const showChooser = !readyToImport && !startAtFieldPick && !importing && importView === 'chooser';
    // Empty Local Files setup only — hide as soon as files are chosen / scanning /
    // configure so drag-drop and file-picker both leave this screen cleanly.
    const showLocalFilesScreen = importView === 'localFiles'
        && !readyToImport
        && !startAtFieldPick
        && !importing
        && !scanning
        && pendingFiles.length === 0;

    if (importing) {
        return (
            <div>
                <ImportProgressPanel
                    step={importProgress.step}
                    percent={importProgress.percent}
                    fileName={importProgress.fileName}
                    onCancel={cancelImportRef.current ? () => cancelImportRef.current?.() : null}
                />
            </div>
        );
    }

    return (
        <div>
            {error ? (
                <div className="info-box text-xs mb-8" style={{ color: 'var(--danger)' }}>{error}</div>
            ) : null}

            {readyToImport && !scanning ? (
                <button type="button" className="btn btn-ghost btn-sm mb-8" onClick={backToChooser}>
                    ← Back
                </button>
            ) : null}

            {importView === 'liveLayers' ? (
                <button type="button" className="btn btn-ghost btn-sm mb-8" onClick={() => setImportView('chooser')}>
                    ← Back
                </button>
            ) : null}

            {showLocalFilesScreen ? (
                <button type="button" className="btn btn-ghost btn-sm mb-8" onClick={backToChooser}>
                    ← Back
                </button>
            ) : null}

            {pendingFiles.length > 0 ? (
                <ul className="text-xs text-muted mb-8" style={{ margin: '0 0 8px', paddingLeft: '18px' }}>
                    {pendingFiles.map((f) => (
                        <li key={`${f.name}-${f.size}`}>{f.name} ({formatBytes(f.size)})</li>
                    ))}
                </ul>
            ) : null}

            {scanning ? (
                <ImportProgressPanel step="Scanning attributes…" percent={0} />
            ) : null}

            {showLocalFilesScreen ? (
                <div className="mb-8">
                    <button
                        type="button"
                        className="btn btn-primary btn-sm mb-8"
                        onClick={openLocalFilePicker}
                    >
                        Add local file
                    </button>
                    <div
                        className={`import-option-card${localDragOver ? ' import-option-card--dragover' : ''}`}
                        role="button"
                        tabIndex={0}
                        style={{
                            cursor: 'pointer',
                            minHeight: 120,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            textAlign: 'center',
                            padding: 16
                        }}
                        onClick={openLocalFilePicker}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openLocalFilePicker();
                            }
                        }}
                        {...localFilesDropHandlers}
                    >
                        <div style={{ fontSize: 28, lineHeight: 1, marginBottom: 8 }}>📂</div>
                        <div className="text-xs" style={{ fontWeight: 600 }}>Drop files here</div>
                        <p className="text-xs text-muted" style={{ margin: '6px 0 0', maxWidth: 280 }}>
                            GeoJSON, CSV, Excel, KML, Shapefile, and other supported formats.
                        </p>
                    </div>
                </div>
            ) : null}

            {readyToImport && !scanning ? (
                <div className="mb-8">
                    {isKitOnly ? (
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => void startImport(pendingFiles, { preflightConfirmed: true })}
                        >
                            Import Toolbox project
                        </button>
                    ) : (
                        <>
                            <div className="text-xs mb-4"><strong>Attributes to import</strong></div>
                            <ImportFieldSelector
                                fields={fieldNames}
                                selected={selectedFields}
                                onChange={setSelectedFields}
                            />

                            {fieldNames.length > 0 || streamFiles.length > 0 ? (
                                <ImportFeatureFilterPanel
                                    fieldNames={fieldNames}
                                    valueCatalog={valueScan.valueCatalog}
                                    scanState={valueScan.scanState}
                                    scanProgress={valueScan.scanProgress}
                                    scanMessage={valueScan.scanMessage}
                                    onCancelScan={valueScan.cancelScan}
                                    onRetryScan={valueScan.retryScan}
                                    featureFilter={featureFilter}
                                    onChange={setFeatureFilter}
                                />
                            ) : null}

                            {streamFiles.length > 0 && onOpenFence ? (
                                <ImportFencePlaceControl
                                    hasActiveFence={fenceActive}
                                    disabled={scanning || valueScan.scanState === 'scanning'}
                                    onPlaceFence={() => onOpenFence?.({
                                        files: pendingFiles,
                                        scans: importScans,
                                        selectedFields,
                                        featureFilter: hasActiveFeatureFilter(featureFilter)
                                            ? featureFilter
                                            : null
                                    })}
                                    onClearFence={() => {
                                        onClearFence?.();
                                        setFenceActive(false);
                                    }}
                                />
                            ) : null}

                            <button
                                className="btn btn-primary btn-sm mt-8"
                                disabled={streamFiles.length > 0 ? !streamImportReady : false}
                                onClick={() => void startImport(pendingFiles, { selectedFields })}
                            >
                                Import selected
                            </button>
                        </>
                    )}
                </div>
            ) : null}

            {importView === 'liveLayers' ? (
                <LiveLayerCatalogPicker
                    layers={catalogLiveLayers}
                    onAddCatalogLiveLayer={onAddCatalogLiveLayer}
                />
            ) : null}

            {showChooser ? (
                <>
                    <div className="import-option-grid">
                        <ImportOptionCard
                            icon="📂"
                            title="Local Files"
                            description="GeoJSON, CSV, Excel, KML, Shapefile…"
                            className={localDragOver ? 'import-option-card--dragover' : ''}
                            onClick={openLocalFilesScreen}
                            {...localFilesDropHandlers}
                        />
                        <ImportOptionCard
                            icon="🌐"
                            title="ArcGIS REST"
                            description="Feature services & map layers"
                            onClick={() => onOpenArcGIS?.()}
                        />
                        <ImportOptionCard
                            icon="🗺️"
                            title="Live Layers"
                            description="Pre-styled live service layers"
                            onClick={() => setImportView('liveLayers')}
                        />
                        <ImportOptionCard
                            icon="📷"
                            title="Photo Mapper"
                            description="Geotag photos from EXIF"
                            onClick={() => onOpenPhotoMapper?.()}
                        />
                        <ImportOptionCard
                            icon="📦"
                            title="Toolbox Kit"
                            description=".gis-toolbox workspace file"
                            className={kitDragOver ? 'import-option-card--dragover' : ''}
                            onClick={() => onOpenProjectKit?.()}
                            onDragEnter={(e) => {
                                preventDragDefaults(e);
                                setKitDragOver(true);
                            }}
                            onDragOver={(e) => {
                                preventDragDefaults(e);
                                setKitDragOver(true);
                            }}
                            onDragLeave={(e) => {
                                preventDragDefaults(e);
                                setKitDragOver(false);
                            }}
                            onDrop={(e) => {
                                preventDragDefaults(e);
                                setKitDragOver(false);
                                handleKitDrop(e.dataTransfer?.files);
                            }}
                        />
                        <ImportOptionCard
                            icon="✏️"
                            title="Draw Layer"
                            description="Sketch points, lines, and polygons on the map"
                            onClick={() => onOpenDraw?.()}
                        />
                        <ImportOptionCard
                            icon="⛶"
                            title="Import Fence"
                            description="Only import features inside this area"
                            active={hasActiveFence}
                            badge={hasActiveFence ? 'Active' : null}
                            onClick={() => onOpenFence?.()}
                        />
                    </div>
                    <p className="import-option-hint">
                        Drag files onto Local Files or Toolbox Kit cards.
                    </p>
                </>
            ) : null}

            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={LOCAL_FILE_ACCEPT}
                style={{ display: 'none' }}
                onChange={(e) => {
                    void handleFiles(e.target.files);
                    e.target.value = '';
                }}
            />
        </div>
    );
}
