import { useEffect, useMemo, useRef, useState } from 'react';

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

import {

    buildNoticeForRoute,

    buildImportProgressReductionNotice,

    shouldShowImportProgressNotice

} from '../../js/import/import-size-notices.js';

import { isProjectKitFile } from '../../js/core/project-kit.js';

import { ImportFieldSelector } from './ImportFieldSelector.jsx';

import { ImportOptionCard } from './ImportOptionCard.jsx';

import { ImportProgressPanel } from './ImportProgressPanel.jsx';

import { ImportReductionNotice } from './ImportReductionNotice.jsx';

import { LiveLayerCatalogPicker } from './LiveLayerCatalogPicker.jsx';

import { ImportFeatureFilterPanel } from './ImportFeatureFilterPanel.jsx';

import { useFeatureFilterState, useImportValueScan } from './useImportValueScan.js';

import { hasActiveFeatureFilter, validateFeatureFilter } from '../../js/import/import-feature-filter.js';
import { largeFileBannerText, kmlGisModeNote } from '../../js/import/import-limit-copy.js';
import { STORED_FEATURE_LIMIT } from '../../js/import/import-admission.js';
import { ImportEstimateGauge } from './ImportEstimateGauge.jsx';
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

    const fileInputRef = useRef(null);

    const cancelImportRef = useRef(null);

    const [localDragOver, setLocalDragOver] = useState(false);

    const [kitDragOver, setKitDragOver] = useState(false);

    const [error, setError] = useState('');

    const [pendingFiles, setPendingFiles] = useState([]);

    const [preflight, setPreflight] = useState(null);

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

    /** Large-file stream path: unlock when estimated stored features ≤ 250k. */
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

        setPreflight(null);

        setError('');

        resetImportStep();

    };



    const runPreflight = (fileList) => {

        const files = Array.from(fileList || []);

        setPendingFiles(files);

        setPreflight(files.length ? preflightFiles(files) : null);

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

        setPreflight(preflightFiles(files));

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

        // Streaming path — dialog already gated on readyToImport (~1M stored soft ceiling).
        if (streamFiles.length > 0 && onStreamImport) {
            if (!storeEstimate.readyToImport) {
                setError(
                    storeEstimate.blockReason
                    || `Estimated features are still over the ${STORED_FEATURE_LIMIT.toLocaleString()} stored-feature limit. Tighten your filter or fence.`
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

        // Large streamable files (GeoJSON/CSV/KML/KMZ) use the high-capacity
        // streaming import — show a notice + field pick instead of a size error.
        if (onStreamImport) {
            try {
                const { partitionStreamingFiles } = await import('../../js/import/stream/stream-policy.js');
                const partition = await partitionStreamingFiles(files);
                if (partition.rejectedFiles.length) {
                    setError(partition.rejectedFiles.map((r) => r.message).join(' '));
                    // Avoid stacking the standard 6 MB text-reject under the stream ceiling message.
                    setPreflight(null);
                    return;
                }
                if (partition.streamFiles.length) {
                    setStreamFiles(partition.streamFiles);
                    // Only surface preflight warnings for the non-streamed files.
                    setPreflight(partition.standardFiles.length ? preflightFiles(partition.standardFiles) : null);
                    setScanning(true);
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

            setError(check.messages.join(' '));

            return;

        }



        if (files.every(isProjectKitFile)) {

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

            setScanning(true);

            try {

                scans = await scanFilesForImport(files);

            } catch (err) {

                setScanning(false);

                setError(err?.message || 'Could not scan files.');

                return;

            }

            setScanning(false);

        }



        const assessment = await assessImportRoute(files, { scans });

        if (assessment.route === 'optimizer' && onOptimizeImport) {

            onOptimizeImport(files);

            return;

        }



        if (scans.length) {

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



    const reductionNotice = useMemo(() => {

        if (!routeAssessment || routeAssessment.route !== 'optimizer') return null;

        return buildNoticeForRoute({ ...routeAssessment, scans: importScans });

    }, [routeAssessment, importScans]);



    const showProgressNotice = shouldShowImportProgressNotice(routeAssessment);

    const isKitOnly = pendingFiles.length > 0 && pendingFiles.every(isProjectKitFile);

    const showChooser = !readyToImport && !startAtFieldPick && !importing && importView === 'chooser';



    if (importing) {

        return (

            <div>

                <ImportProgressPanel

                    step={importProgress.step}

                    percent={importProgress.percent}

                    fileName={importProgress.fileName}

                    notice={showProgressNotice ? buildImportProgressReductionNotice() : null}

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



            {preflight?.messages?.length ? (

                <div

                    className="info-box text-xs mb-8"

                    style={{ color: preflight.reject ? 'var(--danger)' : 'var(--warning, orange)' }}

                >

                    {preflight.messages.map((msg) => (

                        <div key={msg}>{msg}</div>

                    ))}

                </div>

            ) : null}

            {streamFiles.length > 0 ? (

                <div
                    className="info-box text-xs mb-8"
                    style={{ color: streamImportReady ? 'var(--success, #2a7a3a)' : 'var(--danger)' }}
                >

                    {largeFileBannerText({
                        fileName: streamFiles[0]?.name,
                        fileCount: streamFiles.length,
                        sourceBytes: streamFiles.length === 1 ? streamFiles[0].size : 0,
                        featureEstimate: streamEstimate
                    })}
                    {kmlGisModeNote(streamFiles.some((f) => /\.(kml|kmz)$/i.test(f.name)))}

                </div>

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



            {readyToImport && !scanning ? (

                <div className="mb-8">

                    {isKitOnly ? (

                        <>

                            <p className="text-xs text-muted mb-8">

                                Toolbox project file — choose sections and replace or merge on the next screen.

                            </p>

                            <button

                                className="btn btn-primary btn-sm"

                                onClick={() => void startImport(pendingFiles, { preflightConfirmed: true })}

                            >

                                Import Toolbox project

                            </button>

                        </>

                    ) : (

                        <>

                            {reductionNotice ? (

                                <ImportReductionNotice {...reductionNotice} />

                            ) : null}

                            <div className="text-xs mb-4"><strong>Attributes to import</strong></div>

                            <ImportFieldSelector

                                fields={fieldNames}

                                selected={selectedFields}

                                onChange={setSelectedFields}

                                hint={reductionNotice

                                    ? 'Uncheck fields you do not need — only selected attributes are stored (part of the size reduction plan).'

                                    : 'Uncheck fields you do not need — deselected attributes are not stored.'}

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

                            {streamFiles.length > 0 ? (
                                <ImportEstimateGauge
                                    estimate={storeEstimate.estimate}
                                    estimateState={storeEstimate.estimateState}
                                    estimateProgress={storeEstimate.estimateProgress}
                                    estimateMessage={storeEstimate.estimateMessage}
                                    waitingOnRecount={storeEstimate.waitingOnRecount}
                                    readyToImport={storeEstimate.readyToImport}
                                    blockReason={storeEstimate.blockReason}
                                    sourceBytes={storeEstimate.estimate?.sourceBytes || pendingFiles[0]?.size || 0}
                                />
                            ) : null}

                            {streamFiles.length > 0 && !streamImportReady ? (
                                <p className="text-xs mt-8" style={{ color: 'var(--danger)' }}>
                                    {storeEstimate.blockReason
                                        || `Tighten filters or place a fence until stored features are ≤ ${STORED_FEATURE_LIMIT.toLocaleString()}.`}
                                </p>
                            ) : null}

                            <button

                                className="btn btn-primary btn-sm mt-8"

                                disabled={streamFiles.length > 0 ? !streamImportReady : false}

                                title={streamFiles.length > 0 && !streamImportReady
                                    ? (storeEstimate.blockReason || `Wait until the estimate is within the ${STORED_FEATURE_LIMIT.toLocaleString()} feature limit`)
                                    : undefined}

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

                            onClick={() => fileInputRef.current?.click()}

                            onDragEnter={(e) => {

                                preventDragDefaults(e);

                                setLocalDragOver(true);

                            }}

                            onDragOver={(e) => {

                                preventDragDefaults(e);

                                setLocalDragOver(true);

                            }}

                            onDragLeave={(e) => {

                                preventDragDefaults(e);

                                setLocalDragOver(false);

                            }}

                            onDrop={(e) => {

                                preventDragDefaults(e);

                                setLocalDragOver(false);

                                void handleFiles(e.dataTransfer?.files);

                            }}

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

                    <input

                        ref={fileInputRef}

                        type="file"

                        multiple

                        accept={LOCAL_FILE_ACCEPT}

                        style={{ display: 'none' }}

                        onChange={(e) => void handleFiles(e.target.files)}

                    />

                </>

            ) : null}

        </div>

    );

}

