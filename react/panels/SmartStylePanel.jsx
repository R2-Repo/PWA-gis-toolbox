import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    DEFAULT_FLAT_STYLE,
    autoClassifyUnique,
    autoClassifyRange,
    normalizeStyle,
    createVisualVariable,
    VISUAL_VARIABLE_TYPES
} from '../../js/map/style-engine.js';
import { RAMP_OPTIONS } from '../../js/map/color-ramps.js';
import { FILTER_OPERATORS } from '../../js/dataprep/transforms.js';
import { loadPaletteFavorites, addPaletteFavorite, removePaletteFavorite } from '../../js/map/palette-store.js';
import { detectEmbeddedSimpleStyle } from '../../js/map/style-import.js';
import {
    pickSmartField,
    suggestVariableType,
    extractDefaultStyle,
    mergeDefaultStyleForDisplay,
    applyPaletteToVariables
} from '../../js/map/style-panel-helpers.js';
import { CollapsibleSection } from '../ui/CollapsibleSection.jsx';

const SYMBOL_OPTIONS = ['circle', 'square', 'triangle', 'diamond', 'star', 'pin'];
const SYMBOL_LABELS = { circle: '●', square: '■', triangle: '▲', diamond: '◆', star: '★', pin: '📍' };

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

function VisualVariableEditor({ vv, index, fields, features, onChange, onRemove }) {
    const fieldDef = fields.find((f) => f.name === vv.field);
    const isColorType = vv.type === 'unique' || vv.type === 'range' || vv.type === 'ramp';
    const hasClassLegend = vv.type === 'unique' || vv.type === 'range';
    const cardTitle = vv.field
        ? `Color by: ${vv.field}`
        : `Styling rule ${index + 1}`;

    const update = (patch) => onChange({ ...vv, ...patch });

    const refreshClasses = () => {
        if (vv.type === 'unique') {
            update({ classes: autoClassifyUnique(vv.field, features) });
        } else if (vv.type === 'range') {
            const result = autoClassifyRange(vv.field, features, vv.classCount || 5, vv.ramp || 'ylOrRd', fieldDef, vv.method || 'equal');
            update(result);
        }
    };

    const updateClass = (i, patch) => {
        const classes = (vv.classes || []).map((c, idx) => (idx === i ? { ...c, ...patch } : c));
        update({ classes });
    };

    const handleFieldChange = (fieldName) => {
        const fd = fields.find((f) => f.name === fieldName);
        onChange(createVisualVariable(vv.type, fieldName, features, fd));
    };

    return (
        <div className="smart-style-vv-card">
            <div className="smart-style-vv-header">
                <span className="smart-style-vv-title">{cardTitle}</span>
                <button type="button" className="btn-icon" title="Remove" onClick={onRemove}>✕</button>
            </div>

            <div className="style-row">
                <label>Field</label>
                <select value={vv.field || ''} onChange={(e) => handleFieldChange(e.target.value)}>
                    <option value="">Select…</option>
                    {fields.filter((f) => f.selected !== false).map((f) => (
                        <option key={f.name} value={f.name}>{f.name} ({f.type})</option>
                    ))}
                </select>
            </div>

            {hasClassLegend ? (
                <>
                    <button type="button" className="btn btn-sm btn-secondary w-full mb-8" onClick={refreshClasses}>
                        Update from data
                    </button>
                    <div className="smart-style-legend">
                        {(vv.classes || []).map((cls, i) => (
                            <div className="smart-style-legend-row" key={`${cls.value}-${i}`}>
                                <input type="color" className="style-color-input" value={cls.color || '#2563eb'}
                                    onChange={(e) => updateClass(i, { color: e.target.value })} />
                                <span className="smart-style-legend-label">{cls.label || cls.value}</span>
                                <details className="smart-style-class-details">
                                    <summary>Style overrides</summary>
                                    <div className="style-row">
                                        <label>Width</label>
                                        <input type="number" className="smart-style-num-input" step="0.5" min="0.5" max="12"
                                            value={cls.style?.strokeWidth ?? ''} placeholder="inherit"
                                            onChange={(e) => updateClass(i, { style: { ...(cls.style || {}), strokeWidth: e.target.value ? parseFloat(e.target.value) : undefined } })} />
                                    </div>
                                    <div className="style-row">
                                        <label>Size</label>
                                        <input type="number" className="smart-style-num-input" min="2" max="30"
                                            value={cls.style?.pointSize ?? ''} placeholder="inherit"
                                            onChange={(e) => updateClass(i, { style: { ...(cls.style || {}), pointSize: e.target.value ? parseInt(e.target.value, 10) : undefined } })} />
                                    </div>
                                </details>
                            </div>
                        ))}
                    </div>
                    {vv.type === 'unique' ? (
                        <div className="style-row mt-8">
                            <label>Other</label>
                            <input type="color" className="style-color-input" value={vv.defaultColor || '#94a3b8'}
                                onChange={(e) => update({ defaultColor: e.target.value })} />
                        </div>
                    ) : null}
                </>
            ) : null}

            <details className="smart-style-vv-advanced">
                <summary className="smart-style-vv-advanced-title">More options</summary>

                <div className="style-row">
                    <label>Type</label>
                    <select value={vv.type} onChange={(e) => {
                        const fd = fields.find((f) => f.name === vv.field);
                        onChange(createVisualVariable(e.target.value, vv.field || fields[0]?.name, features, fd));
                    }}>
                        {VISUAL_VARIABLE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                </div>

                {isColorType ? (
                    <div className="style-row">
                        <label>Color by</label>
                        <select value={vv.channel || 'fill'} onChange={(e) => update({ channel: e.target.value })}>
                            <option value="fill">Fill</option>
                            <option value="stroke">Stroke</option>
                            <option value="both">Both</option>
                        </select>
                    </div>
                ) : null}

                {vv.type === 'range' ? (
                    <div className="style-row">
                        <label>Method</label>
                        <select value={vv.method || 'equal'} onChange={(e) => {
                            const result = autoClassifyRange(vv.field, features, vv.classCount || 5, vv.ramp || 'ylOrRd', fieldDef, e.target.value);
                            update({ method: e.target.value, ...result });
                        }}>
                            <option value="equal">Equal interval</option>
                            <option value="quantile">Quantile</option>
                        </select>
                        <input type="number" className="smart-style-num-input" min="2" max="12" value={vv.classCount || 5}
                            onChange={(e) => {
                                const result = autoClassifyRange(vv.field, features, parseInt(e.target.value, 10), vv.ramp || 'ylOrRd', fieldDef, vv.method || 'equal');
                                update({ classCount: parseInt(e.target.value, 10), ...result });
                            }} title="Classes" />
                    </div>
                ) : null}

                {(vv.type === 'ramp' || vv.type === 'range') ? (
                    <div className="style-row">
                        <label>Palette</label>
                        <select value={vv.ramp || 'ylOrRd'} onChange={(e) => {
                            if (vv.type === 'range') {
                                const result = autoClassifyRange(vv.field, features, vv.classCount || 5, e.target.value, fieldDef, vv.method || 'equal');
                                update({ ramp: e.target.value, ...result });
                            } else {
                                update({ ramp: e.target.value });
                            }
                        }}>
                            {RAMP_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                        </select>
                    </div>
                ) : null}

                {(vv.type === 'ramp' || vv.type === 'size' || vv.type === 'width' || vv.type === 'opacity') ? (
                    <div className="style-row">
                        <label>Min</label>
                        <input type="number" className="smart-style-num-input" value={vv.min ?? 0}
                            onChange={(e) => update({ min: parseFloat(e.target.value) })} />
                        <label>Max</label>
                        <input type="number" className="smart-style-num-input" value={vv.max ?? 100}
                            onChange={(e) => update({ max: parseFloat(e.target.value) })} />
                    </div>
                ) : null}

                {vv.type === 'size' ? (
                    <div className="style-row">
                        <label>Size</label>
                        <input type="number" className="smart-style-num-input" value={vv.sizeMin ?? 4} min="2" max="30"
                            onChange={(e) => update({ sizeMin: parseFloat(e.target.value) })} />
                        <span>–</span>
                        <input type="number" className="smart-style-num-input" value={vv.sizeMax ?? 16} min="2" max="30"
                            onChange={(e) => update({ sizeMax: parseFloat(e.target.value) })} />
                    </div>
                ) : null}

                {vv.type === 'width' ? (
                    <div className="style-row">
                        <label>Width</label>
                        <input type="number" className="smart-style-num-input" value={vv.widthMin ?? 1} min="0.5" max="20" step="0.5"
                            onChange={(e) => update({ widthMin: parseFloat(e.target.value) })} />
                        <span>–</span>
                        <input type="number" className="smart-style-num-input" value={vv.widthMax ?? 6} min="0.5" max="20" step="0.5"
                            onChange={(e) => update({ widthMax: parseFloat(e.target.value) })} />
                    </div>
                ) : null}
            </details>
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
        <div className="smart-style-filter-section">
            <h4 className="style-type-header">Highlight matching features</h4>
            <p className="text-muted text-xs mb-8">Style matching features without hiding them.</p>
            {rules.map((rule, ri) => (
                <div className="smart-style-vv-card" key={rule.id || ri}>
                    {(rule.filter?.rules || []).map((r, ridx) => (
                        <div className="style-row" key={ridx}>
                            <select value={r.field} onChange={(e) => {
                                const fr = { ...rule.filter, rules: rule.filter.rules.map((x, j) => j === ridx ? { ...x, field: e.target.value } : x) };
                                updateRule(ri, { filter: fr });
                            }}>
                                {fields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                            </select>
                            <select value={r.operator} onChange={(e) => {
                                const fr = { ...rule.filter, rules: rule.filter.rules.map((x, j) => j === ridx ? { ...x, operator: e.target.value } : x) };
                                updateRule(ri, { filter: fr });
                            }}>
                                {FILTER_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <input type="text" className="smart-style-num-input" value={r.value ?? ''} placeholder="value"
                                onChange={(e) => {
                                    const fr = { ...rule.filter, rules: rule.filter.rules.map((x, j) => j === ridx ? { ...x, value: e.target.value } : x) };
                                    updateRule(ri, { filter: fr });
                                }} />
                        </div>
                    ))}
                    <div className="style-row">
                        <label>Override</label>
                        <input type="color" className="style-color-input" value={rule.style?.fillColor || '#fbbf24'}
                            onChange={(e) => updateRule(ri, { style: { ...rule.style, fillColor: e.target.value } })} />
                        <input type="number" className="smart-style-num-input" step="0.5" min="0.5" max="12"
                            value={rule.style?.strokeWidth ?? 3} title="Stroke width"
                            onChange={(e) => updateRule(ri, { style: { ...rule.style, strokeWidth: parseFloat(e.target.value) } })} />
                        <button type="button" className="btn-icon" onClick={() => onChange(rules.filter((_, i) => i !== ri))}>✕</button>
                    </div>
                </div>
            ))}
            <button type="button" className="btn btn-sm btn-secondary w-full" onClick={addRule}>+ Add highlight rule</button>
        </div>
    );
}

function SmartStyleSection({ layer, style, onChange, onConvertEmbedded }) {
    const fields = layer?.schema?.fields || [];
    const features = layer?.geojson?.features || [];
    const smart = style.smart || { defaultStyle: {}, visualVariables: [], filterRules: [] };
    const embedded = detectEmbeddedSimpleStyle(features);
    const variables = smart.visualVariables || [];
    const hasColorVariable = variables.some((v) => v.type === 'unique' || v.type === 'range');

    const setSmart = (patch) => onChange({ ...style, mode: 'smart', smart: { ...smart, ...patch } });

    const setVariables = (visualVariables) => setSmart({ visualVariables });

    const addVariable = () => {
        const field = pickSmartField(fields);
        if (!field) return;
        const type = suggestVariableType(field);
        setVariables([...variables, createVisualVariable(type, field.name, features, field)]);
    };

    const applyPalette = (palette) => {
        const next = applyPaletteToVariables(variables, palette.colors);
        if (next) setVariables(next);
    };

    const [palettes, setPalettes] = useState(() => loadPaletteFavorites());

    return (
        <div className="smart-style-smart-tab">
            {embedded?.hasSimpleStyle ? (
                <div className="warning-box text-xs mb-8">
                    Layer has per-feature colors ({embedded.distinctCount} values in <code>{embedded.varyingProperty}</code>).
                    <button type="button" className="btn btn-sm btn-primary mt-8 w-full" onClick={onConvertEmbedded}>
                        Convert to smart style
                    </button>
                </div>
            ) : null}

            <p className="text-muted text-xs mb-8">Choose a field to color features. Add more rules for size or width if needed.</p>

            {variables.map((vv, i) => (
                <VisualVariableEditor
                    key={vv.id || i}
                    vv={vv}
                    index={i}
                    fields={fields}
                    features={features}
                    onChange={(next) => setVariables(variables.map((v, j) => (j === i ? next : v)))}
                    onRemove={() => setVariables(variables.filter((_, j) => j !== i))}
                />
            ))}

            <button type="button" className="btn btn-sm btn-secondary w-full mb-8" onClick={addVariable}>+ Add styling rule</button>

            <details className="smart-style-advanced">
                <summary className="smart-style-advanced-title">Advanced</summary>
                <div className="smart-style-advanced-body">
                    <FilterRulesEditor
                        rules={smart.filterRules || []}
                        fields={fields}
                        onChange={(filterRules) => setSmart({ filterRules })}
                    />

                    <div className="style-type-section mt-8">
                        <h4 className="style-type-header">Saved palettes</h4>
                        {palettes.length === 0 ? <div className="text-muted text-xs mb-8">No saved palettes yet.</div> : null}
                        {palettes.map((p) => (
                            <div className="smart-style-legend-row" key={p.id}>
                                <span className="smart-style-legend-label">{p.name}</span>
                                <div style={{ display: 'flex', gap: 2 }}>
                                    {p.colors.slice(0, 8).map((c, i) => (
                                        <span key={i} style={{ width: 14, height: 14, background: c, borderRadius: 2, border: '1px solid var(--border)' }} />
                                    ))}
                                </div>
                                <div className="smart-style-palette-actions">
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-secondary"
                                        disabled={!hasColorVariable}
                                        title={hasColorVariable ? 'Apply to color classes' : 'Add a unique or class-break rule first'}
                                        onClick={() => applyPalette(p)}
                                    >
                                        Apply
                                    </button>
                                    <button type="button" className="btn-icon" onClick={() => setPalettes(removePaletteFavorite(p.id))}>✕</button>
                                </div>
                            </div>
                        ))}
                        <button type="button" className="btn btn-sm btn-secondary w-full mt-8" onClick={() => {
                            const colors = (variables[0]?.classes || []).map((c) => c.color).filter(Boolean);
                            if (colors.length) setPalettes(addPaletteFavorite(`Palette ${palettes.length + 1}`, colors));
                        }}>Save current class colors</button>
                    </div>

                    <div className="style-type-section mt-8">
                        <h4 className="style-type-header">Default style</h4>
                        <SimpleStyleSection
                            style={mergeDefaultStyleForDisplay(style, smart.defaultStyle)}
                            geomTypes={detectGeomTypes(layer)}
                            onChange={(next) => setSmart({ defaultStyle: extractDefaultStyle(next) })}
                        />
                    </div>
                </div>
            </details>
        </div>
    );
}

export function SmartStylePanel({ layer, style: externalStyle, defaultColor = '#2563eb', onStyleChange }) {
    const geomTypes = useMemo(() => detectGeomTypes(layer), [layer]);
    const style = useMemo(
        () => normalizeStyle(externalStyle, defaultColor),
        [externalStyle, defaultColor]
    );
    const [tab, setTab] = useState(() => (style?.mode === 'smart' ? 'smart' : 'simple'));
    const layerIdRef = useRef(layer?.id);

    useEffect(() => {
        if (layer?.id !== layerIdRef.current) {
            layerIdRef.current = layer?.id;
            setTab(style?.mode === 'smart' ? 'smart' : 'simple');
        }
    }, [layer?.id, style?.mode]);

    const pushStyle = useCallback((next) => {
        onStyleChange?.(next);
    }, [onStyleChange]);

    const handleTab = (nextTab) => {
        setTab(nextTab);
        if (nextTab === 'simple') {
            pushStyle({ ...style, mode: 'simple' });
        } else if (!style.smart?.visualVariables?.length) {
            const fields = layer?.schema?.fields || [];
            const field = pickSmartField(fields);
            const features = layer?.geojson?.features || [];
            const type = suggestVariableType(field);
            pushStyle({
                ...style,
                mode: 'smart',
                smart: {
                    defaultStyle: extractDefaultStyle(style),
                    visualVariables: field ? [createVisualVariable(type, field.name, features, field)] : [],
                    filterRules: []
                }
            });
        } else {
            pushStyle({ ...style, mode: 'smart' });
        }
    };

    const handleConvertEmbedded = () => {
        import('../../js/map/style-import.js').then(({ convertLayerSimpleStyleToSmart }) => {
            const converted = convertLayerSimpleStyleToSmart(layer, defaultColor, style);
            if (converted) {
                setTab('smart');
                pushStyle(converted);
            }
        });
    };

    return (
        <CollapsibleSection title="Layer Style" defaultOpen={false} className="style-panel smart-style-panel">
            <div className="smart-style-tabs">
                <button type="button" className={`btn btn-sm ${tab === 'simple' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handleTab('simple')}>Simple</button>
                <button type="button" className={`btn btn-sm ${tab === 'smart' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handleTab('smart')}>Smart</button>
            </div>
            {tab === 'simple' ? (
                <SimpleStyleSection style={style} geomTypes={geomTypes} onChange={pushStyle} />
            ) : (
                <SmartStyleSection layer={layer} style={style} onChange={pushStyle} onConvertEmbedded={handleConvertEmbedded} />
            )}
        </CollapsibleSection>
    );
}
