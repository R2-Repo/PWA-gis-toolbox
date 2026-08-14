import { useMemo, useState } from 'react';
import { ApplyToSelector, isApplyToValid } from './ApplyToSelector.jsx';
import { LayerSelect } from '../widgets/shared/LayerSelect.jsx';
import { WidgetPanelShell } from '../widgets/shared/WidgetPanelShell.jsx';

export function SplitPolygonDialog({
    selectionCount = 0,
    totalCount = 0,
    layerName = '',
    cutterLabel = 'Cutter layer',
    cutterLayers = [],
    defaultCutterId = '',
    runLabel = 'Split',
    hint = '',
    onCancel,
    onApply
}) {
    const [applyTo, setApplyTo] = useState(selectionCount > 0 ? 'selection' : 'layer');
    const initialCutter = useMemo(
        () => defaultCutterId || cutterLayers[0]?.id || '',
        [defaultCutterId, cutterLayers]
    );
    const [cutterId, setCutterId] = useState(initialCutter);

    return (
        <WidgetPanelShell
            onCancel={onCancel}
            onRun={() => onApply?.({ applyTo, cutterId })}
            runLabel={runLabel}
            disabled={!isApplyToValid(applyTo, selectionCount) || !cutterId}
        >
            {hint ? <p className="text-xs text-muted" style={{ marginBottom: 8 }}>{hint}</p> : null}
            <ApplyToSelector
                selectionCount={selectionCount}
                totalCount={totalCount}
                layerName={layerName}
                onChange={setApplyTo}
            />
            <LayerSelect
                label={cutterLabel}
                value={cutterId}
                layers={cutterLayers}
                allowEmpty={false}
                onChange={setCutterId}
            />
        </WidgetPanelShell>
    );
}
