import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    DEFAULT_FLAT_STYLE,
    autoClassifyRange,
    normalizeStyle,
    createVisualVariable,
    SYMBOLOGY_TYPES
} from '../../js/map/style-engine.js';
import { RAMP_OPTIONS } from '../../js/map/color-ramps.js';
import { FILTER_OPERATORS } from '../../js/dataprep/transforms.js';
import { loadPaletteFavorites, addPaletteFavorite, removePaletteFavorite } from '../../js/map/palette-store.js';
import { detectEmbeddedSimpleStyle } from '../../js/map/style-import.js';
import {
    pickSmartField,
    suggestStyleChannel,
    mergeDefaultStyleForDisplay,
    applyPaletteToVariables,
    symbologyTypeFromStyle,
    primaryVariable,
    extraVariables,
    variableTypeForSymbology,
    styleForSymbologyType,
    styleForSymbologyField,
    mapPrimaryVariable,
    reclassifyVariable,
    styleForHighlightRules,
    styleForBaseSymbol
} from '../../js/map/style-panel-helpers.js';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';

const SYMBOL_OPTIONS = ['circle', 'square', 'triangle', 'diamond', 'star', 'pin'];
const SYMBOL_LABELS = { circle: '●', square: '■', triangle: '▲', diamond: '◆', star: '★', pin: '📍' };

const EXTRA_LABELS = {
    unique: 'Categories',
    range: 'Color classes',
    ramp: 'Colors',
    size: 'Size',
    width: 'Width',
    opacity: 'Opacity'
};

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

function SimpleStyleSection({ style, geomTypes, onChange }) {
    const isMixed = geomTypes.size > 1;
    const hasPoints = geomTypes.has('point');
    const hasFills = geomTypes.has('polygon') || geomTypes.has('point');
    const hasLines = geomTypes.has('line') || geomTypes.has('polygon');

    const onChangeSection = (prefix, patch) => {
        if (isMixed) {
            const key = prefix === 'sty-pt' ? 'point' : prefix === 'sty-ln' ? 'line' : 'polygon';
            onChange({ ...style, mode: 'simple', [key]: { ...(style[key] || {}), ...patch } });
        } else {
            onChange({ ...style, mode: 'simple', ...patch });
        }
    };

    const renderSection = (prefix, s, opts) => {
        const { showStroke = true, showFill = true, showWidth = true, showStrokeOp = true, showFillOp = true, showPoint = false } = opts;
        return (
            <div className="smart-style-section">
                {showStroke ? (
                    <div className="style-row">
                        <label>Stroke</label>
                        <input type="color" className="style-color-input" value={s.strokeColor}
                            onChange={(e) => onChangeSection(prefix, { strokeColor: e.target.value })} />
                    </div>
                ) : null}
                {showFill ? (
                    <div className="style-row">
                        <label>Fill</label>
                        <input type="color" className="style-color-input" value={s.fillColor || s.strokeColor}
                            onChange={(e) => onChangeSection(prefix, { fillColor: e.target.value })} />
                    </div>
                ) : null}
                {showWidth ? (
                    <div className="style-row">
                        <label>Width</label>
                        <input type="range" className="style-range" min="0.5" max="8" step="0.5" value={s.strokeWidth ?? 2}
                            onChange={(e) => onChangeSection(prefix, { strokeWidth: parseFloat(e.target.value) })} />
                        <span className="style-value">{s.strokeWidth ?? 2}</span>
                    </div>
                ) : null}
                {showStrokeOp ? (
                    <div className="style-row">
                        <label>Stroke opacity</label>
                        <input type="range" className="style-range" min="0" max="1" step="0.05" value={s.strokeOpacity ?? 0.8}
                            onChange={(e) => onChangeSection(prefix, { strokeOpacity: parseFloat(e.target.value) })} />
                        <span className="style-value">{Math.round((s.strokeOpacity ?? 0.8) * 100)}%</span>
                    </div>
                ) : null}
                {showFillOp ? (
                    <div className="style-row">
                        <label>Fill opacity</label>
                        <input type="range" className="style-range" min="0" max="1" step="0.05" value={s.fillOpacity ?? 0.3}
                            onChange={(e) => onChangeSection(prefix, { fillOpacity: parseFloat(e.target.value) })} />
                        <span className="style-value">{Math.round((s.fillOpacity ?? 0.3) * 100)}%</span>
                    </div>
                ) : null}
                {showPoint ? (
                    <>
                        <div className="style-row">
                            <label>Size</label>
                            <input type="range" className="style-range" min="3" max="20" step="1" value={s.pointSize ?? 6}
                                onChange={(e) => onChangeSection(prefix, { pointSize: parseInt(e.target.value, 10) })} />
                            <span className="style-value">{s.pointSize ?? 6}</span>
                        </div>
                        <div className="style-row style-row-symbols">
                            <label>Symbol</label>
                            <div className="style-symbols">
                                {SYMBOL_OPTIONS.map((sym) => (
                                    <button key={sym} type="button"
                                        className={`style-symbol-btn ${(s.pointSymbol || 'circle') === sym ? 'active' : ''}`}
                                        onClick={() => onChangeSection(prefix, { pointSymbol: sym })}>{SYMBOL_LABELS[sym]}</button>
                                ))}
                            </div>
                        </div>
                    </>
                ) : null}
            </div>
        );
    };

    const flat = { ...DEFAULT_FLAT_STYLE, ...style };
    if (isMixed) {
        return (
            <>
                {hasPoints ? <div className="style-type-section"><h4 className="style-type-header">Points</h4>
                    {renderSection('sty-pt', { ...flat, ...(style.point || {}) }, { showFill: true, showWidth: true, showStrokeOp: true, showFillOp: true, showPoint: true })}</div> : null}
                {hasLines ? <div className="style-type-section"><h4 className="style-type-header">Lines</h4>
                    {renderSection('sty-ln', { ...flat, ...(style.line || {}) }, { showFill: false, showWidth: true, showStrokeOp: true, showFillOp: false, showPoint: false })}</div> : null}
                {geomTypes.has('polygon') ? <div className="style-type-section"><h4 className="style-type-header">Polygons</h4>
                    {renderSection('sty-pg', { ...flat, ...(style.polygon || {}) }, { showFill: true, showWidth: true, showStrokeOp: true, showFillOp: true, showPoint: false })}</div> : null}
            </>
        );
    }
    return renderSection('sty', flat, {
        showStroke: true, showFill: hasFills, showWidth: hasLines || hasFills,
        showStrokeOp: true, showFillOp: hasFills, showPoint: hasPoints
    });
}

