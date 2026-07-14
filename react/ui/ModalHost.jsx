import { useEffect, useMemo, useRef } from 'react';
import { dismissModal, triggerProgressCancel } from '../../js/ui/modals.js';
import { formatBytes } from '../../js/import/import-preflight.js';
import { DockedWidgetModal } from './DockedWidgetModal.jsx';

function BasicModal({ modal }) {
    const overlayRef = useRef(null);
    const mouseDownTargetRef = useRef(null);
    const mountedRef = useRef(false);

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const width = isMobile ? '96vw' : (modal.options?.width || '600px');
    const layerClass = modal.options?.layer === 'splash'
        ? 'modal-overlay--splash'
        : modal.options?.layer === 'deferred'
            ? 'modal-overlay--deferred'
            : '';

    const close = (result = null) => dismissModal(modal.id, result);

    useEffect(() => {
        if (mountedRef.current) return;
        const overlay = overlayRef.current;
        if (!overlay) return;

        const body = overlay.querySelector('.modal-body');
        if (body) {
            body.innerHTML = modal.contentHtml || '';
        }

        const footer = overlay.querySelector('.modal-footer-slot');
        if (footer && modal.options?.footer) {
            footer.innerHTML = modal.options.footer;
        }

        mountedRef.current = true;
        overlay._close = close;
        overlay._resolve = () => {};
        modal.options?.onMount?.(overlay, close);
    }, [modal.id]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div
            ref={overlayRef}
            className={`modal-overlay${layerClass ? ` ${layerClass}` : ''}`}
            onMouseDown={(e) => { mouseDownTargetRef.current = e.target; }}
            onClick={(e) => {
                if (e.target === overlayRef.current && mouseDownTargetRef.current === overlayRef.current) {
                    if (typeof overlayRef.current?._interceptClose === 'function'
                        && overlayRef.current._interceptClose() === true) {
                        return;
                    }
                    close(null);
                }
            }}
        >
            <div className="modal" style={{ width }}>
                <div className="modal-header">
                    <span>{modal.title}</span>
                    <button
                        className="btn-icon close-modal"
                        aria-label="Close"
                        onClick={() => {
                            if (typeof overlayRef.current?._interceptClose === 'function'
                                && overlayRef.current._interceptClose() === true) {
                                return;
                            }
                            close(null);
                        }}
                    >
                        ✕
                    </button>
                </div>
                <div className="modal-body" />
                {modal.options?.footer ? (
                    <div className="modal-footer modal-footer-slot" />
                ) : null}
            </div>
        </div>
    );
}

function ProgressModal({ progress }) {
    const percent = useMemo(() => Math.max(0, Math.min(100, Number(progress.percent) || 0)), [progress.percent]);
    const fileLabel = progress.fileName
        ? `${progress.fileName}${progress.fileSize != null ? ` (${formatBytes(progress.fileSize)})` : ''}`
        : null;
    const batchUnit = progress.batchLabelUnit || 'File';
    const batchLabel = progress.fileCount > 1 && progress.fileIndex != null
        ? `${batchUnit} ${progress.fileIndex + 1} of ${progress.fileCount}`
        : null;

    return (
        <div className="modal-overlay">
            <div className="modal" style={{ width: '400px' }}>
                <div className="modal-header">
                    <span>{progress.title}</span>
                </div>
                <div className="modal-body" style={{ textAlign: 'center', padding: '24px' }}>
                    <div className="spinner" style={{ margin: '0 auto 12px' }}></div>
                    {batchLabel ? (
                        <div className="text-xs text-muted" style={{ marginBottom: '6px' }}>{batchLabel}</div>
                    ) : null}
                    {fileLabel ? (
                        <div className="text-xs" style={{ marginBottom: '8px', wordBreak: 'break-all' }}>{fileLabel}</div>
                    ) : null}
                    <div className="progress-step" style={{ marginBottom: '12px', color: 'var(--text-muted)' }}>{progress.step || 'Starting...'}</div>
                    <div className="progress-bar-container">
                        <div className="progress-bar-fill" style={{ width: `${percent}%` }}></div>
                        <div className="progress-bar-text">{Math.round(percent)}%</div>
                    </div>
                    <button
                        className="btn btn-secondary btn-sm cancel-task-btn"
                        style={{ marginTop: '12px' }}
                        onClick={() => triggerProgressCancel(progress.id)}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

export function ModalHost({ modals = [], progresses = [] }) {
    return (
        <>
            {modals.map((modal) => (
                modal.options?.docked
                    ? <DockedWidgetModal key={`modal-${modal.id}`} modal={modal} />
                    : <BasicModal key={`modal-${modal.id}`} modal={modal} />
            ))}
            {progresses.map((progress) => (
                <ProgressModal key={`progress-${progress.id}`} progress={progress} />
            ))}
        </>
    );
}
