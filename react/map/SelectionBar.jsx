import { useEventBus } from '../hooks/useEventBus.js';

export function SelectionBar({
    getActiveLayer,
    getSelectionCount
}) {
    useEventBus('selection:changed');
    useEventBus('selection:modeChanged');
    useEventBus('layer:active');

    const layer = getActiveLayer?.() ?? null;
    const count = layer ? (getSelectionCount?.(layer.id) ?? 0) : 0;
    const total = layer?.geojson?.features?.length || 0;

    if (count <= 0) return null;

    return (
        <div className="selection-bar selection-bar--header" title={`${count} of ${total} selected`}>
            <span className="sel-count">{count}</span>
            <span className="sel-of">/{total}</span>
            <span className="sel-label">selected</span>
        </div>
    );
}
