import { useCallback, useEffect, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';
import { SOURCE_MODES } from '../../js/widgets/presentation-link-builder/engine.js';
import { listEasingOptions } from '../../js/presentation/animation-presets.js';

function FieldRow({ label, children }) {
    return (
        <div className="gis-widget__row">
            <label className="field-label">{label}</label>
            {children}
        </div>
    );
}

const EMPTY_SUMMARY = {
    featureCount: 0,
    geometryTypes: [],
    vertexCount: 0,
    spatialLayerCount: 0,
    mapLayerCount: 0,
    selectedCount: 0,
    hasHighlightedFeature: false,
    hasDrawnFeature: false
};

export function PresentationLinkBuilder({
    loadInitialState,
    onSourceModeChange,
    onBuildScene,
    onPreview,
    onCopyUrl,
    onResetPreview,
    onSubscribeSourceRefresh,
    onCancel
}) {
    const [formState, setFormState] = useState(null);
    const [sourceSummary, setSourceSummary] = useState(EMPTY_SUMMARY);
    const [validation, setValidation] = useState({ ok: false, errors: [], estimatedUrlLength: 0 });
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('');
    const [compatiblePresets, setCompatiblePresets] = useState([]);
    const [refreshTick, setRefreshTick] = useState(0);

    const refreshSourceSummary = useCallback(async (state) => {
        if (!state) return;
        const next = await onSourceModeChange?.(state.sourceMode);
        if (next?.sourceSummary) {
            setSourceSummary(next.sourceSummary);
        }
        setRefreshTick((tick) => tick + 1);
    }, [onSourceModeChange]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            setLoading(true);
            const initial = await loadInitialState?.();
            if (cancelled || !initial) return;
            setFormState(initial);
            setSourceSummary(initial.sourceSummary || EMPTY_SUMMARY);
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [loadInitialState]);

    useEffect(() => {
        if (!formState) return undefined;
        let cancelled = false;
        void (async () => {
            const result = await onBuildScene?.(formState);
            if (cancelled || !result) return;
            setValidation(result.validation || { ok: false, errors: [] });
            setUrl(result.url || '');
            setCompatiblePresets(result.compatiblePresets || []);
        })();
        return () => { cancelled = true; };
    }, [formState, onBuildScene, refreshTick]);

    useEffect(() => {
        if (!formState || !onSubscribeSourceRefresh) return undefined;
        return onSubscribeSourceRefresh(() => {
            void refreshSourceSummary(formState);
        });
    }, [formState, onSubscribeSourceRefresh, refreshSourceSummary]);

    const update = (patch) => setFormState((prev) => (prev ? { ...prev, ...patch } : prev));

    const handleSourceModeChange = (sourceMode) => {
        update({ sourceMode });
        void (async () => {
            const next = await onSourceModeChange?.(sourceMode);
            if (next?.sourceSummary) {
                setSourceSummary(next.sourceSummary);
            }
        })();
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
            setStatus(validation.tooLargeMessage || validation.errors?.[0] || 'Scene is not valid for a presentation URL.');
            return;
        }
        try {
            await onCopyUrl?.(url);
            setStatus('Presentation URL copied to clipboard.');
        } catch (error) {
            setStatus(error?.message || 'Could not copy URL');
        }
    };

    const handleReset = async () => {
        onResetPreview?.();
        setStatus('');
        const initial = await loadInitialState?.();
        if (!initial) return;
        setFormState(initial);
        setSourceSummary(initial.sourceSummary || EMPTY_SUMMARY);
    };

    const easingOptions = listEasingOptions();

    if (loading || !formState) {
        return (
            <WidgetPanelShell className="presentation-link-builder" showRun={false} footer={null}>
                <div className="text-sm text-muted">Loading map features…</div>
            </WidgetPanelShell>
        );
    }

    return (
        <WidgetPanelShell
            className="presentation-link-builder"
            status={status}
            statusTone={validation.ok ? 'muted' : 'danger'}
            onCancel={() => {
                onResetPreview?.();
                onCancel?.();
            }}
            cancelLabel="Close"
            showRun={false}
            footer={(
                <div className="modal-footer presentation-link-builder__footer">
                    <button type="button" className="btn btn-secondary" onClick={() => { onResetPreview?.(); onCancel?.(); }}>
                        Close
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => { void handleReset(); }}>
                        Reset
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={busy || !validation.ok} onClick={() => { void handlePreview(); }}>
                        {busy ? 'Previewing…' : 'Preview'}
                    </button>
                    <button type="button" className="btn btn-primary" disabled={!validation.ok || !url} onClick={() => { void handleCopy(); }}>
                        Copy URL
                    </button>
                </div>
            )}
        >
            <section className="presentation-link-builder__section">
                <h3 className="presentation-link-builder__heading">Source Features</h3>
                <FieldRow label="Use">
                    <select
                        className="input-sm w-full"
                        value={formState.sourceMode}
                        onChange={(e) => handleSourceModeChange(e.target.value)}
                    >
                        {SOURCE_MODES.map((mode) => (
                            <option key={mode.id} value={mode.id}>{mode.label}</option>
                        ))}
                    </select>
                </FieldRow>
                <div className="presentation-link-builder__summary text-xs text-muted">
                    <div>Layers on map: {sourceSummary.spatialLayerCount} ({sourceSummary.mapLayerCount} loaded)</div>
                    <div>Selected on map: {sourceSummary.selectedCount}</div>
                    <div>Highlighted feature: {sourceSummary.hasHighlightedFeature ? 'yes' : 'no'}</div>
                    <div>Drawn feature: {sourceSummary.hasDrawnFeature ? 'yes' : 'no'}</div>
                    <div>Presentation features: {sourceSummary.featureCount}</div>
                    <div>Geometry: {sourceSummary.geometryTypes?.join(', ') || '—'}</div>
                    <div>Vertices: {sourceSummary.vertexCount ?? 0}</div>
                    <div>Estimated URL size: {validation.estimatedUrlLength || 0} chars</div>
                    <div>{validation.ok ? 'Safe for presentation URL' : (validation.tooLargeMessage || validation.errors?.[0] || 'Select or click a feature on the map')}</div>
                </div>
            </section>

            <section className="presentation-link-builder__section">
                <h3 className="presentation-link-builder__heading">Presentation Layout</h3>
                <label className="presentation-link-builder__check">
                    <input
                        type="checkbox"
                        checked={formState.layout?.showLogo !== false}
                        onChange={(e) => update({ layout: { ...formState.layout, showLogo: e.target.checked } })}
                    />
                    Show GIS Toolbox logo
                </label>
                <label className="presentation-link-builder__check">
                    <input
                        type="checkbox"
                        checked={formState.layout?.showHomeButton !== false}
                        onChange={(e) => update({ layout: { ...formState.layout, showHomeButton: e.target.checked } })}
                    />
                    Show home button
                </label>
                <FieldRow label="Scene title (optional)">
                    <input
                        className="input-sm w-full"
                        value={formState.metadata?.title || ''}
                        onChange={(e) => update({ metadata: { ...formState.metadata, title: e.target.value } })}
                    />
                </FieldRow>
            </section>

            <section className="presentation-link-builder__section">
                <h3 className="presentation-link-builder__heading">Camera</h3>
                <label className="presentation-link-builder__check">
                    <input
                        type="checkbox"
                        checked={formState.camera?.useCurrent !== false}
                        onChange={(e) => update({ camera: { ...formState.camera, useCurrent: e.target.checked, fitToFeatures: !e.target.checked } })}
                    />
                    Use current map camera
                </label>
                <label className="presentation-link-builder__check">
                    <input
                        type="checkbox"
                        checked={!!formState.camera?.fitToFeatures}
                        onChange={(e) => update({ camera: { ...formState.camera, fitToFeatures: e.target.checked, useCurrent: !e.target.checked } })}
                    />
                    Fit to selected feature(s)
                </label>
                <div className="presentation-link-builder__grid">
                    <FieldRow label="Pitch">
                        <input
                            type="number"
                            className="input-sm w-full"
                            min="0"
                            max="85"
                            value={formState.camera?.pitch ?? 0}
                            onChange={(e) => update({ camera: { ...formState.camera, pitch: Number(e.target.value) } })}
                        />
                    </FieldRow>
                    <FieldRow label="Bearing">
                        <input
                            type="number"
                            className="input-sm w-full"
                            value={formState.camera?.bearing ?? 0}
                            onChange={(e) => update({ camera: { ...formState.camera, bearing: Number(e.target.value) } })}
                        />
                    </FieldRow>
                    <FieldRow label="Padding">
                        <input
                            type="number"
                            className="input-sm w-full"
                            min="0"
                            value={formState.camera?.padding ?? 80}
                            onChange={(e) => update({ camera: { ...formState.camera, padding: Number(e.target.value) } })}
                        />
                    </FieldRow>
                    <FieldRow label="Start delay (ms)">
                        <input
                            type="number"
                            className="input-sm w-full"
                            min="0"
                            value={formState.camera?.startDelayMs ?? 0}
                            onChange={(e) => update({ camera: { ...formState.camera, startDelayMs: Number(e.target.value) } })}
                        />
                    </FieldRow>
                </div>
                <label className="presentation-link-builder__check">
                    <input
                        type="checkbox"
                        checked={!!formState.camera?.resetNorth}
                        onChange={(e) => update({ camera: { ...formState.camera, resetNorth: e.target.checked } })}
                    />
                    Reset north before animation
                </label>
            </section>

            <section className="presentation-link-builder__section">
                <h3 className="presentation-link-builder__heading">Animation</h3>
                <FieldRow label="Preset">
                    <select
                        className="input-sm w-full"
                        value={formState.animation?.presetId || 'none'}
                        onChange={(e) => update({ animation: { ...formState.animation, presetId: e.target.value } })}
                    >
                        {compatiblePresets.map((preset) => (
                            <option key={preset.id} value={preset.id} disabled={!preset.compatible}>
                                {preset.label}
                            </option>
                        ))}
                    </select>
                </FieldRow>
                <div className="presentation-link-builder__grid">
                    <FieldRow label="Duration (ms)">
                        <input
                            type="number"
                            className="input-sm w-full"
                            min="0"
                            value={formState.animation?.durationMs ?? 3000}
                            onChange={(e) => update({ animation: { ...formState.animation, durationMs: Number(e.target.value) } })}
                        />
                    </FieldRow>
                    <FieldRow label="Delay (ms)">
                        <input
                            type="number"
                            className="input-sm w-full"
                            min="0"
                            value={formState.animation?.delayMs ?? 0}
                            onChange={(e) => update({ animation: { ...formState.animation, delayMs: Number(e.target.value) } })}
                        />
                    </FieldRow>
                </div>
                <FieldRow label="Easing">
                    <select
                        className="input-sm w-full"
                        value={formState.animation?.easing || 'easeInOut'}
                        onChange={(e) => update({ animation: { ...formState.animation, easing: e.target.value } })}
                    >
                        {easingOptions.map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                    </select>
                </FieldRow>
                <label className="presentation-link-builder__check">
                    <input
                        type="checkbox"
                        checked={!!formState.animation?.loop}
                        onChange={(e) => update({ animation: { ...formState.animation, loop: e.target.checked } })}
                    />
                    Loop animation
                </label>
            </section>

            <section className="presentation-link-builder__section">
                <h3 className="presentation-link-builder__heading">Output</h3>
                <div className="presentation-link-builder__url text-xs" title={url}>
                    {validation.ok ? url : 'URL will appear when the scene is valid.'}
                </div>
                <div className="text-xs text-muted mt-8">GIF/MP4 export — coming in a future release.</div>
            </section>
        </WidgetPanelShell>
    );
}
