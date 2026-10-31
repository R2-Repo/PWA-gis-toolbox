import { useEffect, useMemo, useRef, useState } from 'react';
import { getCompatibleTargets } from '../../../js/tools/tool-result-interop.js';

/**
 * @param {{
 *   result: import('../../../js/tools/tool-result-interop.js').ToolProducedResult | null,
 *   onSelectTarget: (targetId: string) => void,
 *   disabled?: boolean,
 *   className?: string,
 * }} props
 */
export function SendToMenu({ result, onSelectTarget, disabled = false, className = '' }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);

    const targets = useMemo(
        () => (result ? getCompatibleTargets(result) : []),
        [result]
    );

    useEffect(() => {
        if (!open) return undefined;
        const onDoc = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    if (!result?.layerIds?.length || !targets.length) return null;

    return (
        <div
            ref={rootRef}
            className={['send-to-menu', className].filter(Boolean).join(' ')}
            style={{ position: 'relative', display: 'inline-block' }}
            data-testid="send-to-menu"
        >
            <button
                type="button"
                className="btn btn-secondary"
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                Send to…
            </button>
            {open ? (
                <div
                    role="menu"
                    className="send-to-menu__panel"
                    style={{
                        position: 'absolute',
                        bottom: '100%',
                        left: 0,
                        marginBottom: 4,
                        minWidth: 200,
                        zIndex: 20,
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,.15))',
                        padding: 4
                    }}
                >
                    {targets.map(({ entry }) => (
                        <button
                            key={entry.id}
                            type="button"
                            role="menuitem"
                            className="btn btn-sm btn-secondary"
                            style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 2 }}
                            onClick={() => {
                                setOpen(false);
                                onSelectTarget?.(entry.id);
                            }}
                        >
                            {entry.icon ? `${entry.icon} ` : ''}{entry.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
