import { useMemo } from 'react';
import {
    IMPORT_FILTER_OPERATORS,
    IMPORT_VALUE_SCAN_CAP,
    createEmptyFeatureFilter
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
        patch({ rules: [...rules, emptyRule(fieldNames)] });
    };

    const removeRule = (index) => {
        patch({ rules: rules.length <= 1 ? [] : rules.filter((_, i) => i !== index) });
    };

    const scanning = scanState === 'scanning';
    const scanFailed = scanState === 'unsupported' || scanState === 'error';
    const scanReady = scanState === 'ready';

    return (
        <div className="mb-8">
            <div className="text-xs mb-4"><strong>Feature filters</strong></div>
            <p className="text-xs text-muted mb-8">
                Drop features you do not need before they are stored. Combine with attribute
                deselection above and an Import Fence for spatial extent.
            </p>

            <div className="text-xs mb-4"><strong>Geometry types</strong></div>
            <div className="flex gap-8 mb-8" style={{ flexWrap: 'wrap' }}>
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

            <div className="text-xs mb-4" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong>Attribute value filters</strong>
                {valueCatalog?.rowCount != null && scanReady ? (
                    <span className="text-muted">
                        {valueCatalog.rowCount.toLocaleString()} rows scanned
                        {valueCatalog.fields?.length
                            ? ` · ${valueCatalog.fields.length} fields`
                            : ''}
                    </span>
                ) : null}
            </div>

            {scanning ? (
                <div className="info-box text-xs mb-8">
                    <div><strong>Reading attribute values from the file…</strong></div>
                    <div className="text-muted" style={{ marginTop: 4 }}>
                        {typeof scanProgress?.percent === 'number'
                            ? `${scanProgress.percent}% — large files can take a few minutes.`
                            : 'Working… large files can take a few minutes.'}
                    </div>
                    <div className="text-muted" style={{ marginTop: 4 }}>
                        Wait for this to finish — then each filter field gets a dropdown of values found in the file.
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
                    <div>{scanMessage || 'Could not build value lists from this file.'}</div>
                    <div className="text-muted" style={{ marginTop: 4 }}>
                        You can still type values manually, or retry the scan.
                    </div>
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

            {scanReady ? (
                <p className="text-xs text-muted mb-8">
                    Choose a field, then pick values from the list (up to{' '}
                    {IMPORT_VALUE_SCAN_CAP.toLocaleString()} distinct values per field).
                    Use checkboxes to keep several values at once.
                    {scanMessage ? (
                        <>
                            {' '}
                            <span>{scanMessage}</span>
                        </>
                    ) : null}
                </p>
            ) : null}

            {!scanning && scanState === 'idle' ? (
                <p className="text-xs text-muted mb-8">
                    Value lists appear after the file is scanned for distinct attribute values.
                </p>
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
                                value={rule.field || fieldNames[0] || ''}
                                onChange={(e) => updateRule(index, { field: e.target.value, value: '' })}
                            >
                                {fieldNames.map((f) => (
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

                        {listOps && !hasValues && scanReady ? (
                            <div className="text-xs text-muted mb-4">
                                No values found for “{rule.field}” in the scan (all null/empty, or field missing from sampled features).
                                Type a value above if you know it.
                            </div>
                        ) : null}

                        {catalog?.truncated ? (
                            <div className="text-xs text-muted mb-4">
                                Showing first {values.length.toLocaleString()} distinct values
                                — type the exact value above if yours is not listed.
                            </div>
                        ) : null}

                        {showValuePicker ? (
                            <div>
                                <div className="text-xs text-muted mb-4">
                                    Or check multiple values to keep (uses “In” / “Not in”):
                                </div>
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
                    disabled={!fieldNames.length || scanning}
                    title={scanning ? 'Wait for the value scan to finish' : undefined}
                >
                    Add attribute filter
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
    );
}

export default ImportFeatureFilterPanel;
