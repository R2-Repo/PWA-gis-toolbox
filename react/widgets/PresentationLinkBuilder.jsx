import { useCallback, useEffect, useState } from 'react';
import { WidgetPanelShell } from './shared/WidgetPanelShell.jsx';

const EMPTY_SUMMARY = {
    featureCount: 0,
    geometryTypes: [],
    vertexCount: 0,
    sourceLabel: 'Click Pick on map or select a feature first',
    isEmpty: true
};

export function PresentationLinkBuilder({
    loadInitialState,
    onRefreshSource,
    onBuildScene,
    onPickFeature,
    onPreview,
    onCopyUrl,
    onResetPreview,
    onSubscribeSourceRefresh,
    onWidgetClose,
    onCancel
}) {
    const [formState, setFormState] = useState(null);
    const [sourceSummary, setSourceSummary] = useState(EMPTY_SUMMARY);
    const [validation, setValidation] = useState({ ok: false, errors: [], estimatedUrlLength: 0 });
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [picking, setPicking] = useState(false);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('');
    const [refreshTick, setRefreshTick] = useState(0);

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
            if (result.sourceSummary) setSourceSummary(result.sourceSummary);
        })();
        return () => { cancelled = true; };
    }, [formState, onBuildScene, refreshTick]);

    useEffect(() => {
        if (!formState || !onSubscribeSourceRefresh) return undefined;
        return onSubscribeSourceRefresh(
            async () => {
                const bundle = await onRefreshSource?.();
                applyBundle(bundle);
            },
            () => setRefreshTick((tick) => tick + 1)
        );
    }, [formState, onSubscribeSourceRefresh, onRefreshSource, applyBundle]);

    useEffect(() => () => { onWidgetClose?.(); }, [onWidgetClose]);

    const updateAnimation = (patch) => {
        setFormState((prev) => (prev ? {
            ...prev,
            animation: { ...prev.animation, ...patch }
        } : prev));
    };

    const handlePick = async () => {
        setPicking(true);
        setStatus('');
        try {
            onResetPreview?.();
            const bundle = await onPickFeature?.();
            if (bundle) applyBundle(bundle);
        } catch (error) {
            setStatus(error?.message || 'Could not pick a feature');
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
            setStatus(validation.tooLargeMessage || validation.errors?.[0] || 'Pick a small feature first.');
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
                Create a clean fullscreen map link from one small feature. Pick the feature on the map, choose a simple animation, then copy the link.
            </p>

            <div className={`presentation-link-builder__status-card${validation.ok ? ' is-ready' : ''}`}>
                <div className="presentation-link-builder__status-title">
                    {validation.ok ? 'Ready to share' : 'Need a feature'}
                </div>
                <div className="text-sm">{sourceSummary.sourceLabel}</div>
                {sourceSummary.featureCount > 0 ? (
                    <div className="text-xs text-muted">
                        {sourceSummary.geometryTypes?.join(', ') || 'Geometry'} · {sourceSummary.vertexCount ?? 0} vertices
                    </div>
                ) : null}
                {!validation.ok ? (
                    <div className="text-xs text-muted">
                        {validation.errors?.[0] || 'Use Pick on map if you already selected a feature but the count is still zero.'}
                    </div>
                ) : null}
            </div>

            <button
                type="button"
                className="btn btn-secondary btn-sm w-full"
                disabled={picking}
                onClick={() => { void handlePick(); }}
            >
                {picking ? 'Click a feature on the map…' : 'Pick on map'}
            </button>

            <div className="presentation-link-builder__row mt-12">
                <label className="field-label" htmlFor="presentation-animation">Animation</label>
                <select
                    id="presentation-animation"
                    className="input-sm w-full"
                    value={formState.animation?.presetId || 'none'}
                    onChange={(e) => updateAnimation({ presetId: e.target.value })}
                >
                    <option value="none">None</option>
                    <option value="flyToFeature">Fly to feature</option>
                    <option value="rotateAroundFeature">Orbit around feature</option>
                </select>
            </div>

            <div className="presentation-link-builder__row">
                <label className="field-label" htmlFor="presentation-duration">Duration (seconds)</label>
                <input
                    id="presentation-duration"
                    type="number"
                    className="input-sm w-full"
                    min="1"
                    max="30"
                    value={Math.max(1, Math.round((formState.animation?.durationMs ?? 3000) / 1000))}
                    onChange={(e) => updateAnimation({ durationMs: Number(e.target.value) * 1000 })}
                />
            </div>

            <div className="presentation-link-builder__url text-xs mt-12" title={url}>
                {validation.ok ? url : 'Your presentation link will appear here after a feature is picked.'}
            </div>
        </WidgetPanelShell>
    );
}
