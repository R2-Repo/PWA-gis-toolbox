import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { RouteSearchResults } from './shared/RouteSearchResults.jsx';
import { RouteSearchField } from './shared/RouteSearchField.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';
import { RunPreviewFooter } from './shared/RunPreviewFooter.jsx';
import { ImportStationTablePanel } from './project-stationing/ImportStationTablePanel.jsx';
import { validateMilepostRange } from '../../js/widgets/route-milepost-segment/engine.js';
import {
    validateStation,
    DEFAULT_INTERVAL_FT,
    DEFAULT_STATIONING_GRAPHICS,
    ROUTE_SOURCE_DRAWN,
    ROUTE_SOURCE_IMPORTED,
    isCustomRouteSource
} from '../../js/widgets/project-stationing/engine.js';
import { TRAVEL_DIRECTION_CHOICES } from '../../js/widgets/project-stationing/table-import/station-locator-name.js';

const PREVIEW_DEBOUNCE_MS = 500;
const CLIP_PREVIEW_DEBOUNCE_MS = 400;

const OUTPUT_OPTIONS = [
    { value: 'segments_only', label: 'Stationing only' },
    { value: 'with_mileposts', label: 'Stationing + LM tenth mileposts' }
];

const OFFSET_SIDE_OPTIONS = [
    { value: 'left', label: 'Left' },
    { value: 'right', label: 'Right' }
];

function formatFeet(value) {
    if (value == null || !Number.isFinite(value)) return '-';
    return `${Math.round(value).toLocaleString()} ft`;
}

