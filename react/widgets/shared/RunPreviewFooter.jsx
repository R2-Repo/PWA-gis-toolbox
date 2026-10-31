/**
 * Standard GIS widget dialog footer: Cancel · Back · extras · Preview · Run (primary).
 * Use for all widget footers — do not hand-roll `modal-footer` in dialog components.
 */
export function RunPreviewFooter({
    onCancel,
    onRun,
    runLabel = 'Run',
    cancelLabel = 'Cancel',
    running = false,
    disabled = false,
    showRun = true,
    showCancel = true,
    runBusyLabel = 'Running...',
    onBack,
    showBack = false,
    backLabel = 'Back',
    backDisabled = false,
    onPreview,
    previewLabel = 'Preview',
    showPreview = false,
    previewDisabled = false,
    previewBusy = false,
    /** Secondary actions between navigation and primary (e.g. Skip, Run again). */
    middleActions = null,
    /** Replace the default primary Run button (advanced layouts only). */
    primaryAction = null,
    className = ''
}) {
    const rootClass = ['modal-footer', className].filter(Boolean).join(' ');

    return (
        <div className={rootClass} data-testid="widget-run-preview-footer">
            {showCancel ? (
                <button
                    type="button"
                    className="btn btn-secondary cancel-btn"
                    onClick={() => onCancel?.()}
                >
                    {cancelLabel}
                </button>
            ) : null}
            {showBack ? (
                <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={backDisabled}
                    onClick={() => onBack?.()}
                >
                    {backLabel}
                </button>
            ) : null}
            {middleActions}
            {showPreview ? (
                <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={previewDisabled || previewBusy}
                    onClick={() => onPreview?.()}
                >
                    {previewBusy ? 'Previewing…' : previewLabel}
                </button>
            ) : null}
            {primaryAction || (showRun ? (
                <button
                    type="button"
                    className="btn btn-primary apply-btn"
                    onClick={() => onRun?.()}
                    disabled={disabled || running}
                >
                    {running ? runBusyLabel : runLabel}
                </button>
            ) : null)}
        </div>
    );
}
