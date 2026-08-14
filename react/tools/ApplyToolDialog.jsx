import { useState } from 'react';
import { ApplyToSelector, isApplyToValid } from './ApplyToSelector.jsx';
import { WidgetPanelShell } from '../widgets/shared/WidgetPanelShell.jsx';

export function ApplyToolDialog({
    selectionCount = 0,
    totalCount = 0,
    layerName = '',
    runLabel = 'Run',
    hint = '',
    onCancel,
    onApply
}) {
    const [applyTo, setApplyTo] = useState(selectionCount > 0 ? 'selection' : 'layer');

    return (
        <WidgetPanelShell
            onCancel={onCancel}
            onRun={() => onApply?.({ applyTo })}
            runLabel={runLabel}
            disabled={!isApplyToValid(applyTo, selectionCount)}
        >
            {hint ? <p className="text-xs text-muted" style={{ marginBottom: 8 }}>{hint}</p> : null}
            <ApplyToSelector
                selectionCount={selectionCount}
                totalCount={totalCount}
                layerName={layerName}
                onChange={setApplyTo}
            />
        </WidgetPanelShell>
    );
}
