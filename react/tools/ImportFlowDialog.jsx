import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
    preflightFiles,
    formatBytes
} from '../../js/import/import-preflight.js';
import { scanFilesForImport } from '../../js/import/import-scan.js';
import { mergeScanFieldNames } from '../../js/import/import-field-filter.js';
import { assessImportRouteFromScans } from '../../js/import/import-routing.js';
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
import { predictImportDisplayMode } from '../../js/import/predict-import-display-mode.js';

const LOCAL_FILE_ACCEPT = '.geojson,.json,.csv,.tsv,.txt,.xlsx,.xls,.kml,.kmz,.gpx,.zip,.xml,.gis-toolbox,.gtbx';

const IMPORT_DISPLAY_MODE_CARDS = [
    {
        id: 'memory',
        sizeLabel: 'Smaller Files/Geometry',
        title: 'Memory',
        shortDesc: 'Map shows the whole layer at once.',
        icon: '/icons/import-mode-memory.png',
        infoTitle: 'In-memory display',
        infoSummary:
            'Smaller layers stay in browser memory and draw as a normal GeoJSON map source — the whole feature set is available to the renderer at once.',
        infoDetails: [
            'Best for modest feature counts and simpler geometry.',
            'Identify, select, and style behave like a standard GIS layer.',
            'Larger or denser layers may switch to Viewport or Tiled so the browser stays responsive.'
        ]
    },
    {
        id: 'viewport',
        sizeLabel: 'Larger Files/Geometry',
        title: 'Viewport',
        shortDesc: "Map shows what's in your current view.",
        icon: '/icons/import-mode-viewport.png',
        infoTitle: 'Viewport display',
        infoSummary:
            'The full layer is stored on this device (workspace / IndexedDB). The map draws features that intersect the current view, up to a render cap, then updates as you pan and zoom.',
        infoDetails: [
            'Features outside the view stay in the layer — they appear when you move the map.',
            'In dense views, features nearer the center of the screen are preferred before edge features, with even spatial sampling inside the draw cap.',
            'Very dense views may still omit some intersecting features so drawing stays fast; zoom in or export for the complete set.',
            'Click, identify, and box-select work from the full workspace store; cyan highlights load selected geometries on demand.',
            'Export still includes the full layer.'
        ]
    },
    {
        id: 'tiled',
        sizeLabel: 'Very large Files/Geometry',
        title: 'Tiled',
        shortDesc: 'Map draws with optimized local vector tiles.',
        icon: '/icons/import-mode-tiled.png',
        infoTitle: 'Optimized tile display',
        infoSummary:
            'The full layer is stored on this device. The map draws it with local vector tiles so large geometry stays visible without loading every feature into memory at once.',
        infoDetails: [
            'Tiles are built from your workspace data — not a remote tile service.',
            'At far zoom, dense tiles may thin some features so the map stays fast; zoom in for denser detail.',
            'Click, identify, and box-select work from the full workspace store; cyan highlights load selected geometries on demand.',
            'Export still includes the full layer.'
        ]
    }
];

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
    const [importView, setImportView] = useState(startAtFieldPick ? 'localFiles' : 'chooser');
    const [openModeInfoId, setOpenModeInfoId] = useState(null);
    const [modeInfoPos, setModeInfoPos] = useState(null);
    const modeExplainerRef = useRef(null);
    const modeInfoPopoverRef = useRef(null);
    const modeInfoBtnRefs = useRef({});
    const { featureFilter, setFeatureFilter, resetFeatureFilter } = useFeatureFilterState();
    const [fenceActive, setFenceActive] = useState(hasActiveFence === true);

    useEffect(() => {
        setFenceActive(hasActiveFence === true);
    }, [hasActiveFence]);

    const openModeCard = IMPORT_DISPLAY_MODE_CARDS.find((card) => card.id === openModeInfoId) || null;

    useLayoutEffect(() => {
        if (!openModeCard) {
            setModeInfoPos(null);
            return undefined;
        }
        const place = () => {
            const btn = modeInfoBtnRefs.current[openModeCard.id];
            const pop = modeInfoPopoverRef.current;
            if (!btn || !pop) return;
            const btnRect = btn.getBoundingClientRect();
            const popRect = pop.getBoundingClientRect();
            const width = Math.min(300, window.innerWidth - 16);
            let left = btnRect.right - width;
            left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
            let top = btnRect.top - popRect.height - 8;
            if (top < 8) top = Math.min(btnRect.bottom + 8, window.innerHeight - popRect.height - 8);
            setModeInfoPos({ top, left, width });
        };
        place();
        // Re-measure after first paint once popover has content size.
        const raf = requestAnimationFrame(place);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [openModeCard]);

    useEffect(() => {
        if (!openModeInfoId) return undefined;
        const onPointerDown = (e) => {
            const target = e.target;
            if (modeExplainerRef.current?.contains(target)) return;
            if (modeInfoPopoverRef.current?.contains(target)) return;
            setOpenModeInfoId(null);
        };
        const onKeyDown = (e) => {
            if (e.key === 'Escape') setOpenModeInfoId(null);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [openModeInfoId]);

    const valueScan = useImportValueScan({
        files: pendingFiles,
        fieldNames,
        enabled: readyToImport && fieldNames.length > 0 && !importing
    });

    const scanFeatureEstimate = useMemo(() => {
        const fromScans = importScans
            .map((s) => s?.featureEstimate)
            .filter((n) => n != null && Number.isFinite(n) && n > 0);
        const scanSum = fromScans.length
            ? fromScans.reduce((sum, n) => sum + n, 0)
            : null;
        return streamEstimate
            ?? scanSum
            ?? valueScan.valueCatalog?.rowCount
            ?? null;
    }, [importScans, streamEstimate, valueScan.valueCatalog?.rowCount]);

    const scanCoordinateEstimate = useMemo(() => {
        const fromScans = importScans
            .map((s) => s?.coordinateEstimate)
            .filter((n) => n != null && Number.isFinite(n) && n > 0);
        if (!fromScans.length) return null;
        return fromScans.reduce((sum, n) => sum + n, 0);
    }, [importScans]);

    const storeEstimate = useImportStoreEstimate({
        files: pendingFiles,
        fieldNames,
        selectedFields,
        featureFilter,
        totalFeatureEstimate: scanFeatureEstimate,
        hasFence: fenceActive === true,
        fenceBbox: Array.isArray(fenceBbox) ? fenceBbox : null,
        enabled: readyToImport && pendingFiles.length > 0 && !importing
    });

    /** Stream / optimizer files stay in this dialog — unlock unless stored features exceed the soft ceiling. */
    const needsLargeFileControls = streamFiles.length > 0 || routeAssessment?.route === 'optimizer';
    const configureImportReady = !needsLargeFileControls || storeEstimate.readyToImport;

    const predictedDisplayMode = useMemo(() => {
        if (!readyToImport || scanning || importing || !pendingFiles.length) return null;
        if (storeEstimate.waitingOnRecount) return null;
        const featureEstimate = storeEstimate.estimate?.estimatedFeatures ?? scanFeatureEstimate;
        if (featureEstimate == null && streamFiles.length === 0) return null;
        // Scale coordinate estimate with filter ratio when we have both totals.
        let coordinateEstimate = scanCoordinateEstimate;
        if (
            coordinateEstimate != null
            && scanFeatureEstimate != null
            && scanFeatureEstimate > 0
            && featureEstimate != null
        ) {
            coordinateEstimate = coordinateEstimate * (featureEstimate / scanFeatureEstimate);
        }
        return predictImportDisplayMode({
            featureEstimate,
            coordinateEstimate,
            forceWorkspace: streamFiles.length > 0 || routeAssessment?.useWorkspace === true
        });
    }, [
        readyToImport,
        scanning,
        importing,
        pendingFiles.length,
        storeEstimate.waitingOnRecount,
        storeEstimate.estimate?.estimatedFeatures,
        scanFeatureEstimate,
        scanCoordinateEstimate,
        streamFiles.length,
        routeAssessment?.useWorkspace
    ]);

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
        setOpenModeInfoId(null);
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
            setImportView('localFiles');
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

        if (needsLargeFileControls && !storeEstimate.readyToImport) {
            setError(
                storeEstimate.blockReason
                || `Estimated features are over the ${(storeEstimate.estimate?.limitFeatures ?? STORED_FEATURE_LIMIT).toLocaleString()} stored-feature limit. Tighten your filter or fence.`
            );
            return;
        }

        // Streaming path — confirmed in this dialog; parent runs the worker.
        if (streamFiles.length > 0 && onStreamImport) {
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

        // Stay on Local Files setup; configure appears below the mode cards.
        setImportView('localFiles');
        setOpenModeInfoId(null);
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

        await prepareImportOptions(files);
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
    // Local Files setup stays open after a file is chosen; configure appears below the mode cards.
    const showLocalFilesScreen = importView === 'localFiles' && !importing;
    const showLocalFilesConfigure = showLocalFilesScreen && readyToImport && !scanning;

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

            {showLocalFilesScreen ? (
                <div className="mb-8">
                    <div className="import-local-howto">
                        <div className="import-local-howto__title">How local file import works</div>
                        <ol className="import-local-howto__steps">
                            <li className="import-local-howto__step">
                                <span className="import-local-howto__num" aria-hidden="true">1</span>
                                <span className="import-local-howto__copy">
                                    <strong>Add local file</strong>
                                    <span>Choose or drop a GIS file from your device.</span>
                                </span>
                            </li>
                            <li className="import-local-howto__step">
                                <span className="import-local-howto__num" aria-hidden="true">2</span>
                                <span className="import-local-howto__copy">
                                    <strong>Optional filters</strong>
                                    <span>Pick attributes, filter features, or place an import fence.</span>
                                </span>
                            </li>
                            <li className="import-local-howto__step">
                                <span className="import-local-howto__num" aria-hidden="true">3</span>
                                <span className="import-local-howto__copy">
                                    <strong>Add to map</strong>
                                    <span>Import the layer and draw it on the map.</span>
                                </span>
                            </li>
                        </ol>
                    </div>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm mb-8"
                        onClick={openLocalFilePicker}
                    >
                        Add local file
                    </button>
                    <div
                        className={`import-local-drop${localDragOver ? ' import-option-card--dragover' : ''}${pendingFiles.length ? ' import-local-drop--filled' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={openLocalFilePicker}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openLocalFilePicker();
                            }
                        }}
                        {...localFilesDropHandlers}
                    >
                        {pendingFiles.length > 0 ? (
                            <>
                                <div className="import-local-drop__icon" aria-hidden="true">📄</div>
                                <div className="import-local-drop__title">
                                    {pendingFiles.length === 1 ? 'Selected file' : `${pendingFiles.length} selected files`}
                                </div>
                                <ul className="import-local-drop__files">
                                    {pendingFiles.map((f) => (
                                        <li key={`${f.name}-${f.size}`}>
                                            <span className="import-local-drop__file-name">{f.name}</span>
                                            <span className="import-local-drop__file-size">{formatBytes(f.size)}</span>
                                        </li>
                                    ))}
                                </ul>
                                <p className="import-local-drop__hint">
                                    Click or drop to replace.
                                </p>
                            </>
                        ) : (
                            <>
                                <div className="import-local-drop__icon" aria-hidden="true">📂</div>
                                <div className="import-local-drop__title">Drop files here</div>
                                <p className="import-local-drop__hint">
                                    GeoJSON, CSV, Excel, KML, Shapefile, and other supported formats.
                                </p>
                            </>
                        )}
                    </div>

                    {scanning ? (
                        <ImportProgressPanel step="Scanning attributes…" percent={0} />
                    ) : null}

                    <p className="import-mode-explainer__lead">
                        Because this app runs entirely in your browser (no server-side processing), file size and geometry complexity naturally have limits. After import, the app chooses how to draw the layer on the map so the browser stays responsive and does not crash. The full imported data always remains on this device either way.
                    </p>
                    <div className="import-mode-explainer" role="list" ref={modeExplainerRef}>
                        {IMPORT_DISPLAY_MODE_CARDS.map((card) => {
                            const infoOpen = openModeInfoId === card.id;
                            return (
                                <div
                                    className={`import-mode-card${predictedDisplayMode === card.id ? ' import-mode-card--selected' : ''}`}
                                    role="listitem"
                                    key={card.id}
                                    aria-current={predictedDisplayMode === card.id ? 'true' : undefined}
                                >
                                    <button
                                        type="button"
                                        className="import-mode-card__info"
                                        ref={(el) => { modeInfoBtnRefs.current[card.id] = el; }}
                                        aria-label={`More about ${card.title}`}
                                        aria-expanded={infoOpen}
                                        aria-controls={infoOpen ? `import-mode-info-${card.id}` : undefined}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenModeInfoId(infoOpen ? null : card.id);
                                        }}
                                    >
                                        <span aria-hidden="true">i</span>
                                    </button>
                                    <div className="import-mode-card__size">{card.sizeLabel}</div>
                                    <img
                                        className="import-mode-card__img"
                                        src={card.icon}
                                        alt=""
                                        width={72}
                                        height={72}
                                    />
                                    <div className="import-mode-card__title">{card.title}</div>
                                    <p className="import-mode-card__desc">{card.shortDesc}</p>
                                </div>
                            );
                        })}
                    </div>
                    {openModeCard && typeof document !== 'undefined'
                        ? createPortal(
                            <div
                                ref={modeInfoPopoverRef}
                                className="import-mode-card__popover"
                                id={`import-mode-info-${openModeCard.id}`}
                                role="dialog"
                                aria-label={openModeCard.infoTitle}
                                style={modeInfoPos
                                    ? {
                                        top: modeInfoPos.top,
                                        left: modeInfoPos.left,
                                        width: modeInfoPos.width
                                    }
                                    : {
                                        // Offscreen first paint so we can measure without flashing.
                                        top: -9999,
                                        left: -9999,
                                        width: 300
                                    }}
                            >
                                <div className="import-mode-card__popover-title">{openModeCard.infoTitle}</div>
                                <p className="import-mode-card__popover-summary">{openModeCard.infoSummary}</p>
                                <ul className="import-mode-card__popover-list">
                                    {openModeCard.infoDetails.map((line) => (
                                        <li key={line}>{line}</li>
                                    ))}
                                </ul>
                            </div>,
                            document.body
                        )
                        : null}

                    {showLocalFilesConfigure ? (
                        <div className="import-local-configure mt-8">
                            {isKitOnly ? (
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => void startImport(pendingFiles, { preflightConfirmed: true })}
                                >
                                    Import Toolbox project
                                </button>
                            ) : (
                                <>
                                    <details className="import-local-collapse">
                                        <summary className="import-local-collapse__summary">
                                            <span>Attributes to import</span>
                                            {fieldNames.length > 0 ? (
                                                <span className="import-local-collapse__meta">
                                                    {selectedFields.length} of {fieldNames.length} selected
                                                </span>
                                            ) : null}
                                        </summary>
                                        <div className="import-local-collapse__body">
                                            <ImportFieldSelector
                                                fields={fieldNames}
                                                selected={selectedFields}
                                                onChange={setSelectedFields}
                                            />
                                        </div>
                                    </details>

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

                                    {needsLargeFileControls && onOpenFence ? (
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
                                        disabled={!configureImportReady}
                                        onClick={() => void startImport(pendingFiles, { selectedFields })}
                                    >
                                        Import selected
                                    </button>
                                </>
                            )}
                        </div>
                    ) : null}
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
