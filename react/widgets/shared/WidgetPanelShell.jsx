import { RunPreviewFooter } from './RunPreviewFooter.jsx';
import { SendToMenu } from './SendToMenu.jsx';

export function WidgetPanelShell({
    className = '',
    status = '',
    statusTone = 'muted',
    onCancel,
    onRun,
    runLabel = 'Run',
    cancelLabel = 'Cancel',
    running = false,
    disabled = false,
    showRun = true,
    footer = null,
    /** When set, shows Send to… in the default footer (compatible registry targets). */
    producedResult = null,
    onSendToTarget = null,
    footerMiddleActions = null,
    children
}) {
    const rootClass = ['gis-widget', className].filter(Boolean).join(' ');

    const sendToAction = producedResult && onSendToTarget ? (
        <SendToMenu
            result={producedResult}
            disabled={running || disabled}
            onSelectTarget={(targetId) => onSendToTarget(targetId, producedResult)}
        />
    ) : null;

    const mergedMiddle = footerMiddleActions || sendToAction ? (
        <>
            {footerMiddleActions}
            {sendToAction}
        </>
    ) : null;

    return (
        <div className={rootClass}>
            <div className="gis-widget__scroll">
                {status ? (
                    <div
                        className="text-xs mb-4 gis-widget__status"
                        style={{ color: statusTone === 'danger' ? 'var(--danger)' : 'var(--text-muted)' }}
                    >
                        {status}
                    </div>
                ) : null}
                {children}
            </div>

            <div className="gis-widget__footer">
                {footer || (
                    <RunPreviewFooter
                        onCancel={onCancel}
                        onRun={onRun}
                        runLabel={runLabel}
                        cancelLabel={cancelLabel}
                        running={running}
                        disabled={disabled}
                        showRun={showRun}
                        middleActions={mergedMiddle}
                    />
                )}
            </div>
        </div>
    );
}
