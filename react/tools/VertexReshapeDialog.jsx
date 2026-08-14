import { WidgetPanelShell } from '../widgets/shared/WidgetPanelShell.jsx';

export function VertexReshapeDialog({
    layerName = '',
    onCancel,
    onStart
}) {
    return (
        <WidgetPanelShell
            onCancel={onCancel}
            onRun={() => onStart?.()}
            runLabel="Start reshaping"
        >
            <p className="text-xs text-muted" style={{ marginBottom: 8 }}>
                Click a feature on <strong>{layerName || 'the active layer'}</strong>, then drag
                vertices to reshape it. Edits apply to this layer. Close Draw when finished.
            </p>
        </WidgetPanelShell>
    );
}
