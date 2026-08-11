import { useEffect, useMemo } from 'react';
import {
    IMPORT_FILTER_OPERATORS,
    createEmptyFeatureFilter,
    isCompleteImportFilterRule
} from '../../js/import/import-feature-filter.js';

function emptyRule(fields = []) {
    return {
        field: fields[0] || '',
        operator: 'equals',
        value: ''
    };
}

function isListOperator(operator) {
    return operator === 'equals'
        || operator === 'not_equals'
        || operator === 'in'
        || operator === 'not_in';
}

function selectedValuesFromRule(rule) {
    if (Array.isArray(rule.value)) return rule.value.map(String);
    return String(rule.value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Pre-import geometry-type toggles + attribute filter rules with value pickers.
 */
export function ImportFeatureFilterPanel({
    fieldNames = [],
    valueCatalog = null,
    scanState = 'idle',
    scanProgress = null,
    scanMessage = null,
    onCancelScan = null,
    onRetryScan = null,
    featureFilter = null,
    onChange
}) {
    const filter = featureFilter || createEmptyFeatureFilter();
    const geometryTypes = filter.geometryTypes || { point: true, line: true, polygon: true };
    const rules = Array.isArray(filter.rules) ? filter.rules : [];
    const logic = filter.logic === 'OR' ? 'OR' : 'AND';

    const valuesByField = useMemo(() => {
        /** @type {Map<string, { values: string[], truncated: boolean, uniqueCount: number }>} */
        const map = new Map();
        for (const entry of valueCatalog?.fields || []) {
            if (entry?.name) map.set(entry.name, entry);
        }
        return map;
    }, [valueCatalog]);

    // Prefer sniffed fields, then any extra keys discovered during the value scan.
    const fields = useMemo(() => {
        const seen = new Set();
        const out = [];
        for (const name of fieldNames || []) {
            if (!name || seen.has(name)) continue;
            seen.add(name);
            out.push(name);
        }
        for (const name of valuesByField.keys()) {
            if (seen.has(name)) continue;
            seen.add(name);
            out.push(name);
        }
        return out;
    }, [fieldNames, valuesByField]);

    const patch = (next) => {
        onChange?.({
            geometryTypes,
            rules,
            logic,
            ...next
        });
    };

    const updateRule = (index, part) => {
        const nextRules = rules.map((rule, i) => (i === index ? { ...rule, ...part } : rule));
        patch({ rules: nextRules });
    };

    const addRule = () => {
        patch({ rules: [...rules, emptyRule(fields)] });
    };

    const removeRule = (index) => {
        if (rules.length <= 1) {
            patch({ rules: [emptyRule(fields)] });
            return;
        }
        patch({ rules: rules.filter((_, i) => i !== index) });
    };

    // One ready (unset) filter row by default — no "Add" click required to start.
    useEffect(() => {
        if (!fields.length) return;
        if (rules.length > 0) return;
        onChange?.({
            geometryTypes,
            logic,
            rules: [emptyRule(fields)]
        });
    }, [fields, rules.length, geometryTypes, logic, onChange]);

    const scanning = scanState === 'scanning';
    const scanFailed = scanState === 'unsupported' || scanState === 'error';
    const scanReady = scanState === 'ready';

    const geometrySummary = [
        geometryTypes.point !== false ? 'Points' : null,
        geometryTypes.line !== false ? 'Lines' : null,
        geometryTypes.polygon !== false ? 'Polygons' : null
    ].filter(Boolean).join(' · ') || 'None selected';

    const completeRuleCount = rules.filter(isCompleteImportFilterRule).length;
    const attributeSummary = completeRuleCount === 0
        ? 'No filters'
        : `${completeRuleCount} filter${completeRuleCount === 1 ? '' : 's'}`;

    return (
        <div className="mb-8">
            <details className="import-local-collapse">
                <summary className="import-local-collapse__summary">
                    <span>Geometry types</span>
                    <span className="import-local-collapse__meta">{geometrySummary}</span>
                </summary>
                <div className="import-local-collapse__body">
                    <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
                        {[
                            { key: 'point', label: 'Points' },
                            { key: 'line', label: 'Lines' },
                            { key: 'polygon', label: 'Polygons' }
                        ].map((opt) => (
                            <label key={opt.key} className="text-xs" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <input
                                    type="checkbox"
                                    checked={geometryTypes[opt.key] !== false}
                                    onChange={(e) => patch({
                                        geometryTypes: { ...geometryTypes, [opt.key]: e.target.checked }
                                    })}
                                />
                                {opt.label}
                            </label>
                        ))}
                    </div>
                </div>
            </details>

            <details className="import-local-collapse">
                <summary className="import-local-collapse__summary">
                    <span>Attribute value filters</span>
                    <span className="import-local-collapse__meta">
                        {attributeSummary}
                        {valueCatalog?.rowCount != null && scanReady
                            ? ` · ${valueCatalog.rowCount.toLocaleString()} rows scanned`
                            : ''}
                    </span>
                </summary>
                <div className="import-local-collapse__body">
                    {scanning ? (
                        <div className="info-box text-xs mb-8">
                            <div>
                                {typeof scanProgress?.percent === 'number'
                                    ? `Scanning values… ${scanProgress.percent}%`
                                    : 'Scanning values…'}
                            </div>
                            {onCancelScan ? (
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ marginTop: 8 }}
                                    onClick={() => onCancelScan()}
                                >
                                    Cancel scan
                                </button>
                            ) : null}
                        </div>
                    ) : null}

                    {scanFailed ? (
                        <div className="info-box text-xs mb-8">
                            <div>{scanMessage || 'Could not build value lists.'}</div>
                            {onRetryScan ? (
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ marginTop: 8 }}
                                    onClick={() => onRetryScan()}
                                >
                                    Retry value scan
                                </button>
                            ) : null}
                        </div>
                    ) : null}

                    {rules.map((rule, index) => {
                        const catalog = valuesByField.get(rule.field);
                        const values = catalog?.values || [];
                        const hasValues = values.length > 0;
                        const listOps = isListOperator(rule.operator);
                        const showValuePicker = listOps && hasValues;
                        const selectedValues = selectedValuesFromRule(rule);

                        return (
                            <div key={index} className="mb-8" style={{ borderBottom: '1px solid var(--border, #ddd)', paddingBottom: 8 }}>
                                <div className="flex gap-4 items-center mb-4" style={{ flexWrap: 'wrap' }}>
                                    <select
                                        className="rule-field"
                                        style={{ flex: 1, minWidth: 120 }}
                                        value={rule.field || fields[0] || ''}
                                        onChange={(e) => updateRule(index, { field: e.target.value, value: '' })}
                                    >
                                        {fields.map((f) => (
                                            <option key={f} value={f}>{f}</option>
                                        ))}
                                    </select>
                                    <select
                                        className="rule-op"
                                        style={{ flex: 1, minWidth: 120 }}
                                        value={rule.operator}
                                        onChange={(e) => updateRule(index, { operator: e.target.value, value: '' })}
                                    >
                                        {IMPORT_FILTER_OPERATORS.map((o) => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                    {rule.operator !== 'is_null' && rule.operator !== 'is_not_null' && !showValuePicker ? (
                                        <input
                                            type="text"
                                            className="rule-val"
                                            placeholder={scanning ? 'Waiting for value scan…' : 'Type a value'}
                                            style={{ flex: 1, minWidth: 120 }}
                                            value={Array.isArray(rule.value) ? rule.value.join(', ') : (rule.value ?? '')}
                                            onChange={(e) => updateRule(index, { value: e.target.value })}
                                            disabled={scanning}
                                        />
                                    ) : null}
                                    {showValuePicker ? (
                                        <select
                                            className="rule-val"
                                            style={{ flex: 1, minWidth: 140 }}
                                            value={selectedValues[0] || ''}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                updateRule(index, {
                                                    value: v ? [v] : [],
                                                    operator: rule.operator === 'not_equals' || rule.operator === 'not_in'
                                                        ? 'not_equals'
                                                        : 'equals'
                                                });
                                            }}
                                        >
                                            <option value="">Select a value…</option>
                                            {values.map((v) => (
                                                <option key={v} value={v}>{v}</option>
                                            ))}
                                        </select>
                                    ) : null}
                                    {showValuePicker && catalog?.truncated ? (
                                        <input
                                            type="text"
                                            className="rule-val"
                                            placeholder="Or type exact value"
                                            style={{ flex: 1, minWidth: 120 }}
                                            value={Array.isArray(rule.value) ? rule.value.join(', ') : (rule.value ?? '')}
                                            onChange={(e) => updateRule(index, { value: e.target.value })}
                                        />
                                    ) : null}
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => removeRule(index)}
                                        title="Remove rule"
                                    >
                                        ✕
                                    </button>
                                </div>

                                {showValuePicker ? (
                                    <div>
                                        <div
                                            className="text-xs"
                                            style={{
                                                maxHeight: 180,
                                                overflow: 'auto',
                                                border: '1px solid var(--border, #ddd)',
                                                borderRadius: 4,
                                                padding: 8
                                            }}
                                        >
                                            {values.map((v) => {
                                                const checked = selectedValues.includes(v);
                                                return (
                                                    <label
                                                        key={v}
                                                        style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={(e) => {
                                                                const next = e.target.checked
                                                                    ? [...selectedValues, v]
                                                                    : selectedValues.filter((x) => x !== v);
                                                                const op = next.length > 1
                                                                    ? (rule.operator === 'not_equals' || rule.operator === 'not_in'
                                                                        ? 'not_in'
                                                                        : 'in')
                                                                    : (rule.operator === 'not_equals' || rule.operator === 'not_in'
                                                                        ? 'not_equals'
                                                                        : 'equals');
                                                                updateRule(index, { value: next, operator: op });
                                                            }}
                                                        />
                                                        <span style={{ wordBreak: 'break-word' }}>{v}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}

                    <div className="flex gap-4 items-center" style={{ flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={addRule}
                            disabled={!fields.length || scanning}
                            title={scanning ? 'Wait for the value scan to finish' : undefined}
                        >
                            Add another filter
                        </button>
                        {rules.length > 1 ? (
                            <label className="text-xs" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                Match
                                <select
                                    value={logic}
                                    onChange={(e) => patch({ logic: e.target.value })}
                                >
                                    <option value="AND">all rules (AND)</option>
                                    <option value="OR">any rule (OR)</option>
                                </select>
                            </label>
                        ) : null}
                    </div>
                </div>
            </details>
        </div>
    );
}

export default ImportFeatureFilterPanel;