function ClassList({ classes, onLabel, onColor, onStylePatch }) {
    return (
        <div className="smart-style-legend">
            {(classes || []).map((cls, i) => (
                <div className="smart-style-legend-row" key={`${cls.value}-${i}`}>
                    <input type="color" className="style-color-input" value={cls.color || '#2563eb'}
                        aria-label={`Color for ${cls.value}`}
                        onChange={(e) => onColor(i, e.target.value)} />
                    <input
                        type="text"
                        className="smart-style-legend-label-input"
                        aria-label={`Label for ${cls.value}`}
                        value={cls.label ?? ''}
                        onChange={(e) => onLabel(i, e.target.value)}
                    />
                    <details className="smart-style-class-details">
                        <summary>More</summary>
                        <div className="style-row">
                            <label>Width</label>
                            <input type="number" className="smart-style-num-input" step="0.5" min="0.5" max="12"
                                value={cls.style?.strokeWidth ?? ''} placeholder="inherit"
                                onChange={(e) => onStylePatch(i, { strokeWidth: e.target.value ? parseFloat(e.target.value) : undefined })} />
                        </div>
                        <div className="style-row">
                            <label>Size</label>
                            <input type="number" className="smart-style-num-input" min="2" max="30"
                                value={cls.style?.pointSize ?? ''} placeholder="inherit"
                                onChange={(e) => onStylePatch(i, { pointSize: e.target.value ? parseInt(e.target.value, 10) : undefined })} />
                        </div>
                    </details>
                </div>
            ))}
        </div>
    );
}

function PreviewSwatches({ variable }) {
    if (!variable) return null;
    if (variable.type === 'size' || variable.type === 'width') {
        const noun = variable.type === 'width' ? 'Width' : 'Size';
        const from = variable.type === 'width' ? variable.widthMin : variable.sizeMin;
        const to = variable.type === 'width' ? variable.widthMax : variable.sizeMax;
        return (
            <p className="text-muted text-xs">
                {noun} {from} to {to}, across values {variable.min}–{variable.max}.
            </p>
        );
    }
    if (variable.type === 'ramp') {
        return <p className="text-muted text-xs">Colors follow the field from low to high.</p>;
    }
    const classes = variable.classes || [];
    if (!classes.length) return <p className="text-muted text-xs">No values in this field yet.</p>;
    return (
        <div className="smart-style-legend">
            {classes.map((cls, i) => (
                <div className="smart-style-legend-row" key={`${cls.value}-${i}`}>
                    <span className="symbology-swatch" style={{ background: cls.color || '#2563eb' }} />
                    <span className="smart-style-legend-label">{cls.label || cls.value}</span>
                </div>
            ))}
        </div>
    );
}

