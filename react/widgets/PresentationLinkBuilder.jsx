import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import bus from '../../js/core/event-bus.js';
import {
    getPresentationLinkSceneBundle,
    subscribePresentationLinkSceneBundle
} from '../../js/widgets/presentation-link-builder/scene-store.js';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import {
    listLinkAnimations,
    getLinkAnimation,
    getDurationMsForPace,
    ORBIT_PACE_MS
} from '../../js/presentation/presentation-link-animations.js';
import { defaultSequenceSteps } from '../../js/presentation/presentation-sequence-compiler.js';
import { AnimationSequenceList } from './presentation/AnimationSequenceList.jsx';

const EMPTY_SUMMARY = {
    featureCount: 0,
    geometryTypes: [],
    vertexCount: 0,
    sourceLabel: 'Click features on the map or use the buttons below',
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

const PRESENTATION_LINK_SCENE_BUNDLE = 'presentation-link:scene-bundle';

export function PresentationLinkBuilder({
    layers = [],
    getLayerOptions,
    initialLayerId = '',
    loadInitialState,
    onRefreshSource,
    reportFormState,
    onRegisterSceneApplier,
    onLayerFocus,
    onSelectAll,
    onClearSelection,
    onClearAllSelections,
    onPreview,
    onCopyUrl,
    onCopyEmbed,
    onExportGif,
    onExportVideo,
    onResetPreview,
    onSubscribeLayerSelection,
    onSubscribeSourceRefresh,
    onCancel
}) {
    const [formState, setFormState] = useState(null);
    const [sourceSummary, setSourceSummary] = useState(EMPTY_SUMMARY);
    const [limits, setLimits] = useState(EMPTY_LIMITS);
    const [validation, setValidation] = useState({ ok: false, errors: [], estimatedUrlLength: 0 });
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('');
    const [selectionCount, setSelectionCount] = useState(0);
    const [layerOptions, setLayerOptions] = useState(layers);
    const [compatiblePresets, setCompatiblePresets] = useState([]);
    const [exportAvailability, setExportAvailability] = useState(null);
    const [exportBusy, setExportBusy] = useState(false);
    const [exportLabel, setExportLabel] = useState('');
    const [durationSec, setDurationSec] = useState(formatDurationSec(ORBIT_PACE_MS.normal));
    const durationEditingRef = useRef(false);

    const focusedLayerId = formState?.focusedLayerId || initialLayerId || '';

    const refreshLayerOptions = useCallback(() => {
        const next = getLayerOptions?.() || layers;
        if (next?.length) setLayerOptions(next);
    }, [getLayerOptions, layers]);

    const applySceneBundle = useCallback((bundle) => {
        if (!bundle) return;
        const selectedCount = bundle.sourceSummary?.selectedCount ?? 0;
        const builtFeatureCount = bundle.limits?.featureCount ?? 0;
        if (builtFeatureCount === 0 && selectedCount > 0) return;
        setValidation(bundle.validation || { ok: false, errors: [] });
        setLimits(bundle.limits || EMPTY_LIMITS);
        setUrl(bundle.url || '');
        if (bundle.compatiblePresets) setCompatiblePresets(bundle.compatiblePresets);
        if (bundle.exportAvailability) setExportAvailability(bundle.exportAvailability);
        if (bundle.sourceSummary) setSourceSummary(bundle.sourceSummary);
    }, []);

    const sceneBundle = useSyncExternalStore(
        subscribePresentationLinkSceneBundle,
        getPresentationLinkSceneBundle,
        () => null
    );

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
        if (!formState || !onSubscribeLayerSelection) {
            setSelectionCount(0);
            return undefined;
        }
        return onSubscribeLayerSelection(formState, ({ count, selectionLayerId }) => {
            setSelectionCount(count);
            if (selectionLayerId) {
                setFormState((prev) => (
                    prev && prev.focusedLayerId !== selectionLayerId
                        ? { ...prev, focusedLayerId: selectionLayerId }
                        : prev
                ));
            }
            refreshLayerOptions();
        });
    }, [Boolean(formState), onSubscribeLayerSelection, refreshLayerOptions]);

    useEffect(() => {
        refreshLayerOptions();
    }, [refreshLayerOptions]);

    useEffect(() => {
        if (focusedLayerId) onLayerFocus?.(focusedLayerId);
    }, [focusedLayerId, onLayerFocus]);

    useEffect(() => {
        if (!formState || durationEditingRef.current) return;
        if ((formState.animation?.mode || 'preset') !== 'preset') return;
        const definition = getLinkAnimation(formState.animation?.presetId || 'none');
        setDurationSec(formatDurationSec(
            formState.animation?.durationMs,
            definition.ui.defaultDurationMs
        ));
    }, [formState?.animation?.durationMs, formState?.animation?.orbitPace, formState?.animation?.presetId, formState?.animation?.mode]);

    useEffect(() => {
        reportFormState?.(formState);
    }, [formState, reportFormState]);

    useEffect(() => {
        if (!onRegisterSceneApplier) return undefined;
        return onRegisterSceneApplier(applySceneBundle);
    }, [applySceneBundle, onRegisterSceneApplier]);

    useEffect(() => {
        if (sceneBundle) applySceneBundle(sceneBundle);
    }, [sceneBundle, applySceneBundle]);

    useEffect(() => {
        const handler = (bundle) => applySceneBundle(bundle);
        bus.on(PRESENTATION_LINK_SCENE_BUNDLE, handler);
        return () => bus.off(PRESENTATION_LINK_SCENE_BUNDLE, handler);
    }, [applySceneBundle]);

    useEffect(() => {
        if (!formState || !onSubscribeSourceRefresh) return undefined;
        return onSubscribeSourceRefresh(refreshLayerOptions);
    }, [formState, onSubscribeSourceRefresh, refreshLayerOptions]);

    const updateAnimation = (patch) => {
        setFormState((prev) => (prev ? {
            ...prev,
            animation: { ...prev.animation, ...patch }
        } : prev));
    };

    const focusLayer = (layerId) => {
        onLayerFocus?.(layerId);
        setFormState((prev) => (prev ? { ...prev, focusedLayerId: layerId } : prev));
        refreshLayerOptions();
    };

    const handleSelectAll = () => {
        if (!focusedLayerId || !formState) return;
        onSelectAll?.(formState);
        refreshLayerOptions();
    };

    const commitDurationSec = (rawValue) => {
        durationEditingRef.current = false;
        const parsed = Number.parseInt(rawValue, 10);
        const clamped = clampDurationSec(Number.isFinite(parsed) ? parsed : DURATION_MIN);
        setDurationSec(String(clamped));
        updateAnimation({ durationMs: clamped * 1000, orbitPace: 'custom' });
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

    const runExport = async (label, task) => {
        if (!formState || !validation.ok) return;
        setExportBusy(true);
        setExportLabel(label);
        setStatus('');
        try {
            await task();
        } catch (error) {
            setStatus(error?.message || `${label} failed`);
        } finally {
            setExportBusy(false);
            setExportLabel('');
        }
    };

    const handleCopyEmbed = () => runExport('Embed', async () => {
        await onCopyEmbed?.(formState);
        setStatus('Embed code copied. Paste it into a web page or document.');
    });

    const handleExportGif = () => runExport('GIF', async () => {
        await onExportGif?.(formState, (progress) => {
            setExportLabel(`GIF ${Math.round(progress * 100)}%`);
        });
        setStatus('GIF saved to your downloads folder.');
    });

    const handleExportVideo = () => runExport('Video', async () => {
        await onExportVideo?.(formState, (progress) => {
            setExportLabel(`Video ${Math.round(progress * 100)}%`);
        });
        setStatus('Video saved to your downloads folder.');
    });

    const gifExport = exportAvailability?.gif;
    const videoExport = exportAvailability?.mp4;
    const embedExport = exportAvailability?.embed;
    const exportWarnings = [
        ...(gifExport?.warnings || []),
        ...(videoExport?.warnings || [])
    ].filter(Boolean);
    const isBusy = busy || exportBusy;

    if (loading || !formState) {
        return (
            <WidgetPanelShell className="presentation-link-builder" showRun={false} footer={null}>
                <div className="text-sm text-muted">Checking map for features…</div>
            </WidgetPanelShell>
        );
    }

    const presetId = formState.animation?.presetId || 'none';
    const animationMode = formState.animation?.mode || 'preset';
    const selectedDefinition = getLinkAnimation(presetId);
    const { ui } = selectedDefinition;
    const pacePresets = ui.pacePresetsMs ?? {};
    const compatibilityById = Object.fromEntries(
        (compatiblePresets.length ? compatiblePresets : listLinkAnimations().map((entry) => ({
            id: entry.id,
            compatible: true
        }))).map((entry) => [entry.id, entry.compatible])
    );
    const geometryLabel = sourceSummary.geometryTypes?.join(', ') || 'Geometry';
    const statusTitle = validation.ok
        ? 'Ready to share'
        : ((limits.featureCount ?? 0) > 0 ? 'Over presentation limits' : 'Need features');

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
                    <button type="button" className="btn btn-secondary" disabled={isBusy || !validation.ok} onClick={() => { void handlePreview(); }}>
                        {busy ? 'Previewing…' : 'Preview'}
                    </button>
                    <button type="button" className="btn btn-primary" disabled={!validation.ok || !url || isBusy} onClick={() => { void handleCopy(); }}>
                        Copy Link
                    </button>
                </div>
            )}
        >
            <p className="text-sm text-muted presentation-link-builder__intro">
                Click features on any layer to add them. Shift/Ctrl+click or drag a box to add more on the focused layer.
            </p>

            <div className="presentation-link-builder__section">
                <div className="presentation-link-builder__heading">Layers</div>
                {layerOptions.length === 0 ? (
                    <p className="text-xs text-muted">No spatial layers loaded.</p>
                ) : (
                    <div className="presentation-link-builder__layer-list">
                        {layerOptions.map((layer) => {
                            const isFocused = focusedLayerId === layer.id;
                            const selectedOnLayer = layer.selectedCount ?? 0;
                            return (
                                <button
                                    key={layer.id}
                                    type="button"
                                    className={[
                                        'presentation-link-builder__layer-row',
                                        isFocused ? 'is-focused' : '',
                                        selectedOnLayer > 0 ? 'has-selection' : ''
                                    ].filter(Boolean).join(' ')}
                                    onClick={() => focusLayer(layer.id)}
                                >
                                    <span className="presentation-link-builder__layer-name">{layer.name}</span>
                                    <span className="presentation-link-builder__layer-meta text-muted">
                                        {selectedOnLayer > 0
                                            ? `${selectedOnLayer} selected`
                                            : `${layer.featureCount ?? 0} features`}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
                <p className="presentation-link-builder__hint text-xs text-muted">
                    Highlighted layer is used for box select and Select all. Clicks work on any visible layer.
                </p>
            </div>

            <div className={`presentation-link-builder__status-card${validation.ok ? ' is-ready' : ''}`}>
                <div className="presentation-link-builder__status-title">
                    {statusTitle}
                </div>
                <div className="text-sm">{sourceSummary.sourceLabel}</div>
                {sourceSummary.featureCount > 0 || selectionCount > 0 ? (
                    <div className="text-xs text-muted">
                        {geometryLabel}
                        {selectionCount > 0 ? ` · ${selectionCount} selected total` : null}
                    </div>
                ) : null}
                <div className={`presentation-link-builder__limits text-xs${validation.ok ? '' : ' is-over-limit'}`}>
                    {formatLimitNumber(limits.featureCount)} / {formatLimitNumber(limits.maxFeatures)} features
                    {' · '}
                    {formatLimitNumber(limits.vertexCount)} / {formatLimitNumber(limits.maxVertices)} vertices
                </div>
                {!validation.ok ? (
                    <div className="text-xs text-muted">
                        {validation.errors?.[0] || 'Select features on the map.'}
                    </div>
                ) : null}
            </div>

            <div className="presentation-link-builder__btn-row gis-widget__btn-row">
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!focusedLayerId}
                    onClick={handleSelectAll}
                >
                    Select all
                </button>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!focusedLayerId}
                    onClick={() => onClearSelection?.(formState)}
                >
                    Clear layer
                </button>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={selectionCount === 0}
                    onClick={() => onClearAllSelections?.()}
                >
                    Clear all
                </button>
            </div>

            <div className="presentation-link-builder__row mt-12">
                <div className="presentation-link-builder__heading">Animation</div>
                <div className="presentation-link-builder__mode-toggle gis-widget__btn-row">
                    <button
                        type="button"
                        className={`btn btn-sm${animationMode === 'preset' ? ' btn-primary' : ' btn-secondary'}`}
                        onClick={() => updateAnimation({ mode: 'preset' })}
                    >
                        Preset
                    </button>
                    <button
                        type="button"
                        className={`btn btn-sm${animationMode === 'sequence' ? ' btn-primary' : ' btn-secondary'}`}
                        onClick={() => {
                            const steps = formState.animation?.steps?.length
                                ? formState.animation.steps
                                : defaultSequenceSteps();
                            updateAnimation({ mode: 'sequence', steps });
                        }}
                    >
                        Custom sequence
                    </button>
                </div>
            </div>

            {animationMode === 'preset' ? (
                <>
                    <div className="presentation-link-builder__row">
                        <label className="field-label" htmlFor="presentation-animation">Choose animation</label>
                        <select
                            id="presentation-animation"
                            className="input-sm w-full"
                            value={presetId}
                            onChange={(e) => {
                                const nextPreset = e.target.value;
                                const nextDefinition = getLinkAnimation(nextPreset);
                                const patch = { presetId: nextPreset, mode: 'preset' };
                                if (nextDefinition.ui.showPace && formState.animation?.orbitPace !== 'custom') {
                                    const pace = formState.animation?.orbitPace || 'normal';
                                    patch.orbitPace = pace;
                                    patch.durationMs = getDurationMsForPace(nextDefinition, pace);
                                }
                                updateAnimation(patch);
                            }}
                        >
                            {listLinkAnimations().map((option) => (
                                <option
                                    key={option.id}
                                    value={option.id}
                                    disabled={compatibilityById[option.id] === false}
                                >
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        {selectedDefinition.usageHint ? (
                            <p className="presentation-link-builder__hint text-xs text-muted">{selectedDefinition.usageHint}</p>
                        ) : null}
                        {compatibilityById[presetId] === false ? (
                            <p className="presentation-link-builder__hint text-xs text-muted">
                                This animation does not match the selected feature geometry.
                            </p>
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
                </>
            ) : (
                <AnimationSequenceList
                    steps={formState.animation?.steps || []}
                    compatibilityById={compatibilityById}
                    onChange={(steps) => updateAnimation({ mode: 'sequence', steps })}
                />
            )}

            <div className="presentation-link-builder__section presentation-link-builder__export mt-12">
                <div className="presentation-link-builder__heading">Share &amp; export</div>
                <div className="presentation-link-builder__export-grid">
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={!validation.ok || isBusy || embedExport?.ok === false}
                        title={embedExport?.errors?.[0]}
                        onClick={() => { void handleCopyEmbed(); }}
                    >
                        {exportLabel === 'Embed' ? 'Copying…' : 'Copy embed'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={!validation.ok || isBusy || gifExport?.ok === false}
                        title={gifExport?.errors?.[0] || 'Best under 20 seconds'}
                        onClick={() => { void handleExportGif(); }}
                    >
                        {exportLabel.startsWith('GIF') ? exportLabel : 'Download GIF'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={!validation.ok || isBusy || videoExport?.ok === false}
                        title={videoExport?.errors?.[0] || 'Best under 60 seconds'}
                        onClick={() => { void handleExportVideo(); }}
                    >
                        {exportLabel.startsWith('Video') ? exportLabel : 'Download video'}
                    </button>
                </div>
                {exportWarnings.length > 0 ? (
                    <p className="presentation-link-builder__hint text-xs text-muted">
                        {exportWarnings[0]}
                    </p>
                ) : (
                    <p className="presentation-link-builder__hint text-xs text-muted">
                        GIF and video use the same smooth playback as Preview. GIF works best under 20s.
                    </p>
                )}
            </div>

            <div className="presentation-link-builder__url text-xs mt-12" title={url}>
                {validation.ok
                    ? url
                    : (validation.errors?.[0] || 'Your presentation link will appear here after features are within limits.')}
            </div>
        </WidgetPanelShell>
    );
}
