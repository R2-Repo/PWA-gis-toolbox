import { useRef, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { RunPreviewFooter } from './shared/RunPreviewFooter.jsx';
import { SendToMenu } from './shared/SendToMenu.jsx';
import { RouteSearchField } from './shared/RouteSearchField.jsx';
import { RouteSearchResults } from './shared/RouteSearchResults.jsx';
import {
    MILEPOST_SOURCES,
    getMilepostSource,
    validateMilepostRequest
} from '../../js/widgets/route-milepost/engine.js';
import '../../js/widgets/route-milepost/widget.css';

function seedRoute(initialState, initialInput) {
    const seed = initialState?.routeId ? initialState : (initialInput?.routeId ? initialInput : null);
    if (!seed?.routeId) return null;
    return {
        routeId: seed.routeId,
        routeAlias: seed.routeAlias || seed.routeId,
        routeLabel: seed.routeLabel || seed.routeAlias || seed.routeId,
        routeDirection: seed.routeDirection || ''
    };
}

export function RouteMilepostDialog({
    onCancel,
    onSearchRoutes,
    onPreview,
    onRun,
    onSendToTarget,
    initialInput = null,
    initialState = null
}) {
    const seeded = seedRoute(initialState, initialInput);
    const [searchText, setSearchText] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [dividedGroup, setDividedGroup] = useState(null);
    const [searching, setSearching] = useState(false);
    const [searched, setSearched] = useState(false);
    const [selectedRoute, setSelectedRoute] = useState(seeded);
    const [routePickerOpen, setRoutePickerOpen] = useState(!seeded);
    const [sourceId, setSourceId] = useState(() => (
        getMilepostSource(initialState?.sourceId) ? initialState.sourceId : 'lr-mile'
    ));
    const [mode, setMode] = useState(initialState?.mode === 'range' ? 'range' : 'point');
    const [milepost, setMilepost] = useState(initialState?.milepost || '');
    const [startMilepost, setStartMilepost] = useState(initialState?.startMilepost || '');
    const [endMilepost, setEndMilepost] = useState(initialState?.endMilepost || '');
    const [preview, setPreview] = useState(null);
    const [previewKey, setPreviewKey] = useState('');
    const [producedResult, setProducedResult] = useState(null);
    const [committed, setCommitted] = useState(false);
    const [running, setRunning] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [error, setError] = useState('');
    const requestId = useRef(0);

    const buildInput = () => ({
        routeId: selectedRoute?.routeId,
        routeAlias: selectedRoute?.routeAlias || selectedRoute?.routeLabel,
        routeDirection: selectedRoute?.routeDirection || '',
        sourceId,
        mode,
        milepost,
        startMilepost,
        endMilepost
    });

    const inputKey = [
        selectedRoute?.routeId || '',
        sourceId,
        mode,
        milepost,
        startMilepost,
        endMilepost
    ].join('|');

    const validation = validateMilepostRequest(buildInput());

    const invalidate = () => {
        requestId.current += 1;
        setPreview(null);
        setPreviewKey('');
        setProducedResult(null);
        setCommitted(false);
    };

    const runSearch = async () => {
        const term = searchText.trim();
        if (term.length < 2 || searching) return;
        setSearching(true);
        setError('');
        setSearched(true);
        try {
            const results = await onSearchRoutes?.(term);
            setSearchResults(results || []);
            setDividedGroup(null);
        } catch (err) {
            setSearchResults([]);
            setError(err?.message || 'Route search failed.');
        } finally {
            setSearching(false);
        }
    };

    const selectRoute = (routeOption) => {
        if (!routeOption?.routeId) return;
        invalidate();
        setSelectedRoute(routeOption);
        setRoutePickerOpen(false);
        setSearchText('');
        setSearchResults([]);
        setDividedGroup(null);
        setSearched(false);
        setMilepost('');
        setStartMilepost('');
        setEndMilepost('');
        setError('');
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
        invalidate();
        setSelectedRoute(null);
        setRoutePickerOpen(true);
        setSearchText('');
        setSearchResults([]);
        setDividedGroup(null);
        setSearched(false);
        setMilepost('');
        setStartMilepost('');
        setEndMilepost('');
        setError('');
    };

    const previewOnMap = async () => {
        const id = ++requestId.current;
        setPreviewing(true);
        setError('');
        setProducedResult(null);
        setCommitted(false);
        try {
            const data = await onPreview?.(buildInput());
            if (id !== requestId.current) return;
            setPreview(data || null);
            setPreviewKey(inputKey);
        } catch (err) {
            if (id !== requestId.current) return;
            setPreview(null);
            setPreviewKey('');
            setError(err?.message || 'Preview failed.');
        } finally {
            if (id === requestId.current) setPreviewing(false);
        }
    };

    const addLayer = async () => {
        if (!preview?.features?.length) return;
        setRunning(true);
        setError('');
        try {
            const added = await onRun?.({
                layerName: preview.layerName,
                features: preview.features
            });
            setProducedResult(added?.producedResult || null);
            setCommitted(true);
        } catch (err) {
            setError(err?.message || 'Unable to add milepost layer.');
        } finally {
            setRunning(false);
        }
    };

    const milepostStarted = mode === 'point'
        ? Boolean(milepost.trim())
        : Boolean(startMilepost.trim() || endMilepost.trim());
    const canPreview = Boolean(selectedRoute?.routeId) && validation.valid && !previewing && !running;
    const canAdd = Boolean(preview?.features?.length)
        && previewKey === inputKey
        && !committed
        && !previewing
        && !running;

    const statusText = error || (previewing ? 'Loading mileposts…' : '');
    const sendTo = producedResult && onSendToTarget ? (
        <SendToMenu
            result={producedResult}
            onSelectTarget={(targetId) => onSendToTarget(targetId, producedResult)}
        />
    ) : null;

    return (
        <WidgetPanelShell
            className="route-mp-widget route-milepost-widget"
            status={statusText}
            statusTone={error ? 'danger' : 'muted'}
            footer={(
                <RunPreviewFooter
                    onCancel={onCancel}
                    showPreview
                    onPreview={previewOnMap}
                    previewDisabled={!canPreview}
                    previewBusy={previewing}
                    onRun={addLayer}
                    runLabel="Add as layer"
                    runBusyLabel="Adding…"
                    running={running}
                    disabled={!canAdd}
                    middleActions={sendTo}
                />
            )}
        >
            {routePickerOpen || !selectedRoute ? (
                <form
                    className="route-milepost-widget__search-row mb-8"
                    onSubmit={(event) => {
                        event.preventDefault();
                        runSearch();
                    }}
                >
                    <div style={{ flex: 1 }}>
                        <label className="text-xs text-muted" htmlFor="route-milepost-search">Search routes</label>
                        <RouteSearchField
                            id="route-milepost-search"
                            placeholder="e.g. I-15"
                            value={searchText}
                            onChange={(event) => {
                                setSearchText(event.target.value);
                                setSearchResults([]);
                                setDividedGroup(null);
                                setSearched(false);
                            }}
                        />
                    </div>
                    <button type="submit" className="btn btn-secondary" disabled={searching || searchText.trim().length < 2}>
                        {searching ? 'Searching…' : 'Search'}
                    </button>
                </form>
            ) : (
                <div className="route-mp-widget__route-chip mb-8">
                    <span className="text-xs text-muted">Route:</span>{' '}
                    <strong>{selectedRoute.routeLabel || selectedRoute.routeAlias}</strong>
                    <button type="button" className="btn btn-sm btn-secondary route-mp-widget__change-btn" onClick={changeRoute}>
                        Change
                    </button>
                </div>
            )}

            {searched && (routePickerOpen || !selectedRoute) ? (
                <RouteSearchResults
                    searchResults={searchResults}
                    dividedGroup={dividedGroup}
                    searching={searching}
                    searchText={searchText}
                    onPickGroup={pickSearchGroup}
                    onPickVariant={selectRoute}
                    onBackFromDivided={() => setDividedGroup(null)}
                />
            ) : null}

            <label className="text-xs text-muted" htmlFor="route-milepost-source">Milepost source</label>
            <select
                id="route-milepost-source"
                className="route-mp-widget__input mb-8"
                value={sourceId}
                onChange={(event) => {
                    setSourceId(event.target.value);
                    invalidate();
                }}
            >
                {MILEPOST_SOURCES.map((source) => (
                    <option key={source.id} value={source.id}>{source.label}</option>
                ))}
            </select>

            <div className="route-milepost-widget__modes">
                <label>
                    <input
                        type="radio"
                        name="route-milepost-mode"
                        value="point"
                        checked={mode === 'point'}
                        onChange={() => {
                            setMode('point');
                            invalidate();
                        }}
                    />
                    Milepost point
                </label>
                <label>
                    <input
                        type="radio"
                        name="route-milepost-mode"
                        value="range"
                        checked={mode === 'range'}
                        onChange={() => {
                            setMode('range');
                            invalidate();
                        }}
                    />
                    From / to range
                </label>
            </div>

            {mode === 'point' ? (
                <div className="mb-8">
                    <label className="text-xs text-muted" htmlFor="route-milepost-mp">Milepost</label>
                    <input
                        id="route-milepost-mp"
                        type="text"
                        inputMode="decimal"
                        placeholder="e.g. 10.65"
                        value={milepost}
                        disabled={!selectedRoute}
                        onChange={(event) => {
                            setMilepost(event.target.value);
                            invalidate();
                        }}
                        className="route-mp-widget__input"
                    />
                </div>
            ) : (
                <div className="route-mp-widget__mp-grid mb-8">
                    <div>
                        <label className="text-xs text-muted" htmlFor="route-milepost-from">From MP</label>
                        <input
                            id="route-milepost-from"
                            type="text"
                            inputMode="decimal"
                            placeholder="e.g. 10"
                            value={startMilepost}
                            disabled={!selectedRoute}
                            onChange={(event) => {
                                setStartMilepost(event.target.value);
                                invalidate();
                            }}
                            className="route-mp-widget__input"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-muted" htmlFor="route-milepost-to">To MP</label>
                        <input
                            id="route-milepost-to"
                            type="text"
                            inputMode="decimal"
                            placeholder="e.g. 12.5"
                            value={endMilepost}
                            disabled={!selectedRoute}
                            onChange={(event) => {
                                setEndMilepost(event.target.value);
                                invalidate();
                            }}
                            className="route-mp-widget__input"
                        />
                    </div>
                </div>
            )}

            {!validation.valid && milepostStarted ? (
                <div className="text-xs mb-8" style={{ color: 'var(--danger)' }}>
                    {validation.errors?.[0]}
                </div>
            ) : null}

            {preview?.summary && previewKey === inputKey ? (
                <div className="text-xs mt-8">
                    {preview.summary.count} milepost{preview.summary.count === 1 ? '' : 's'}
                    {' · '}
                    {preview.summary.sourceLabel}
                </div>
            ) : null}

            {preview?.warnings?.length && previewKey === inputKey ? (
                <ul className="route-mp-widget__warnings text-xs text-muted mt-4">
                    {preview.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                    ))}
                </ul>
            ) : null}
        </WidgetPanelShell>
    );
}
