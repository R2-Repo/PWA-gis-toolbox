/**
 * Compact Place / manage Import Fence control for large-file configure UIs.
 */
export function ImportFencePlaceControl({
    hasActiveFence = false,
    disabled = false,
    onPlaceFence,
    onClearFence
}) {
    return (
        <div className="import-fence-place mb-8">
            <div className="text-xs mb-4" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong>Import Fence</strong>
                {hasActiveFence ? (
                    <span
                        className="text-xs"
                        style={{
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: 'var(--primary, #2563eb)',
                            color: '#fff'
                        }}
                    >
                        Active
                    </span>
                ) : null}
            </div>
            <p className="text-xs text-muted" style={{ margin: '0 0 8px' }}>
                {hasActiveFence
                    ? 'Only features inside the fence will be imported. Dialog hides while you redraw.'
                    : 'Draw a map area to import only features inside it. The importer hides while you draw, then returns with your settings.'}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={disabled}
                    onClick={() => onPlaceFence?.()}
                >
                    {hasActiveFence ? '⛶ Replace fence' : '⛶ Place Import Fence'}
                </button>
                {hasActiveFence ? (
                    <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={disabled}
                        onClick={() => onClearFence?.()}
                    >
                        Clear fence
                    </button>
                ) : null}
            </div>
        </div>
    );
}

export default ImportFencePlaceControl;