export function ProjectStationingDialog({
    onCancel,
    onSearchRoutes,
    onSelectRoute,
    onDrawCenterline,
    onImportCenterline,
    lineLayerOptions = [],
    onPickClipOnRoute,
    onClipPreview,
    onCancelMapInteraction,
    onStationPreview,
    onRun
}) {
    const [routeEntryMode, setRouteEntryMode] = useState('search');
    const [drawRouteName, setDrawRouteName] = useState('');
    const [drawTravelDirection, setDrawTravelDirection] = useState('');
    const [drawing, setDrawing] = useState(false);
    const [importLayerId, setImportLayerId] = useState('');
    const [importRouteName, setImportRouteName] = useState('');
    const [importTravelDirection, setImportTravelDirection] = useState('');
    const [importing, setImporting] = useState(false);
    const [lineLengthFormatted, setLineLengthFormatted] = useState('—');
    const [searchText, setSearchText] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [dividedGroup, setDividedGroup] = useState(null);
    const [searching, setSearching] = useState(false);
    const [selectedRoute, setSelectedRoute] = useState(null);
    const [routePickerOpen, setRoutePickerOpen] = useState(true);
    const [routeWarnings, setRouteWarnings] = useState([]);
    const [begMileageFormatted, setBegMileageFormatted] = useState('—');
    const [endMileageFormatted, setEndMileageFormatted] = useState('—');

    const [clipMode, setClipMode] = useState(null);
    const [extentConfirmed, setExtentConfirmed] = useState(false);
    const [startMilepost, setStartMilepost] = useState('');
    const [endMilepost, setEndMilepost] = useState('');
    const [mapClip, setMapClip] = useState(null);

    const [beginStation, setBeginStation] = useState('');
    const [endStation, setEndStation] = useState('');
    const [showEndStationField, setShowEndStationField] = useState(false);
    const [intervalFt, setIntervalFt] = useState(String(DEFAULT_INTERVAL_FT));
    const [outputMode, setOutputMode] = useState('segments_only');
    const [centerlineOffsetFt, setCenterlineOffsetFt] = useState('0');
    const [centerlineOffsetSide, setCenterlineOffsetSide] = useState(DEFAULT_STATIONING_GRAPHICS.centerlineOffsetSide);
    const [labelOffsetFt, setLabelOffsetFt] = useState(String(DEFAULT_STATIONING_GRAPHICS.labelOffsetFt));
    const [labelSide, setLabelSide] = useState(DEFAULT_STATIONING_GRAPHICS.labelSide);

    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [clipPreviewing, setClipPreviewing] = useState(false);
    const [picking, setPicking] = useState(false);
    const [running, setRunning] = useState(false);
    const [success, setSuccess] = useState(null);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('stationing');
    const [importTabEnabled, setImportTabEnabled] = useState(false);
    const [importFooter, setImportFooter] = useState(null);
    const [mapPickToken, setMapPickToken] = useState(0);

    const searchTimer = useRef(null);
    const previewTimer = useRef(null);
    const clipPreviewTimer = useRef(null);
    const previewRequestId = useRef(0);
    const clipPreviewRequestId = useRef(0);
    const startMpRef = useRef(null);

    const routeSelected = Boolean(selectedRoute?.routeId);
    const isCustomRoute = isCustomRouteSource(selectedRoute?.routeSource);
    const customRouteLabel = selectedRoute?.routeSource === ROUTE_SOURCE_IMPORTED ? 'imported' : 'drawn';

    const milepostValidation = useMemo(
        () => validateMilepostRange(startMilepost, endMilepost),
        [startMilepost, endMilepost]
    );

    const beginStationValidation = useMemo(
        () => validateStation(beginStation),
        [beginStation]
    );

    const hasMapClip = mapClip != null;
    const milepostExtentReady = clipMode === 'milepost' && milepostValidation.valid;
    const mapExtentReady = clipMode === 'map' && hasMapClip;
    const fullExtentReady = clipMode === 'full';
    const extentReady = milepostExtentReady || mapExtentReady || fullExtentReady;

    const hasMilepostClip = Boolean(startMilepost.trim() && endMilepost.trim());
    const milepostClipInvalid = clipMode === 'milepost' && hasMilepostClip && !milepostValidation.valid;

    const includeMilepostTenths = outputMode === 'with_mileposts';
    const showStationStep = routeSelected && (extentConfirmed || isCustomRoute);
    const showExtentEditor = routeSelected && !isCustomRoute && clipMode && !extentConfirmed;

    const buildInput = useCallback(() => ({
        routeId: selectedRoute?.routeId,
        routeAlias: selectedRoute?.routeAlias,
        routeSource: selectedRoute?.routeSource || 'udot',
        routeRecord: selectedRoute?.routeRecord || selectedRoute?.raw,
        clipMode: isCustomRoute ? 'full' : clipMode,
        startMilepost: clipMode === 'map' ? '' : startMilepost,
        endMilepost: clipMode === 'map' ? '' : endMilepost,
        mapClipStartFt: clipMode === 'map' ? (mapClip?.mapClipStartFt ?? null) : null,
        mapClipEndFt: clipMode === 'map' ? (mapClip?.mapClipEndFt ?? null) : null,
        beginStation,
        endStation: showEndStationField ? endStation : '',
        intervalFt: Number(intervalFt) || DEFAULT_INTERVAL_FT,
        includeMilepostTenths: isCustomRoute ? false : includeMilepostTenths,
        centerlineOffsetFt: Math.max(0, Number(centerlineOffsetFt) || 0),
        centerlineOffsetSide,
        labelOffsetFt: Math.max(0, Number(labelOffsetFt) ?? DEFAULT_STATIONING_GRAPHICS.labelOffsetFt),
        labelSide
    }), [
        selectedRoute,
        isCustomRoute,
        clipMode,
        startMilepost,
        endMilepost,
        mapClip,
        beginStation,
        endStation,
        showEndStationField,
        intervalFt,
        includeMilepostTenths,
        centerlineOffsetFt,
        centerlineOffsetSide,
        labelOffsetFt,
        labelSide
    ]);

    const canPreview = Boolean(
        showStationStep &&
        beginStationValidation.valid &&
        !milepostClipInvalid
    );

    const canCreate = canPreview && !running;

    const shouldRunClipPreview = Boolean(
        routeSelected &&
        !isCustomRoute &&
        clipMode &&
        !extentConfirmed &&
        !picking &&
        !running &&
        (clipMode === 'full' ||
            (clipMode === 'milepost' && (startMilepost.trim() || endMilepost.trim() || !extentReady)) ||
            (clipMode === 'map' && hasMapClip))
    );

    const resetClipFields = () => {
        setMapClip(null);
        setStartMilepost('');
        setEndMilepost('');
    };

    const resetStationFields = () => {
        setBeginStation('');
        setEndStation('');
        setShowEndStationField(false);
        setCenterlineOffsetFt('0');
        setCenterlineOffsetSide(DEFAULT_STATIONING_GRAPHICS.centerlineOffsetSide);
        setLabelOffsetFt(String(DEFAULT_STATIONING_GRAPHICS.labelOffsetFt));
        setLabelSide(DEFAULT_STATIONING_GRAPHICS.labelSide);
    };

    const resetAllAfterRoute = () => {
        setClipMode(null);
        setExtentConfirmed(false);
        resetClipFields();
        resetStationFields();
        setPreview(null);
    };

    useEffect(() => {
        if (!extentReady) setExtentConfirmed(false);
    }, [extentReady]);

    useEffect(() => {
        if (!routePickerOpen) return undefined;
        if (searchTimer.current) clearTimeout(searchTimer.current);
        const term = searchText.trim();
        if (term.length < 2) {
            setSearchResults([]);
            setDividedGroup(null);
            return undefined;
        }

        searchTimer.current = setTimeout(async () => {
            setSearching(true);
            setError('');
            try {
                const results = await onSearchRoutes?.(term);
                setSearchResults(results || []);
            } catch (err) {
                setSearchResults([]);
                setError(err?.message || 'Route search failed.');
            } finally {
                setSearching(false);
            }
        }, 300);

        return () => {
            if (searchTimer.current) clearTimeout(searchTimer.current);
        };
    }, [searchText, routePickerOpen, onSearchRoutes]);

    useEffect(() => {
        if (!shouldRunClipPreview) {
            if (clipPreviewTimer.current) clearTimeout(clipPreviewTimer.current);
            return undefined;
        }

        if (clipPreviewTimer.current) clearTimeout(clipPreviewTimer.current);
        clipPreviewTimer.current = setTimeout(async () => {
            const requestId = ++clipPreviewRequestId.current;
            setClipPreviewing(true);
            setError('');
            try {
                await onClipPreview?.(buildInput());
                if (requestId !== clipPreviewRequestId.current) return;
            } catch (err) {
                if (requestId !== clipPreviewRequestId.current) return;
                setError(err?.message || 'Clip preview failed.');
            } finally {
                if (requestId === clipPreviewRequestId.current) setClipPreviewing(false);
            }
        }, CLIP_PREVIEW_DEBOUNCE_MS);

        return () => {
            if (clipPreviewTimer.current) clearTimeout(clipPreviewTimer.current);
        };
    }, [
        shouldRunClipPreview,
        buildInput,
        onClipPreview
    ]);

    useEffect(() => {
        if (!canPreview || picking) {
            if (previewTimer.current) clearTimeout(previewTimer.current);
            if (!beginStationValidation.valid) setPreview(null);
            return undefined;
        }

        if (previewTimer.current) clearTimeout(previewTimer.current);
        previewTimer.current = setTimeout(async () => {
            const requestId = ++previewRequestId.current;
            setPreviewing(true);
            setError('');
            try {
                const data = await onStationPreview?.(buildInput());
                if (requestId !== previewRequestId.current) return;
                setPreview(data?.summary ? data : null);
            } catch (err) {
                if (requestId !== previewRequestId.current) return;
                setPreview(null);
                setError(err?.message || 'Preview failed.');
            } finally {
                if (requestId === previewRequestId.current) setPreviewing(false);
            }
        }, PREVIEW_DEBOUNCE_MS);

        return () => {
            if (previewTimer.current) clearTimeout(previewTimer.current);
        };
    }, [
        canPreview,
        buildInput,
        picking,
        onStationPreview,
        beginStationValidation.valid
    ]);

    const applySelectedRoute = (routeOption, info = {}) => {
        const custom = isCustomRouteSource(info.routeSource);
        setSelectedRoute({ ...routeOption, ...info });
        setRouteWarnings(info?.warnings || []);
        setBegMileageFormatted(info?.begMileageFormatted ?? '—');
        setEndMileageFormatted(info?.endMileageFormatted ?? '—');
        setLineLengthFormatted(
            info?.lineLengthFt != null ? `${Math.round(info.lineLengthFt).toLocaleString()} ft` : '—'
        );
        setRoutePickerOpen(false);
        setSearchText('');
        setSearchResults([]);
        setDividedGroup(null);
        setRouteEntryMode('search');
        setDrawRouteName('');
        setDrawTravelDirection('');
        setImportLayerId('');
        setImportRouteName('');
        setImportTravelDirection('');
        if (custom) {
            setClipMode('full');
            setExtentConfirmed(true);
            resetClipFields();
            resetStationFields();
            setPreview(null);
        } else {
            resetAllAfterRoute();
        }
    };

    const selectRoute = async (routeOption) => {
        setError('');
        setPreview(null);
        previewRequestId.current += 1;
        clipPreviewRequestId.current += 1;
        try {
            const info = await onSelectRoute?.(routeOption);
            applySelectedRoute(routeOption, info);
        } catch (err) {
            setSelectedRoute(null);
            setError(err?.message || 'Unable to load selected route.');
        }
    };

    const startDrawCenterline = async () => {
        const routeName = drawRouteName.trim();
        if (!routeName) {
            setError('Enter a route name before drawing.');
            return;
        }
        setError('');
        setDrawing(true);
        onCancelMapInteraction?.();
        try {
            const info = await onDrawCenterline?.({
                routeName,
                travelDirection: drawTravelDirection
            });
            if (!info) return;
            applySelectedRoute(
                {
                    routeId: info.routeId,
                    routeAlias: info.routeAlias,
                    routeRecord: info.routeRecord
                },
                info
            );
        } catch (err) {
            setError(err?.message || 'Unable to use drawn centerline.');
        } finally {
            setDrawing(false);
        }
    };

    const startImportCenterline = async () => {
        const routeName = importRouteName.trim();
        if (!importLayerId) {
            setError('Select a line layer to import.');
            return;
        }
        if (!routeName) {
            setError('Enter a route name before importing.');
            return;
        }
        setError('');
        setImporting(true);
        onCancelMapInteraction?.();
        try {
            const info = await onImportCenterline?.({
                layerId: importLayerId,
                routeName,
                travelDirection: importTravelDirection
            });
            if (!info) return;
            applySelectedRoute(
                {
                    routeId: info.routeId,
                    routeAlias: info.routeAlias,
                    routeRecord: info.routeRecord
                },
                info
            );
        } catch (err) {
            setError(err?.message || 'Unable to import centerline from layer.');
        } finally {
            setImporting(false);
        }
    };

    const handleImportLayerChange = (layerId) => {
        setImportLayerId(layerId);
        const layer = lineLayerOptions.find((item) => item.id === layerId);
        if (layer) {
            setImportRouteName(layer.name);
        }
    };

    const formatLineLayerOption = (layer) => {
        const countLabel = layer.selectedCount > 0
            ? `${layer.selectedCount} selected`
            : `${layer.featureCount} features`;
        return `${layer.name} (${countLabel})`;
    };

    const pickSearchGroup = (group) => {
        if (group?.isDivided) {
            setDividedGroup(group);
            setError('');
            return;
        }
        selectRoute(group?.variants?.[0]);
    };

    const changeRoute = () => {
        previewRequestId.current += 1;
        clipPreviewRequestId.current += 1;
        setSelectedRoute(null);
        setPreview(null);
        setSuccess(null);
        setImportTabEnabled(false);
        setActiveTab('stationing');
        setRouteWarnings([]);
        setBegMileageFormatted('—');
        setEndMileageFormatted('—');
        setRoutePickerOpen(true);
        setSearchText('');
        setSearchResults([]);
        setDividedGroup(null);
        setRouteEntryMode('search');
        setDrawRouteName('');
        setDrawTravelDirection('');
        setImportLayerId('');
        setImportRouteName('');
        setImportTravelDirection('');
        setLineLengthFormatted('—');
        resetAllAfterRoute();
        setError('');
    };

    const changeExtent = () => {
        previewRequestId.current += 1;
        clipPreviewRequestId.current += 1;
        onCancelMapInteraction?.();
        setClipMode(null);
        setExtentConfirmed(false);
        resetClipFields();
        resetStationFields();
        setPreview(null);
        setPicking(false);
        setError('');
    };

    const selectClipMode = (mode) => {
        clipPreviewRequestId.current += 1;
        onCancelMapInteraction?.();
        setClipMode(mode);
        setExtentConfirmed(false);
        resetClipFields();
        resetStationFields();
        setPreview(null);
        setPicking(false);
        setError('');
        if (mode === 'milepost') {
            requestAnimationFrame(() => startMpRef.current?.focus());
        }
        if (mode === 'map') {
            setMapPickToken((token) => token + 1);
        }
    };

    const confirmExtent = () => {
        if (!extentReady) return;
        previewRequestId.current += 1;
        clipPreviewRequestId.current += 1;
        setExtentConfirmed(true);
        setShowEndStationField(false);
        setEndStation('');
        setPreview(null);
        setError('');
    };

    const handleMilepostChange = (field, value) => {
        if (field === 'start') setStartMilepost(value);
        else setEndMilepost(value);
        setExtentConfirmed(false);
        setPreview(null);
    };

    const mapPickInFlight = useRef(false);

    const handlePickClip = useCallback(async () => {
        if (!selectedRoute || clipMode !== 'map' || running || mapPickInFlight.current) return;
        mapPickInFlight.current = true;
        if (clipPreviewTimer.current) clearTimeout(clipPreviewTimer.current);
        clipPreviewRequestId.current += 1;
        setPreview(null);
        setPicking(true);
        setError('');
        try {
            const result = await onPickClipOnRoute?.();
            if (!result) {
                setError('Clip pick cancelled.');
                setMapPickToken((token) => token + 1);
                return;
            }
            setMapClip(result);
            setExtentConfirmed(false);
            clipPreviewRequestId.current += 1;
            setClipPreviewing(true);
            try {
                await onClipPreview?.({
                    ...buildInput(),
                    mapClipStartFt: result.mapClipStartFt,
                    mapClipEndFt: result.mapClipEndFt
                });
            } catch (err) {
                setError(err?.message || 'Clip preview failed.');
            } finally {
                setClipPreviewing(false);
            }
        } catch (err) {
            setMapClip(null);
            setError(err?.message || 'Map pick failed.');
            setMapPickToken((token) => token + 1);
        } finally {
            mapPickInFlight.current = false;
            setPicking(false);
        }
    }, [
        selectedRoute,
        clipMode,
        running,
        onPickClipOnRoute,
        onClipPreview,
        buildInput
    ]);

    useEffect(() => {
        if (clipMode !== 'map' || !showExtentEditor || hasMapClip || running) return undefined;
        handlePickClip();
        return undefined;
    }, [clipMode, showExtentEditor, hasMapClip, mapPickToken, running, handlePickClip]);

    const clearMapClip = () => {
        onCancelMapInteraction?.();
        setMapClip(null);
        setExtentConfirmed(false);
        setPreview(null);
        setPicking(false);
        clipPreviewRequestId.current += 1;
        setMapPickToken((token) => token + 1);
    };

    const createLayer = async () => {
        setError('');
        setRunning(true);
        try {
            const result = await onRun?.(buildInput());
            setSuccess(result || null);
            setActiveTab('stationing');
            setImportTabEnabled(false);
            setRunning(false);
        } catch (err) {
            setError(err?.message || 'Unable to create output layer.');
            setRunning(false);
        }
    };

    const openImportTab = () => {
        setImportTabEnabled(true);
        setActiveTab('import');
    };

    const warnings = useMemo(() => {
        const all = [...(preview?.warnings || []), ...routeWarnings];
        return [...new Set(all)];
    }, [preview, routeWarnings]);

    const statusText = error
        || (drawing ? 'Draw centerline on map…' : '')
        || (previewing ? 'Updating preview…' : '')
        || (clipPreviewing ? 'Updating clip…' : '')
        || (picking ? 'Click on map…' : '');

    const shellStatus = activeTab === 'import'
        ? (importFooter?.status || '')
        : statusText;
    const shellStatusTone = (activeTab === 'import' ? importFooter?.error : error) ? 'danger' : 'muted';
    const shellClassName = [
        'project-stationing-widget',
        activeTab === 'import' ? 'project-stationing-widget--import-tab' : ''
    ].filter(Boolean).join(' ');

    return (
        <WidgetPanelShell
            className={shellClassName}
            status={shellStatus}
            statusTone={shellStatusTone}
            onCancel={onCancel}
            onRun={createLayer}
            runLabel="Create Layers"
            running={running}
            disabled={!canCreate || running}
            footer={activeTab === 'import' && success?.importTable ? (
                <RunPreviewFooter
                    onCancel={onCancel}
                    onRun={importFooter?.plotRows}
                    runLabel="Plot Ready Rows"
                    running={importFooter?.plotting}
                    disabled={importFooter?.disabled ?? true}
                />
            ) : undefined}
        >
            {importTabEnabled && success?.importTable ? (
                <div className="project-stationing-widget__tabs mb-8" role="tablist">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'stationing'}
                        className={`project-stationing-widget__tab${activeTab === 'stationing' ? ' is-active' : ''}`}
                        onClick={() => setActiveTab('stationing')}
                    >
                        Stationing
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'import'}
                        className={`project-stationing-widget__tab${activeTab === 'import' ? ' is-active' : ''}`}
                        onClick={() => setActiveTab('import')}
                    >
                        Import Table
                    </button>
                </div>
            ) : null}

            {activeTab === 'import' && success?.importTable ? (
                <ImportStationTablePanel
                    routeProfile={success.importTable.routeProfile}
                    suggestedNaming={success.importTable.suggestedNaming}
                    onFileLoad={success.importTable.onFileLoad}
                    onAnalyzeMapping={success.importTable.onAnalyzeMapping}
                    onPlot={success.importTable.onPlot}
                    onStatusChange={setImportFooter}
                />
            ) : null}

            {activeTab === 'stationing' ? (
                <>
            {routePickerOpen || !routeSelected ? (
                <div className="route-mp-widget__route-search mb-8">
                    <div className="gis-widget__btn-row mb-8">
                        <button
                            type="button"
                            className={`btn btn-sm ${routeEntryMode === 'search' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setRouteEntryMode('search')}
                            disabled={drawing || importing}
                        >
                            Search routes
                        </button>
                        <button
                            type="button"
                            className={`btn btn-sm ${routeEntryMode === 'draw' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setRouteEntryMode('draw')}
                            disabled={drawing || importing}
                        >
                            Draw centerline
                        </button>
                        <button
                            type="button"
                            className={`btn btn-sm ${routeEntryMode === 'import' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setRouteEntryMode('import')}
                            disabled={drawing || importing}
                        >
                            Import line
                        </button>
                    </div>

                    {routeEntryMode === 'search' ? (
                        <>
                            <label className="text-xs text-muted" htmlFor="ps-route-search">Search routes</label>
                            <RouteSearchField
                                id="ps-route-search"
                                placeholder="e.g. SR-145"
                                value={searchText}
                                onChange={(e) => {
                                    setSearchText(e.target.value);
                                    setDividedGroup(null);
                                }}
                            />
                            {searching ? <div className="text-xs text-muted mt-4">Searching…</div> : null}
                            <RouteSearchResults
                                searchResults={searchResults}
                                dividedGroup={dividedGroup}
                                searching={searching}
                                searchText={searchText}
                                onPickGroup={pickSearchGroup}
                                onPickVariant={selectRoute}
                                onBackFromDivided={() => setDividedGroup(null)}
                            />
                        </>
                    ) : routeEntryMode === 'draw' ? (
                        <div className="project-stationing-draw-form">
                            <div className="mb-8">
                                <label className="text-xs text-muted" htmlFor="ps-draw-route-name">Route name</label>
                                <input
                                    id="ps-draw-route-name"
                                    type="text"
                                    className="route-mp-widget__input"
                                    placeholder="e.g. Project Mainline"
                                    value={drawRouteName}
                                    onChange={(e) => setDrawRouteName(e.target.value)}
                                    autoComplete="off"
                                    disabled={drawing}
                                />
                            </div>
                            <div className="mb-8">
                                <label className="text-xs text-muted" htmlFor="ps-draw-travel-dir">Travel direction (optional)</label>
                                <select
                                    id="ps-draw-travel-dir"
                                    className="route-mp-widget__input"
                                    value={drawTravelDirection}
                                    onChange={(e) => setDrawTravelDirection(e.target.value)}
                                    disabled={drawing}
                                >
                                    <option value="">—</option>
                                    {TRAVEL_DIRECTION_CHOICES.map((dir) => (
                                        <option key={dir} value={dir}>{dir}</option>
                                    ))}
                                </select>
                                <div className="text-xs text-muted mt-4">Used for station table import (RT/LT naming).</div>
                            </div>
                            <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={startDrawCenterline}
                                disabled={drawing || !drawRouteName.trim()}
                            >
                                {drawing ? 'Drawing on map…' : 'Draw on map'}
                            </button>
                        </div>
                    ) : (
                        <div className="project-stationing-import-form">
                            {lineLayerOptions.length === 0 ? (
                                <div className="text-xs text-muted mb-8">
                                    Add a line layer to the map to import a centerline.
                                </div>
                            ) : (
                                <LayerSelect
                                    label="Line layer"
                                    value={importLayerId}
                                    onChange={handleImportLayerChange}
                                    layers={lineLayerOptions}
                                    formatOption={formatLineLayerOption}
                                    className="mb-8"
                                />
                            )}
                            <div className="mb-8">
                                <label className="text-xs text-muted" htmlFor="ps-import-route-name">Route name</label>
                                <input
                                    id="ps-import-route-name"
                                    type="text"
                                    className="route-mp-widget__input"
                                    placeholder="e.g. Project Mainline"
                                    value={importRouteName}
                                    onChange={(e) => setImportRouteName(e.target.value)}
                                    autoComplete="off"
                                    disabled={importing}
                                />
                            </div>
                            <div className="mb-8">
                                <label className="text-xs text-muted" htmlFor="ps-import-travel-dir">Travel direction (optional)</label>
                                <select
                                    id="ps-import-travel-dir"
                                    className="route-mp-widget__input"
                                    value={importTravelDirection}
                                    onChange={(e) => setImportTravelDirection(e.target.value)}
                                    disabled={importing}
                                >
                                    <option value="">—</option>
                                    {TRAVEL_DIRECTION_CHOICES.map((dir) => (
                                        <option key={dir} value={dir}>{dir}</option>
                                    ))}
                                </select>
                                <div className="text-xs text-muted mt-4">
                                    Uses the longest line in the layer (or selection). WGS84 coordinates assumed.
                                </div>
                            </div>
                            <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={startImportCenterline}
                                disabled={importing || !importLayerId || !importRouteName.trim() || lineLayerOptions.length === 0}
                            >
                                {importing ? 'Importing…' : 'Use line'}
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <>
                    <div className="route-mp-widget__route-chip mb-8">
                        <span className="text-xs text-muted">Route:</span>{' '}
                        <strong>{selectedRoute.routeAlias}</strong>
                        {isCustomRoute ? (
                            <span className="text-xs text-muted"> ({customRouteLabel})</span>
                        ) : null}
                        <button type="button" className="btn btn-sm btn-secondary route-mp-widget__change-btn" onClick={changeRoute}>
                            Change
                        </button>
                        {extentConfirmed && !isCustomRoute ? (
                            <button type="button" className="btn btn-sm btn-secondary route-mp-widget__change-btn" onClick={changeExtent}>
                                Change extent
                            </button>
                        ) : null}
                    </div>
                    <div className="text-xs text-muted mb-8">
                        {isCustomRoute
                            ? `Line length: ${lineLengthFormatted}`
                            : `Route mileage: ${begMileageFormatted} → ${endMileageFormatted}`}
                    </div>
                </>
            )}

            {routeSelected && !isCustomRoute && clipMode == null ? (
                <div className="mb-8">
                    <div className="text-xs text-muted mb-4">Route extent</div>
                    <div className="gis-widget__btn-row">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => selectClipMode('milepost')}
                            disabled={running}
                        >
                            Milepost
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => selectClipMode('map')}
                            disabled={running}
                        >
                            Click Map
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => selectClipMode('full')}
                            disabled={running}
                        >
                            Full route
                        </button>
                    </div>
                </div>
            ) : null}

            {routeSelected && clipMode === 'milepost' && showExtentEditor ? (
                <div className="mb-8">
                    <div className="text-xs text-muted mb-4">Clip by milepost</div>
                    <div className="route-mp-widget__mp-grid mb-8">
                        <div>
                            <label className="text-xs text-muted" htmlFor="ps-start-mp">Start MP</label>
                            <input
                                ref={startMpRef}
                                id="ps-start-mp"
                                type="text"
                                inputMode="decimal"
                                placeholder={begMileageFormatted !== '—' ? String(begMileageFormatted) : 'e.g. 10.5'}
                                value={startMilepost}
                                onChange={(e) => handleMilepostChange('start', e.target.value)}
                                disabled={running}
                                className="route-mp-widget__input"
                                autoComplete="off"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-muted" htmlFor="ps-end-mp">End MP</label>
                            <input
                                id="ps-end-mp"
                                type="text"
                                inputMode="decimal"
                                placeholder={endMileageFormatted !== '—' ? String(endMileageFormatted) : 'e.g. 10.8'}
                                value={endMilepost}
                                onChange={(e) => handleMilepostChange('end', e.target.value)}
                                disabled={running}
                                className="route-mp-widget__input"
                                autoComplete="off"
                            />
                        </div>
                    </div>
                    {milepostClipInvalid ? (
                        <div className="text-xs mb-4" style={{ color: 'var(--danger)' }}>
                            {milepostValidation.errors?.[0]}
                        </div>
                    ) : null}
                    {extentReady ? (
                        <button
                            type="button"
                            className="btn btn-primary btn-sm mb-4"
                            onClick={confirmExtent}
                            disabled={running}
                        >
                            Go to next step
                        </button>
                    ) : null}
                    <button type="button" className="gis-widget__link-btn" onClick={changeExtent} disabled={running}>
                        Change extent
                    </button>
                </div>
            ) : null}

            {routeSelected && clipMode === 'map' && showExtentEditor ? (
                <div className="mb-8">
                    <div className="text-xs text-muted mb-4">Clip on map</div>
                    <div className="text-xs text-muted mb-4">
                        {picking
                            ? 'Click the route on the map to set the clip start, then click again for the end.'
                            : hasMapClip
                                ? 'Clip set. Clear to pick again, or continue when ready.'
                                : 'Preparing map pick…'}
                    </div>
                    {hasMapClip ? (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm mb-4"
                            onClick={clearMapClip}
                            disabled={running || picking}
                        >
                            Clear pick
                        </button>
                    ) : null}
                    {hasMapClip ? (
                        <div className="text-xs text-muted mb-4">
                            Clip defined from map pick ({Math.round(mapClip.mapClipStartFt).toLocaleString()}–{Math.round(mapClip.mapClipEndFt).toLocaleString()} ft along route).
                        </div>
                    ) : null}
                    {extentReady ? (
                        <button
                            type="button"
                            className="btn btn-primary btn-sm mb-4"
                            onClick={confirmExtent}
                            disabled={running || picking}
                        >
                            Go to next step
                        </button>
                    ) : null}
                    <button type="button" className="gis-widget__link-btn mt-4" onClick={changeExtent} disabled={running || picking}>
                        Change extent
                    </button>
                </div>
            ) : null}

            {routeSelected && clipMode === 'full' && showExtentEditor ? (
                <div className="mb-8">
                    <div className="text-xs text-muted mb-4">Using full route extent</div>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm mb-4"
                        onClick={confirmExtent}
                        disabled={running}
                    >
                        Go to next step
                    </button>
                    <button type="button" className="gis-widget__link-btn" onClick={changeExtent} disabled={running}>
                        Change extent
                    </button>
                </div>
            ) : null}

            {showStationStep ? (
                <>
                    <div className="route-mp-widget__mp-grid mb-8">
                        <div>
                            <label className="text-xs text-muted" htmlFor="ps-begin-station">Begin station</label>
                            <input
                                id="ps-begin-station"
                                type="text"
                                placeholder="e.g. 817+15"
                                value={beginStation}
                                onChange={(e) => { setBeginStation(e.target.value); setPreview(null); }}
                                disabled={running}
                                className="route-mp-widget__input"
                                autoComplete="off"
                            />
                            {!beginStationValidation.valid && beginStation ? (
                                <div className="text-xs mt-4" style={{ color: 'var(--danger)' }}>
                                    {beginStationValidation.error}
                                </div>
                            ) : null}
                        </div>
                        <div>
                            <label className="text-xs text-muted" htmlFor="ps-interval">Interval (ft)</label>
                            <input
                                id="ps-interval"
                                type="number"
                                min="1"
                                step="1"
                                value={intervalFt}
                                onChange={(e) => { setIntervalFt(e.target.value); setPreview(null); }}
                                disabled={running}
                                className="route-mp-widget__input"
                            />
                        </div>
                    </div>

                    <div className="mb-8">
                        <label className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                                type="checkbox"
                                checked={showEndStationField}
                                onChange={(e) => {
                                    const checked = e.target.checked;
                                    setShowEndStationField(checked);
                                    if (!checked) setEndStation('');
                                    setPreview(null);
                                }}
                                disabled={running}
                            />
                            Specify end station
                        </label>
                    </div>

                    {showEndStationField ? (
                        <div className="mb-8">
                            <label className="text-xs text-muted" htmlFor="ps-end-station">End station</label>
                            <input
                                id="ps-end-station"
                                type="text"
                                placeholder="Auto from clip length"
                                value={endStation}
                                onChange={(e) => { setEndStation(e.target.value); setPreview(null); }}
                                disabled={running}
                                className="route-mp-widget__input"
                                autoComplete="off"
                            />
                        </div>
                    ) : null}

                    {!isCustomRoute ? (
                    <div className="mb-8">
                        <div className="text-xs text-muted mb-4">Output layers</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {OUTPUT_OPTIONS.map((opt) => (
                                <label key={opt.value} className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <input
                                        type="radio"
                                        name="ps-output-mode"
                                        value={opt.value}
                                        checked={outputMode === opt.value}
                                        onChange={() => { setOutputMode(opt.value); setPreview(null); }}
                                        disabled={running}
                                    />
                                    {opt.label}
                                </label>
                            ))}
                        </div>
                    </div>
                    ) : null}

                    <details className="form-group mb-8">
                        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                            Layout options
                        </summary>
                        <div className="text-xs text-muted mt-4 mb-8">
                            Left and right are relative to the centerline direction.
                        </div>
                        <div className="route-mp-widget__mp-grid mb-8">
                            <div>
                                <label className="text-xs text-muted" htmlFor="ps-centerline-offset">
                                    Centerline offset (ft)
                                </label>
                                <input
                                    id="ps-centerline-offset"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={centerlineOffsetFt}
                                    onChange={(e) => { setCenterlineOffsetFt(e.target.value); setPreview(null); }}
                                    disabled={running}
                                    className="route-mp-widget__input"
                                />
                            </div>
                            <div>
                                <div className="text-xs text-muted mb-4">Centerline offset side</div>
                                <div style={{ display: 'flex', gap: 12 }}>
                                    {OFFSET_SIDE_OPTIONS.map((opt) => (
                                        <label key={opt.value} className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <input
                                                type="radio"
                                                name="ps-centerline-offset-side"
                                                value={opt.value}
                                                checked={centerlineOffsetSide === opt.value}
                                                onChange={() => { setCenterlineOffsetSide(opt.value); setPreview(null); }}
                                                disabled={running}
                                            />
                                            {opt.label}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="route-mp-widget__mp-grid mb-8">
                            <div>
                                <label className="text-xs text-muted" htmlFor="ps-label-offset">
                                    Label offset (ft)
                                </label>
                                <input
                                    id="ps-label-offset"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={labelOffsetFt}
                                    onChange={(e) => { setLabelOffsetFt(e.target.value); setPreview(null); }}
                                    disabled={running}
                                    className="route-mp-widget__input"
                                />
                            </div>
                            <div>
                                <div className="text-xs text-muted mb-4">Label side</div>
                                <div style={{ display: 'flex', gap: 12 }}>
                                    {OFFSET_SIDE_OPTIONS.map((opt) => (
                                        <label key={opt.value} className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <input
                                                type="radio"
                                                name="ps-label-side"
                                                value={opt.value}
                                                checked={labelSide === opt.value}
                                                onChange={() => { setLabelSide(opt.value); setPreview(null); }}
                                                disabled={running}
                                            />
                                            {opt.label}
                                        </label>
                                    ))}
                                </div>
                                <div className="text-xs text-muted mt-4">
                                    Applies to station labels and milepost labels. Station labels sit beyond tick marks.
                                </div>
                            </div>
                        </div>
                    </details>
                </>
            ) : null}

            {preview?.summary ? (
                <div className="route-mp-widget__summary text-xs mt-8">
                    {preview.summary.beginStation} → {preview.summary.endStation}
                    {' · '}
                    {preview.summary.segmentCount} segments
                    {' · '}
                    {formatFeet(preview.summary.lineLengthFeet)}
                </div>
            ) : null}

            {success?.summary ? (
                <div className="info-box mt-8">
                    <strong>Project stationing created.</strong>
                    <div className="text-xs mt-4">
                        {success.summary.beginStation} → {success.summary.endStation}
                        {' · '}
                        {success.summary.tickCount} ticks
                        {' · '}
                        {success.summary.labelCount} labels
                    </div>
                    <div className="mt-8" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={openImportTab}
                        >
                            Import Station Table
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
                            Done
                        </button>
                    </div>
                </div>
            ) : null}

            {warnings.length > 0 ? (
                <ul className="route-mp-widget__warnings text-xs text-muted mt-4">
                    {warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                    ))}
                </ul>
            ) : null}
                </>
            ) : null}
        </WidgetPanelShell>
    );
}