function FilterRulesEditor({ rules, fields, onChange }) {
    const updateRule = (index, patch) => {
        const next = rules.map((r, i) => (i === index ? { ...r, ...patch } : r));
        onChange(next);
    };

    const addRule = () => {
        onChange([...rules, {
            id: `fr-${Date.now()}`,
            filter: { logic: 'AND', rules: [{ field: fields[0]?.name || '', operator: 'equals', value: '' }] },
            style: { strokeWidth: 3 }
        }]);
    };

    return (
        <div className="smart-style-filter-section symbology-highlight">
            <h4 className="style-type-header">Highlight</h4>
            <p className="text-muted text-xs mb-8">Changes how matching features look. This does not hide features.</p>
            {rules.map((rule, ri) => (
                <div className="smart-style-vv-card" key={rule.id || ri}>
                    {(rule.filter?.rules || []).map((r, ridx) => (
                        <div className="style-row" key={ridx}>
                            <select aria-label="Highlight field" value={r.field} onChange={(e) => {
                                const fr = { ...rule.filter, rules: rule.filter.rules.map((x, j) => j === ridx ? { ...x, field: e.target.value } : x) };
                                updateRule(ri, { filter: fr });
                            }}>
                                {fields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                            </select>
                            <select aria-label="Highlight comparison" value={r.operator} onChange={(e) => {
                                const fr = { ...rule.filter, rules: rule.filter.rules.map((x, j) => j === ridx ? { ...x, operator: e.target.value } : x) };
                                updateRule(ri, { filter: fr });
                            }}>
                                {FILTER_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <input type="text" className="smart-style-num-input" value={r.value ?? ''} placeholder="value"
                                aria-label="Highlight value"
                                onChange={(e) => {
                                    const fr = { ...rule.filter, rules: rule.filter.rules.map((x, j) => j === ridx ? { ...x, value: e.target.value } : x) };
                                    updateRule(ri, { filter: fr });
                                }} />
                        </div>
                    ))}
                    <div className="style-row">
                        <label>Color</label>
                        <input type="color" className="style-color-input" value={rule.style?.fillColor || '#fbbf24'}
                            aria-label="Highlight color"
                            onChange={(e) => updateRule(ri, { style: { ...rule.style, fillColor: e.target.value } })} />
                        <input type="number" className="smart-style-num-input" step="0.5" min="0.5" max="12"
                            value={rule.style?.strokeWidth ?? 3} title="Stroke width" aria-label="Highlight width"
                            onChange={(e) => updateRule(ri, { style: { ...rule.style, strokeWidth: parseFloat(e.target.value) } })} />
                        <button type="button" className="btn-icon" aria-label="Remove highlight" onClick={() => onChange(rules.filter((_, i) => i !== ri))}>✕</button>
                    </div>
                </div>
            ))}
            <button type="button" className="btn btn-sm btn-secondary w-full" onClick={addRule}>+ Add highlight</button>
        </div>
    );
}

export function SmartStylePanel({ layer, style: externalStyle, defaultColor = '#2563eb', onStyleChange }) {
    const geomTypes = useMemo(() => detectGeomTypes(layer), [layer]);
    const style = useMemo(
        () => normalizeStyle(externalStyle, defaultColor),
        [externalStyle, defaultColor]
    );
    const fields = layer?.schema?.fields || [];
    const features = layer?.geojson?.features || [];
    const channel = suggestStyleChannel(geomTypes);
    const derivedType = symbologyTypeFromStyle(style);
    const [pendingType, setPendingType] = useState(null);
    const activeType = pendingType || derivedType;
    const primary = primaryVariable(style);
    const extras = style.mode === 'smart' ? extraVariables(style) : [];
    const suggested = useMemo(() => pickSmartField(fields), [fields]);
    const needsField = activeType !== 'single';
    const fieldReady = needsField && !!primary?.field;
    const showPreview = needsField && !primary?.field && !!suggested;

    const ctx = useMemo(() => ({
        geomTypes, fields, features, channel
    }), [geomTypes, fields, features, channel]);

    useEffect(() => {
        setPendingType(null);
    }, [layer?.id]);

    useEffect(() => {
        if (pendingType && pendingType === derivedType) setPendingType(null);
    }, [pendingType, derivedType]);

    const pushStyle = useCallback((next) => {
        onStyleChange?.(next);
    }, [onStyleChange]);

    const preview = useMemo(() => {
        if (!showPreview || !suggested) return null;
        const engineType = variableTypeForSymbology(activeType, geomTypes, null);
        if (!engineType) return null;
        return createVisualVariable(engineType, suggested.name, features, suggested, { channel });
    }, [showPreview, suggested, activeType, geomTypes, features, channel]);

    const fieldOptions = fields.filter((f) => f.selected !== false || f.name === primary?.field);
    const fieldDef = fields.find((f) => f.name === primary?.field) || null;
    const isColorType = primary && (primary.type === 'unique' || primary.type === 'range' || primary.type === 'ramp');
    const hasClasses = primary && (primary.type === 'unique' || primary.type === 'range');
    const embedded = activeType === 'single' ? detectEmbeddedSimpleStyle(features) : null;
    const smart = style.smart || { defaultStyle: {}, visualVariables: [], filterRules: [] };
    const hasColorVariable = style.mode === 'smart'
        && (smart.visualVariables || []).some((v) => v.type === 'unique' || v.type === 'range');
    const [palettes, setPalettes] = useState(() => loadPaletteFavorites());

    const handleType = (nextType) => {
        const next = styleForSymbologyType(style, nextType, ctx);
        if (next == null) {
            setPendingType(nextType);
            return;
        }
        setPendingType(null);
        if (next !== style) pushStyle(next);
    };

    const applyField = (fieldName) => {
        if (!fieldName) return;
        const next = styleForSymbologyField(style, fieldName, activeType, ctx);
        setPendingType(null);
        if (next !== style) pushStyle(next);
    };

    const patchPrimary = (updater) => {
        pushStyle(mapPrimaryVariable(style, updater));
    };

    const updateClass = (index, patch) => {
        patchPrimary((vv) => ({
            ...vv,
            classes: (vv.classes || []).map((c, i) => (i === index ? { ...c, ...patch } : c))
        }));
    };

    const handleConvertEmbedded = () => {
        import('../../js/map/style-import.js').then(({ convertLayerSimpleStyleToSmart }) => {
            const converted = convertLayerSimpleStyleToSmart(layer, defaultColor, style);
            if (converted) {
                setPendingType(null);
                pushStyle(converted);
            }
        });
    };

    const symbolStyle = style.mode === 'smart'
        ? mergeDefaultStyleForDisplay(style, smart.defaultStyle)
        : style;

    return (
        <CollapsibleSection title="Symbology" defaultOpen={true} className="style-panel smart-style-panel">
            {embedded?.hasSimpleStyle ? (
                <div className="warning-box text-xs mb-8">
                    This layer already has colors on each feature ({embedded.distinctCount} values in {embedded.varyingProperty}).
                    <button type="button" className="btn btn-sm btn-primary mt-8 w-full" onClick={handleConvertEmbedded}>
                        Use these colors
                    </button>
                </div>
            ) : null}

            <div className="style-row">
                <label htmlFor="symbology-type">Symbology</label>
                <select
                    id="symbology-type"
                    aria-label="Symbology"
                    value={activeType}
                    onChange={(e) => handleType(e.target.value)}
                >
                    {SYMBOLOGY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
            </div>

            {needsField ? (
                <div className="style-row">
                    <label htmlFor="symbology-field">Field</label>
                    <select
                        id="symbology-field"
                        aria-label="Field"
                        value={primary?.field || ''}
                        onChange={(e) => applyField(e.target.value)}
                    >
                        {!fieldReady ? <option value="">Select a field</option> : null}
                        {fieldOptions.map((f) => (
                            <option key={f.name} value={f.name}>{f.name}</option>
                        ))}
                    </select>
                </div>
            ) : null}

            {showPreview ? (
                <div className="symbology-preview" data-symbology-preview="true">
                    <p className="text-xs mb-8">
                        Preview for {suggested.name}. These colors stay off the map until you choose a field.
                    </p>
                    <PreviewSwatches variable={preview} />
                    <button
                        type="button"
                        className="btn btn-sm btn-secondary w-full mt-8"
                        onClick={() => applyField(suggested.name)}
                    >
                        Use {suggested.name}
                    </button>
                </div>
            ) : null}

            {fieldReady && hasClasses ? (
                <>
                    {primary.type === 'range' ? (
                        <div className="style-row">
                            <label htmlFor="symbology-method">Method</label>
                            <select id="symbology-method" aria-label="Method" value={primary.method || 'equal'} onChange={(e) => {
                                const method = e.target.value;
                                const result = autoClassifyRange(primary.field, features, primary.classCount || 5, primary.ramp || 'ylOrRd', fieldDef, method);
                                patchPrimary((vv) => ({ ...vv, method, ...result }));
                            }}>
                                <option value="equal">Equal interval</option>
                                <option value="quantile">Quantile</option>
                            </select>
                            <input type="number" className="smart-style-num-input" min="2" max="12" aria-label="Classes"
                                value={primary.classCount || 5}
                                onChange={(e) => {
                                    const classCount = parseInt(e.target.value, 10);
                                    const result = autoClassifyRange(primary.field, features, classCount, primary.ramp || 'ylOrRd', fieldDef, primary.method || 'equal');
                                    patchPrimary((vv) => ({ ...vv, classCount, ...result }));
                                }} />
                        </div>
                    ) : null}
                    <button type="button" className="btn btn-sm btn-secondary w-full mb-8" onClick={() => {
                        patchPrimary((vv) => reclassifyVariable(vv, features, fieldDef));
                    }}>
                        Reclassify
                    </button>
                    <ClassList
                        classes={primary.classes}
                        onColor={(i, color) => updateClass(i, { color })}
                        onLabel={(i, label) => updateClass(i, { label })}
                        onStylePatch={(i, stylePatch) => updateClass(i, { style: { ...(primary.classes?.[i]?.style || {}), ...stylePatch } })}
                    />
                    {primary.type === 'unique' ? (
                        <div className="style-row mt-8">
                            <label htmlFor="symbology-other">Other</label>
                            <input id="symbology-other" type="color" className="style-color-input" value={primary.defaultColor || '#94a3b8'}
                                onChange={(e) => patchPrimary((vv) => ({ ...vv, defaultColor: e.target.value }))} />
                        </div>
                    ) : null}
                </>
            ) : null}

            {fieldReady && primary?.type === 'ramp' ? (
                <p className="text-muted text-xs mb-8">Colors follow {primary.field} from low to high.</p>
            ) : null}

            {fieldReady && (primary?.type === 'ramp' || primary?.type === 'range') ? (
                <div className="style-row">
                    <label htmlFor="symbology-palette">Palette</label>
                    <select id="symbology-palette" aria-label="Palette" value={primary.ramp || 'ylOrRd'} onChange={(e) => {
                        const ramp = e.target.value;
                        if (primary.type === 'range') {
                            const result = autoClassifyRange(primary.field, features, primary.classCount || 5, ramp, fieldDef, primary.method || 'equal');
                            patchPrimary((vv) => ({ ...vv, ramp, ...result }));
                        } else {
                            patchPrimary((vv) => ({ ...vv, ramp }));
                        }
                    }}>
                        {RAMP_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                </div>
            ) : null}

            {fieldReady && (primary?.type === 'ramp' || primary?.type === 'size' || primary?.type === 'width') ? (
                <div className="style-row">
                    <label>Min</label>
                    <input type="number" className="smart-style-num-input" aria-label="Minimum value" value={primary.min ?? 0}
                        onChange={(e) => patchPrimary((vv) => ({ ...vv, min: parseFloat(e.target.value) }))} />
                    <label>Max</label>
                    <input type="number" className="smart-style-num-input" aria-label="Maximum value" value={primary.max ?? 100}
                        onChange={(e) => patchPrimary((vv) => ({ ...vv, max: parseFloat(e.target.value) }))} />
                </div>
            ) : null}

            {fieldReady && primary?.type === 'size' ? (
                <div className="style-row">
                    <label>Size</label>
                    <input type="number" className="smart-style-num-input" aria-label="Smallest size" value={primary.sizeMin ?? 4} min="2" max="30"
                        onChange={(e) => patchPrimary((vv) => ({ ...vv, sizeMin: parseFloat(e.target.value) }))} />
                    <span>–</span>
                    <input type="number" className="smart-style-num-input" aria-label="Largest size" value={primary.sizeMax ?? 16} min="2" max="30"
                        onChange={(e) => patchPrimary((vv) => ({ ...vv, sizeMax: parseFloat(e.target.value) }))} />
                </div>
            ) : null}

            {fieldReady && primary?.type === 'width' ? (
                <div className="style-row">
                    <label>Width</label>
                    <input type="number" className="smart-style-num-input" aria-label="Smallest width" value={primary.widthMin ?? 1} min="0.5" max="20" step="0.5"
                        onChange={(e) => patchPrimary((vv) => ({ ...vv, widthMin: parseFloat(e.target.value) }))} />
                    <span>–</span>
                    <input type="number" className="smart-style-num-input" aria-label="Largest width" value={primary.widthMax ?? 6} min="0.5" max="20" step="0.5"
                        onChange={(e) => patchPrimary((vv) => ({ ...vv, widthMax: parseFloat(e.target.value) }))} />
                </div>
            ) : null}

            {fieldReady && isColorType ? (
                <div className="style-row">
                    <label htmlFor="symbology-color">Color</label>
                    <select id="symbology-color" aria-label="Color" value={primary.channel || 'fill'}
                        onChange={(e) => patchPrimary((vv) => ({ ...vv, channel: e.target.value }))}>
                        <option value="fill">Fill</option>
                        <option value="stroke">Outline</option>
                        <option value="both">Fill and outline</option>
                    </select>
                </div>
            ) : null}

            {extras.length ? (
                <div className="text-muted text-xs mb-8">
                    {extras.map((v) => (
                        <div key={v.id || `${v.type}-${v.field}`}>
                            {EXTRA_LABELS[v.type] || 'Another drawing'} also follows {v.field}.
                        </div>
                    ))}
                </div>
            ) : null}

            <div className="style-type-section symbology-symbol">
                <h4 className="style-type-header">Symbol</h4>
                <SimpleStyleSection
                    style={symbolStyle}
                    geomTypes={geomTypes}
                    onChange={(next) => pushStyle(styleForBaseSymbol(style, next))}
                />
            </div>

            <FilterRulesEditor
                rules={smart.filterRules || []}
                fields={fields}
                onChange={(filterRules) => {
                    const next = styleForHighlightRules(style, filterRules);
                    if (next !== style) pushStyle(next);
                }}
            />

            <details className="smart-style-advanced">
                <summary className="smart-style-advanced-title">More options</summary>
                <div className="smart-style-advanced-body">
                    <div className="style-type-section">
                        <h4 className="style-type-header">Saved palettes</h4>
                        {palettes.length === 0 ? <div className="text-muted text-xs mb-8">No saved palettes yet.</div> : null}
                        {palettes.map((p) => (
                            <div className="smart-style-legend-row" key={p.id}>
                                <span className="smart-style-legend-label">{p.name}</span>
                                <div style={{ display: 'flex', gap: 2 }}>
                                    {p.colors.slice(0, 8).map((c, i) => (
                                        <span key={i} className="symbology-swatch" style={{ background: c }} />
                                    ))}
                                </div>
                                <div className="smart-style-palette-actions">
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-secondary"
                                        disabled={!hasColorVariable}
                                        title={hasColorVariable ? 'Apply to classes' : 'Choose unique values or graduated colors first'}
                                        onClick={() => {
                                            const nextVars = applyPaletteToVariables(smart.visualVariables || [], p.colors);
                                            if (nextVars) pushStyle({ ...style, mode: 'smart', smart: { ...smart, visualVariables: nextVars } });
                                        }}
                                    >
                                        Apply
                                    </button>
                                    <button type="button" className="btn-icon" aria-label={`Remove palette ${p.name}`} onClick={() => setPalettes(removePaletteFavorite(p.id))}>✕</button>
                                </div>
                            </div>
                        ))}
                        <button type="button" className="btn btn-sm btn-secondary w-full mt-8" onClick={() => {
                            const colors = (primary?.classes || []).map((c) => c.color).filter(Boolean);
                            if (colors.length) setPalettes(addPaletteFavorite(`Palette ${palettes.length + 1}`, colors));
                        }}>Save class colors</button>
                    </div>
                </div>
            </details>
        </CollapsibleSection>
    );
}
