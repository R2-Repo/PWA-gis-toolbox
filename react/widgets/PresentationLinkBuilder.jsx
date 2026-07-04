import { useCallback, useEffect, useRef, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { LayerSelect } from './shared/LayerSelect.jsx';
import {
    listLinkAnimations,
    getLinkAnimation,
    getDurationMsForPace,
    ORBIT_PACE_MS
} from '../../js/presentation/presentation-link-animations.js';

const EMPTY_SUMMARY = {
    featureCount: 0,
    geometryTypes: [],
    vertexCount: 0,
    sourceLabel: 'Select features on the map or use Add on map',
    isEmpty: true,
    selectedCount: 0
};

const EMPTY_LIMITS = {
    featureCount: 0,
    maxFeatures: 25,
    vertexCount: 0,
    maxVertices: 1000,
    estimatedUrlLength: 0,
    maxEncodedLength: 50000,
    featuresOk: false,
    verticesOk: true,
    urlOk: true
};

const DURATION_MIN = 1;
const DURATION_MAX = 60;

function clampDurationSec(value) {
    return Math.min(DURATION_MAX, Math.max(DURATION_MIN, value));
}

function formatDurationSec(durationMs, fallbackMs = ORBIT_PACE_MS.normal) {
    return String(Math.round((durationMs ?? fallbackMs) / 1000));
}

function formatLimitNumber(value) {
    return Number(value ?? 0).toLocaleString();
}

export function PresentationLinkBuilder({
    layers = [],
    initialLayerId = '',
    loadInitialState,
    onRefreshSource,
    onBuildScene,
    onLayerFocus,
    onSelectAll,
    onClearSelection,
    onAddFeaturesOnMap,
    onPreview,
    onCopyUrl,
    onResetPreview,
    onSubscribeLayerSelection,
    onSubscribeSourceRefresh,
    onWidgetClose,
    onCancel
}) {
    const [formState, setFormState] = useState(null);
    const [sourceSummary, setSourceSummary] = useState(EMPTY_SUMMARY);
    const [limits, setLimits] = useState(EMPTY_LIMITS);
    const [validation, setValidation] = useState({ ok: false, errors: [], estimatedUrlLength: 0 });
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [picking, setPicking] = useState(false);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('');
    const [refreshTick, setRefreshTick] = useState(0);
    const [selectionCount, setSelectionCount] = useState(0);
    const [durationSec, setDurationSec] = useState(formatDurationSec(ORBIT_PACE_MS.normal));
    const durationEditingRef = useRef(false);

    const layerId = formState?.layerId || initialLayerId || '';

    const applyBundle = useCallback((bundle) => {
        if (bundle?.sourceSummary) setSourceSummary(bundle.sourceSummary);
        setRefreshTick((tick) => tick + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            setLoading(true);
            const initial = await loadInitialState?.();
            if (cancelled || !initial) return;
            setFormState(initial);
            setSourceSummary(initial.sourceSummary || EMPTY_SUMMARY);
            setDurationSec(formatDurationSec(initial.animation?.durationMs));
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [loadInitialState]);

    useEffect(() => {
        if (!layerId || !onSubscribeLayerSelection) {
            setSelectionCount(0);
            return undefined;
        }
        return onSubscribeLayerSelection(layerId, setSelectionCount);
    }, [layerId, onSubscribeLayerSelection]);

    useEffect(() => {
        if (layerId) onLayerFocus?.(layerId);
    }, [layerId, onLayerFocus]);

    useEffect(() => {
        if (!formState || durationEditingRef.current) return;
        const definition = getLinkAnimation(formState.animation?.presetId || 'none');
        setDurationSec(formatDurationSec(
            formState.animation?.durationMs,
            definition.ui.defaultDurationMs
        ));
    }, [formState?.animation?.durationMs, formState?.animation?.orbitPace, formState?.animation?.presetId]);

    useEffect(() => {
        if (!formState) return undefined;
        let cancelled = false;
        void (async () => {
            const result = await onBuildScene?.(formState);
            if (cancelled || !result) return;
            setValidation(result.validation || { ok: false, errors: [] });
            setLimits(result.limits || EMPTY_LIMITS);
            setUrl(result.url || '');
            if (result.sourceSummary) setSourceSummary(result.sourceSummary);
        })();
        return () => { cancelled = true; };
    }, [formState, onBuildScene, refreshTick]);

    useEffect(() => {
        if (!formState || !onSubscribeSourceRefresh) return undefined;
        return onSubscribeSourceRefresh(
            async () => {
                const bundle = await onRefreshSource?.(layerId);
                applyBundle(bundle);
            },
            () => setRefreshTick((tick) => tick + 1)
        );
    }, [formState, layerId, onSubscribeSourceRefresh, onRefreshSource, applyBundle]);

    useEffect(() => () => {
        onResetPreview?.();
        onWidgetClose?.();
    }, [onWidgetClose, onResetPreview]);

    const updateAnimation = (patch) => {
        setFormState((prev) => (prev ? {
            ...prev,
            animation: { ...prev.animation, ...patch }
        } : prev));
    };

    const updateLayerId = (nextLayerId) => {
        setFormState((prev) => (prev ? { ...prev, layerId: nextLayerId } : prev));
        setRefreshTick((tick) => tick + 1);
    };

    const commitDurationSec = (rawValue) => {
        durationEditingRef.current = false;
        const parsed = Number.parseInt(rawValue, 10);
        const clamped = clampDurationSec(Number.isFinite(parsed) ? parsed : DURATION_MIN);
        setDurationSec(String(clamped));
        updateAnimation({ durationMs: clamped * 1000, orbitPace: 'custom' });
    };

    const handleAddOnMap = async () => {
        if (!layerId) {
            setStatus('Choose a target layer first.');
            return;
        }
        setPicking(true);
        setStatus('');
        try {
            onResetPreview?.();
            const bundle = await onAddFeaturesOnMap?.(layerId);
            if (bundle) applyBundle(bundle);
        } catch (error) {
            setStatus(error?.message || 'Could not add features from the map');
        } finally {
            setPicking(false);
        }
    };

    const handlePreview = async () => {
        if (!formState) return;
        setBusy(true);
        setStatus('');
        try {
            await onPreview?.(formState);
        } catch (error) {
            setStatus(error?.message || 'Preview failed');
        } finally {
            setBusy(false);
        }
    };

    const handleCopy = async () => {
        if (!validation.ok || !url) {
            setStatus(validation.tooLargeMessage || validation.errors?.[0] || 'Select features within the limits first.');
            return;
        }
        try {
            await onCopyUrl?.(url);
            setStatus('Link copied. Paste it in a new browser tab to test the presentation.');
        } catch (error) {
            setStatus(error?.message || 'Could not copy URL');
        }
    };

    if (loading || !formState) {
        return (
            <WidgetPanelShell className="presentation-link-builder" showRun={false} footer={null}>
                <div className="text-sm text-muted">Checking map for features…</div>
            </WidgetPanelShell>
        );
    }

    const presetId = formState.animation?.presetId || 'none';
    const selectedDefinition = getLinkAnimation(presetId);
    const { ui } = selectedDefinition;
    const pacePresets = ui.pacePresetsMs ?? {};
    const geometryLabel = sourceSummary.geometryTypes?.join(', ') || 'Geometry';
    const statusTitle = validation.ok
        ? 'Ready to share'
        : (sourceSummary.featureCount > 0 ? 'Over presentation limits' : 'Need features');

    return (
        <WidgetPanelShell
            className="presentation-link-builder presentation-link-builder--simple"
            status={status}
            statusTone={validation.ok ? 'muted' : 'danger'}
            onCancel={() => { onResetPreview?.(); onCancel?.(); }}
            cancelLabel="Close"
            showRun={false}
            footer={(
                <div className="modal-footer presentation-link-builder__footer">
                    <button type="button" className="btn btn-secondary" onClick={() => { onResetPreview?.(); onCancel?.(); }}>
                        Close
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={busy || !validation.ok} onClick={() => { void handlePreview(); }}>
                        {busy ? 'Previewing…' : 'Preview'}
                    </button>
                    <button type="button" className="btn btn-primary" disabled={!validation.ok || !url} onClick={() => { void handleCopy(); }}>
                        Copy Link
                    </button>
                </div>
            )}
        >
            <p className="text-sm text-muted presentation-link-builder__intro">
                Select one or more features on a layer, choose an animation, then copy the link.
            </p>

            <LayerSelect
                label="Target layer"
                value={layerId}
                layers={layers}
                onChange={updateLayerId}
            />

            <div className={`presentation-link-builder__status-card${validation.ok ? ' is-ready' : ''}`}>
                <div className="presentation-link-builder__status-title">
                    {statusTitle}
                </div>
                <div className="text-sm">{sourceSummary.sourceLabel}</div>
                {sourceSummary.featureCount > 0 || selectionCount > 0 ? (
                    <div className="text-xs text-muted">
                        {geometryLabel}
                        {selectionCount > 0 && sourceSummary.featureCount === 0
                            ? ` · ${selectionCount} selected on map`
                            : null}
                    </div>
                ) : null}
                <div className={`presentation-link-builder__limits text-xs${validation.ok ? '' : ' is-over-limit'}`}>
                    {formatLimitNumber(limits.featureCount)} / {formatLimitNumber(limits.maxFeatures)} features
                    {' · '}
                    {formatLimitNumber(limits.vertexCount)} / {formatLimitNumber(limits.maxVertices)} vertices
                </div>
                {!validation.ok ? (
                    <div className="text-xs text-muted">
                        {validation.errors?.[0] || 'Select features on the map, or use Add on map.'}
                    </div>
                ) : null}
            </div>

            <div className="presentation-link-builder__btn-row gis-widget__btn-row">
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={picking || !layerId}
                    onClick={() => { void handleAddOnMap(); }}
                >
                    {picking ? 'Click map features…' : 'Add on map'}
                </button>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!layerId}
                    onClick={() => onSelectAll?.(layerId)}
                >
                    Select all
                </button>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!layerId}
                    onClick={() => onClearSelection?.(layerId)}
                >
                    Clear
                </button>
            </div>
            <p className="presentation-link-builder__hint text-xs text-muted">
                Ctrl/Shift+click or drag a box on the map to add more.
            </p>

            <div className="presentation-link-builder__row mt-12">
                <label className="field-label" htmlFor="presentation-animation">Animation</label>
                <select
                    id="presentation-animation"
                    className="input-sm w-full"
                    value={presetId}
                    onChange={(e) => {
                        const nextPreset = e.target.value;
                        const nextDefinition = getLinkAnimation(nextPreset);
                        const patch = { presetId: nextPreset };
                        if (nextDefinition.ui.showPace && formState.animation?.orbitPace !== 'custom') {
                            const pace = formState.animation?.orbitPace || 'normal';
                            patch.orbitPace = pace;
                            patch.durationMs = getDurationMsForPace(nextDefinition, pace);
                        }
                        updateAnimation(patch);
                    }}
                >
                    {listLinkAnimations().map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                </select>
                {selectedDefinition.usageHint ? (
                    <p className="presentation-link-builder__hint text-xs text-muted">{selectedDefinition.usageHint}</p>
                ) : null}
            </div>

            {ui.showPace ? (
                <div className="presentation-link-builder__row">
                    <label className="field-label" htmlFor="presentation-orbit-pace">
                        {ui.paceLabel}
                    </label>
                    <select
                        id="presentation-orbit-pace"
                        className="input-sm w-full"
                        value={formState.animation?.orbitPace || 'normal'}
                        onChange={(e) => {
                            const pace = e.target.value;
                            if (pace === 'custom') {
                                updateAnimation({ orbitPace: 'custom' });
                                return;
                            }
                            updateAnimation({
                                orbitPace: pace,
                                durationMs: pacePresets[pace] ?? ui.defaultDurationMs
                            });
                        }}
                    >
                        {(['slow', 'normal', 'fast']).map((pace) => (
                            <option key={pace} value={pace}>
                                {ui.paceOptionLabels?.[pace] ?? pace}
                            </option>
                        ))}
                        <option value="custom">Custom</option>
                    </select>
                </div>
            ) : null}

            {ui.showDuration ? (
                <div className="presentation-link-builder__row">
                    <label className="field-label" htmlFor="presentation-duration">
                        {ui.durationLabel ?? 'Duration (seconds)'}
                    </label>
                    <input
                        id="presentation-duration"
                        type="number"
                        className="input-sm w-full"
                        min={DURATION_MIN}
                        max={DURATION_MAX}
                        value={durationSec}
                        onChange={(e) => {
                            durationEditingRef.current = true;
                            setDurationSec(e.target.value);
                        }}
                        onBlur={(e) => commitDurationSec(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commitDurationSec(e.currentTarget.value);
                                e.currentTarget.blur();
                            }
                        }}
                    />
                </div>
            ) : null}

            <div className="presentation-link-builder__url text-xs mt-12" title={url}>
                {validation.ok
                    ? url
                    : (validation.errors?.[0] || 'Your presentation link will appear here after features are within limits.')}
            </div>
        </WidgetPanelShell>
    );
}
