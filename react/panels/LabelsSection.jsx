import { useMemo } from 'react';
import { normalizeStyle } from '../../js/map/style-engine.js';
import {
    DEFAULT_LAYER_LABELS,
    normalizeLayerLabels,
    pickLabelField,
    sampleFieldValues,
    fieldEmptyRatio
} from '../../js/map/map-labels.js';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';

function detectGeomTypes(layer) {
    const types = new Set();
    for (const f of layer?.geojson?.features || []) {
        const t = f.geometry?.type;
        if (t === 'Point' || t === 'MultiPoint') types.add('point');
        else if (t === 'LineString' || t === 'MultiLineString') types.add('line');
        else if (t === 'Polygon' || t === 'MultiPolygon') types.add('polygon');
    }
    if (!types.size && layer?.schema?.geometryType) {
        const gt = String(layer.schema.geometryType);
        if (gt === 'Point' || gt === 'MultiPoint') types.add('point');
        else if (gt.includes('Line')) types.add('line');
        else if (gt.includes('Polygon')) types.add('polygon');
    }
    return types;
}

export function LabelsSection({ layer, style: externalStyle, defaultColor = '#2563eb', onStyleChange }) {
    const geomTypes = useMemo(() => detectGeomTypes(layer), [layer]);
    const hasPoints = geomTypes.has('point');
    const hasLines = geomTypes.has('line');

    const fields = useMemo(
        () => (layer?.schema?.fields || []).filter((f) => f.selected !== false && f.name),
        [layer?.schema?.fields]
    );

    const style = useMemo(
        () => normalizeStyle(externalStyle, defaultColor),
        [externalStyle, defaultColor]
    );

    const labels = useMemo(
        () => normalizeLayerLabels(style.labels),
        [style.labels]
    );

    const setLabels = (patch) => {
        onStyleChange?.({ ...style, labels: { ...labels, ...patch } });
    };

    const handleEnable = (enabled) => {
        const patch = { enabled };
        if (enabled && !labels.field) {
            const suggested = pickLabelField(fields);
            if (suggested) patch.field = suggested.name;
        }
        setLabels(patch);
    };

    const samples = useMemo(
        () => sampleFieldValues(layer?.geojson?.features || [], labels.field, 3),
        [layer?.geojson?.features, labels.field]
    );

    const emptyRatio = useMemo(
        () => fieldEmptyRatio(layer?.geojson?.features || [], labels.field),
        [layer?.geojson?.features, labels.field]
    );

    const placementHint = labels.placement === 'line'
        ? 'Labels follow line geometry'
        : hasPoints
            ? 'Labels at point locations'
            : 'Point placement requires point features';

    if (!fields.length) {
        return (
            <CollapsibleSection title="Labels" defaultOpen={false} className="labels-panel">
                <p className="text-muted text-xs">No attribute fields available for labeling.</p>
            </CollapsibleSection>
        );
    }

    return (
        <CollapsibleSection title="Labels" defaultOpen={false} className="labels-panel">
            <label className="toggle mb-8">
                <input
                    type="checkbox"
                    checked={!!labels.enabled}
                    onChange={(e) => handleEnable(e.target.checked)}
                />
                <span className="toggle-track"></span>
                <span>Show labels</span>
            </label>

            {labels.enabled ? (
                <>
                    <div className="style-row">
                        <label>Label field</label>
                        <select
                            className="style-select"
                            value={labels.field || ''}
                            onChange={(e) => setLabels({ field: e.target.value })}
                        >
                            <option value="">— select field —</option>
                            {fields.map((f) => (
                                <option key={f.name} value={f.name}>{f.outputName || f.name}</option>
                            ))}
                        </select>
                    </div>

                    {labels.field ? (
                        <>
                            {samples.length ? (
                                <p className="text-muted text-xs mb-8">
                                    Examples: {samples.map((s) => `"${s}"`).join(', ')}
                                </p>
                            ) : (
                                <p className="text-muted text-xs mb-8">No sample values in current view.</p>
                            )}
                            {emptyRatio > 0.5 ? (
                                <div className="warning-box text-xs mb-8">
                                    Many features have an empty value for this field.
                                </div>
                            ) : null}
                        </>
                    ) : null}

                    <p className="text-muted text-xs mb-8">{placementHint}</p>

                    <div className="style-row">
                        <label>Size</label>
                        <input
                            type="range"
                            className="style-range"
                            min="8"
                            max="24"
                            step="1"
                            value={labels.size ?? 11}
                            onChange={(e) => setLabels({ size: parseInt(e.target.value, 10) })}
                        />
                        <span className="style-value">{labels.size ?? 11} pt</span>
                    </div>

                    <div className="style-row">
                        <label>Color</label>
                        <input
                            type="color"
                            className="style-color-input"
                            value={labels.color || '#111111'}
                            onChange={(e) => setLabels({ color: e.target.value })}
                        />
                    </div>

                    {(hasPoints && hasLines) || hasLines ? (
                        <div className="style-row">
                            <label>Placement</label>
                            <div className="labels-placement-options">
                                {hasPoints ? (
                                    <label className="labels-placement-option">
                                        <input
                                            type="radio"
                                            name={`labels-placement-${layer?.id}`}
                                            checked={labels.placement !== 'line'}
                                            onChange={() => setLabels({ placement: 'point' })}
                                        />
                                        <span>At point</span>
                                    </label>
                                ) : null}
                                {hasLines ? (
                                    <label className="labels-placement-option">
                                        <input
                                            type="radio"
                                            name={`labels-placement-${layer?.id}`}
                                            checked={labels.placement === 'line'}
                                            onChange={() => setLabels({ placement: 'line' })}
                                        />
                                        <span>Along line</span>
                                    </label>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    <details className="smart-style-advanced">
                        <summary className="smart-style-advanced-title">Advanced</summary>
                        <div className="smart-style-advanced-body">
                            <div className="style-row">
                                <label>Min zoom</label>
                                <input
                                    type="number"
                                    className="smart-style-num-input"
                                    min="0"
                                    max="22"
                                    step="1"
                                    value={labels.minZoom ?? DEFAULT_LAYER_LABELS.minZoom}
                                    onChange={(e) => setLabels({ minZoom: parseInt(e.target.value, 10) || 0 })}
                                />
                            </div>
                            <div className="style-row">
                                <label>Max zoom</label>
                                <input
                                    type="number"
                                    className="smart-style-num-input"
                                    min="0"
                                    max="22"
                                    step="1"
                                    value={labels.maxZoom ?? DEFAULT_LAYER_LABELS.maxZoom}
                                    onChange={(e) => setLabels({ maxZoom: parseInt(e.target.value, 10) || 0 })}
                                />
                            </div>
                            <p className="text-muted text-xs mb-8">
                                Labels show within this zoom window. Layer Visibility Range can further restrict when labels appear.
                            </p>
                            <div className="style-row">
                                <label>Halo</label>
                                <input
                                    type="color"
                                    className="style-color-input"
                                    value={labels.haloColor || '#ffffff'}
                                    onChange={(e) => setLabels({ haloColor: e.target.value })}
                                />
                                <input
                                    type="number"
                                    className="smart-style-num-input"
                                    min="0"
                                    max="4"
                                    step="0.5"
                                    title="Halo width"
                                    value={labels.haloWidth ?? 1.5}
                                    onChange={(e) => setLabels({ haloWidth: parseFloat(e.target.value) })}
                                />
                            </div>
                            <div className="style-row">
                                <label>Offset X</label>
                                <input
                                    type="number"
                                    className="smart-style-num-input"
                                    step="0.1"
                                    value={labels.offset?.[0] ?? 0}
                                    onChange={(e) => setLabels({
                                        offset: [parseFloat(e.target.value) || 0, labels.offset?.[1] ?? 1.1]
                                    })}
                                />
                                <label>Y</label>
                                <input
                                    type="number"
                                    className="smart-style-num-input"
                                    step="0.1"
                                    value={labels.offset?.[1] ?? 1.1}
                                    onChange={(e) => setLabels({
                                        offset: [labels.offset?.[0] ?? 0, parseFloat(e.target.value) || 0]
                                    })}
                                />
                            </div>
                            <div className="style-row">
                                <label>Anchor</label>
                                <select
                                    className="style-select"
                                    value={labels.anchor || 'top'}
                                    onChange={(e) => setLabels({ anchor: e.target.value })}
                                >
                                    <option value="top">Top</option>
                                    <option value="bottom">Bottom</option>
                                    <option value="center">Center</option>
                                    <option value="left">Left</option>
                                    <option value="right">Right</option>
                                </select>
                            </div>
                            <label className="toggle mb-8">
                                <input
                                    type="checkbox"
                                    checked={!!labels.allowOverlap}
                                    onChange={(e) => setLabels({ allowOverlap: e.target.checked })}
                                />
                                <span className="toggle-track"></span>
                                <span>Allow overlap</span>
                            </label>
                            {labels.placement === 'line' ? (
                                <label className="toggle mb-8">
                                    <input
                                        type="checkbox"
                                        checked={labels.writingMode === 'vertical'}
                                        onChange={(e) => setLabels({
                                            writingMode: e.target.checked ? 'vertical' : null
                                        })}
                                    />
                                    <span className="toggle-track"></span>
                                    <span>Vertical text (lines)</span>
                                </label>
                            ) : null}
                            {labels.placement !== 'line' ? (
                                <label className="toggle mb-8">
                                    <input
                                        type="checkbox"
                                        checked={!!labels.verticalStack}
                                        onChange={(e) => setLabels({ verticalStack: e.target.checked })}
                                    />
                                    <span className="toggle-track"></span>
                                    <span>Vertical stack</span>
                                </label>
                            ) : null}
                        </div>
                    </details>
                </>
            ) : null}
        </CollapsibleSection>
    );
}
