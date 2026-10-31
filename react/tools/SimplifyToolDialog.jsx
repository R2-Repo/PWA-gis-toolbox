import { useMemo, useState } from 'react';
import { ApplyToSelector, isApplyToValid } from './ApplyToSelector.jsx';
import { WidgetPanelShell } from '../widgets/shared/WidgetPanelShell.jsx';

const TOLERANCE_UNITS = [
    { value: 'm', label: 'metres' },
    { value: 'ft', label: 'feet' },
    { value: 'deg', label: 'degrees (legacy)' }
];

function toleranceLabel(unit) {
    if (unit === 'ft') return 'Tolerance (ft)';
    if (unit === 'deg') return 'Tolerance (degrees)';
    return 'Tolerance (m)';
}

export function SimplifyToolDialog({
    selectionCount = 0,
    totalCount = 0,
    layerName = '',
    onCancel,
    onApply
}) {
    const [toleranceUnit, setToleranceUnit] = useState('m');
    const [tolerance, setTolerance] = useState('10');
    const [applyTo, setApplyTo] = useState(selectionCount > 0 ? 'selection' : 'layer');

    const numericDefaults = useMemo(() => ({
        m: { default: 10, min: 0.001, step: 0.1 },
        ft: { default: 30, min: 0.001, step: 0.1 },
        deg: { default: 0.001, min: 0.0000001, step: 0.0001 }
    }), []);

    const unitMeta = numericDefaults[toleranceUnit] || numericDefaults.m;

    return (
        <WidgetPanelShell
            onCancel={onCancel}
            onRun={() => onApply?.({
                tol: parseFloat(tolerance),
                toleranceUnit,
                applyTo
            })}
            runLabel="Simplify"
            disabled={!isApplyToValid(applyTo, selectionCount)}
        >
            <ApplyToSelector
                selectionCount={selectionCount}
                totalCount={totalCount}
                layerName={layerName}
                onChange={setApplyTo}
            />
            <div className="form-group">
                <label>{toleranceLabel(toleranceUnit)}</label>
                <input
                    type="number"
                    value={tolerance}
                    min={String(unitMeta.min)}
                    step={String(unitMeta.step)}
                    onChange={(e) => setTolerance(e.target.value)}
                />
            </div>
            <div className="form-group">
                <label>Tolerance unit</label>
                <select
                    value={toleranceUnit}
                    onChange={(e) => {
                        const next = e.target.value;
                        setToleranceUnit(next);
                        setTolerance(String(numericDefaults[next]?.default ?? 10));
                    }}
                >
                    {TOLERANCE_UNITS.map((entry) => (
                        <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                </select>
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                    {toleranceUnit === 'deg'
                        ? 'Degrees along lon/lat — matches saved workflows before unit support.'
                        : 'Ground distance at the data latitude; smaller keeps more detail.'}
                </p>
            </div>
        </WidgetPanelShell>
    );
}
