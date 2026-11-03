import { useMemo } from 'react';
import { normalizeStyle } from '../../js/map/style-engine.js';
import {
    normalizeLayerLabels,
    pickLabelField,
    sampleFieldValues,
    fieldEmptyRatio,
    labelPlacementHint,
    formatLabelText,
    labelUsesFormat
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
    const hasPolygons = geomTypes.has('polygon');

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
        if (enabled && hasLines && !hasPoints && !hasPolygons) {
            patch.placement = 'line';
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

    const placementHint = labelPlacementHint({
        placement: labels.placement,
        hasPoints,
        hasPolygons
    });

    const templateOn = String(labels.template || '').trim() !== '';
    const preview = useMemo(() => {
        if (!labels.field || !labelUsesFormat(labels)) return '';
        const feature = (layer?.geojson?.features || []).find((item) => item?.properties);
        if (!feature) return '';
        return formatLabelText(feature.properties, labels);
    }, [layer?.geojson?.features, labels]);

    const expressionNote = labels.expressionNote
        ? (
            <p className="labels-expression-note text-xs mb-8">{labels.expressionNote}</p>
        )
        : null;

    if (!fields.length) {
        return (
            <CollapsibleSection title="Labels" defaultOpen={false} className="labels-panel">
                {expressionNote}
                <p className="text-muted text-xs">No attribute fields available for labeling.</p>
            </CollapsibleSection>
        );
    }

    return (
        <CollapsibleSection title="Labels" defaultOpen={false} className="labels-panel">
            {expressionNote}
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
                            aria-label="Label field"
                            value={labels.field || ''}
                            onChange={(e) => {
                                const field = e.target.value;
                                const patch = { field };
                                if (labels.field2 === field) patch.field2 = '';
                                setLabels(patch);
                            }}
                        >
                            <option value="">— select field —</option>
                            {fields.map((f) => (
                                <option key={f.name} value={f.name}>{f.outputName || f.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="style-row">
                        <label>Field 2</label>
                        <select
                            className="style-select"
                            aria-label="Second field"
                            value={labels.field2 || ''}
                            onChange={(e) => setLabels({ field2: e.target.value })}
                        >
                            <option value="">— none —</option>
                            {fields.filter((f) => f.name !== labels.field).map((f) => (
                                <option key={f.name} value={f.name}>{f.outputName || f.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="style-row">
                        <label>Decimals</label>
                        <select
                            className="style-select"
                            aria-label="Decimals"
                            value={labels.decimals == null ? '' : String(labels.decimals)}
                            onChange={(e) => {
                                const value = e.target.value;
                                setLabels({ decimals: value === '' ? null : Number(value) });
                            }}
                        >
                            <option value="">As stored</option>
                            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                                <option key={n} value={String(n)}>{n}</option>
                            ))}
                        </select>
                    </div>

                    <div className="style-row">
                        <label>Prefix</label>
                        <input
                            type="text"
                            className="labels-text-input"
                            aria-label="Prefix"
                            value={labels.prefix || ''}
                            disabled={templateOn}
                            onChange={(e) => setLabels({ prefix: e.target.value })}
                        />
                    </div>

                    <div className="style-row">
                        <label>Suffix</label>
                        <input
                            type="text"
                            className="labels-text-input"
                            aria-label="Suffix"
                            value={labels.suffix || ''}
                            disabled={templateOn}
                            onChange={(e) => setLabels({ suffix: e.target.value })}
                        />
                    </div>

                    <div className="style-row">
                        <label>Template</label>
                        <input
                            type="text"
                            className="labels-text-input"
                            aria-label="Template"
                            placeholder="{value}"
                            value={labels.template || ''}
                            onChange={(e) => setLabels({ template: e.target.value })}
                        />
                    </div>
                    <p className="text-muted text-xs mb-8">
                        A template replaces the prefix and suffix. Use {'{value}'} for the label field and {'{value2}'} for the second field.
                    </p>

                    {preview ? (
                        <p className="text-muted text-xs mb-8">Preview: {preview}</p>
                    ) : null}

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
                            aria-label="Label color"
                            value={labels.color || '#111111'}
                            onChange={(e) => setLabels({ color: e.target.value })}
                        />
                    </div>

                    <div className="style-row">
                        <label>Halo</label>
                        <input
                            type="color"
                            className="style-color-input"
                            aria-label="Halo color"
                            value={labels.haloColor || '#ffffff'}
                            onChange={(e) => setLabels({ haloColor: e.target.value })}
                        />
                        <input
                            type="number"
                            className="smart-style-num-input"
                            aria-label="Halo width"
                            min="0"
                            max="4"
                            step="0.5"
                            title="Halo width"
                            value={labels.haloWidth ?? 1.5}
                            onChange={(e) => {
                                const width = parseFloat(e.target.value);
                                setLabels({ haloWidth: Number.isFinite(width) ? width : 0 });
                            }}
                        />
                    </div>

                    {hasLines && (hasPoints || hasPolygons) ? (
                        <div className="style-row">
                            <label>Placement</label>
                            <div className="labels-placement-options">
                                {(hasPoints || hasPolygons) ? (
                                    <label className="labels-placement-option">
                                        <input
                                            type="radio"
                                            name={`labels-placement-${layer?.id}`}
                                            checked={labels.placement !== 'line'}
                                            onChange={() => setLabels({ placement: 'point' })}
                                        />
                                        <span>{hasPolygons && !hasPoints ? 'At center' : 'At point'}</span>
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
