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



const LOCAL_FILE_ACCEPT = '.geojson,.json,.csv,.tsv,.txt,.xlsx,.xls,.kml,.kmz,.gpx,.zip,.xml,.gis-toolbox,.gtbx,.tif,.tiff,.gpkg,.shp,.parquet';

export function ImportFlowDialog({

    onCancel,

    onImportFiles,

    onOpenArcGIS,

    onOpenPhotoMapper,

    onOpenFence,

    onOpenProjectKit,

    onOpenDraw,

    catalogLiveLayers = [],

    onAddCatalogLiveLayer,

    onOptimizeImport,

    onStreamImport = null,

    hasActiveFence = false,

    initialFiles = null,

    initialScans = null,

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

    const [readyToImport, setReadyToImport] = useState(false);

    const [importing, setImporting] = useState(false);

    const [importProgress, setImportProgress] = useState({ percent: 0, step: 'Starting import…' });

    const [importView, setImportView] = useState('chooser');



    const resetImportStep = () => {

        setReadyToImport(false);

        setFieldNames([]);

        setSelectedFields([]);

        setImportScans([]);

        setRouteAssessment(null);

        setScanning(false);

        setImporting(false);

        setImportProgress({ percent: 0, step: 'Starting import…' });

        cancelImportRef.current = null;

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

        const check = preflightFiles(files);

        if (check.reject) {

            setError(check.messages.join(' '));

            return;

        }

        const fields = importOptions.selectedFields ?? selectedFields;

        if (fieldNames.length > 0 && (!fields || fields.length === 0)) {

            setError('Select at least one field to import.');

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

        // Large streamable files (GeoJSON/CSV) bypass the standard dialog flow
        // and use the high-capacity streaming import instead.
        if (onStreamImport) {
            try {
                const { partitionStreamingFiles } = await import('../../js/import/stream/stream-policy.js');
                const { streamFiles } = await partitionStreamingFiles(files);
                if (streamFiles.length) {
                    onStreamImport(files);
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

        const files = Array.from(initialFiles);

        setPendingFiles(files);

        setPreflight(preflightFiles(files));

        if (initialScans?.length) {

            applyScans(files, initialScans);

        } else {

            void prepareImportOptions(files);

        }

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

                            <button

                                className="btn btn-primary btn-sm mt-8"

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

