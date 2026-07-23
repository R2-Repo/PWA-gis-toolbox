import { useState } from 'react';
import { createPortal } from 'react-dom';
import { formatChannelPrimary } from '../../js/atlas/display-label.js';
import { closeChannelWorker, appendWorkerLog } from '../../js/atlas/worker-manager.js';

/**
 * In-app floating channel monitor worker (V2).
 */
export function ChannelMonitorWorker({
    workerId,
    channelNumber,
    log = [],
    onClose,
    onPingChannel,
    onStartMonitor,
    canPing
}) {
    const [pos, setPos] = useState({ x: 80, y: 80 });
    const [drag, setDrag] = useState(null);

    const onHeaderPointerDown = (e) => {
        setDrag({ ox: e.clientX - pos.x, oy: e.clientY - pos.y });
    };

    const onPointerMove = (e) => {
        if (!drag) return;
        setPos({ x: e.clientX - drag.ox, y: e.clientY - drag.oy });
    };

    const onPointerUp = () => setDrag(null);

    return createPortal(
        <div
            className="atlas-channel-worker"
            style={{ left: pos.x, top: pos.y }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
        >
            <div
                className="atlas-channel-worker__header"
                onPointerDown={onHeaderPointerDown}
            >
                <strong>Channel {formatChannelPrimary(channelNumber)}</strong>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                    closeChannelWorker(workerId);
                    onClose?.();
                }}
                >
                    ×
                </button>
            </div>
            <div className="atlas-channel-worker__toolbar">
                {canPing && (
                    <>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPingChannel?.(channelNumber)}>
                            Ping channel
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStartMonitor?.({ channelNumber, workerId })}>
                            Monitor
                        </button>
                    </>
                )}
            </div>
            <pre className="atlas-channel-worker__log">
                {(log.length ? log : [{ at: '', text: '— waiting for ping —' }]).map((line, i) => (
                    <div key={`${line.at}-${i}`}>
                        {line.at ? `${line.at.slice(11, 19)} ` : ''}
                        {line.text || `${line.ip || ''} ${line.status || ''} ${line.rttMs != null ? `${line.rttMs}ms` : ''}`}
                    </div>
                ))}
            </pre>
        </div>,
        document.body
    );
}

export { appendWorkerLog };
