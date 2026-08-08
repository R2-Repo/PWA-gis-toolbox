import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import bus from '../../js/core/event-bus.js';

function MenuItem({ item, index, dismiss }) {
    if (item.sep) return <div key={`sep-${index}`} className="ctx-sep" />;

    if (item.children?.length) {
        return (
            <div key={`${item.label}-${index}`} className="ctx-item ctx-item-has-submenu">
                <span className="ctx-icon">{item.icon}</span>
                <span className="ctx-label">{item.label}</span>
                <span className="ctx-submenu-arrow" aria-hidden>▸</span>
                <div className="ctx-submenu" onClick={(e) => e.stopPropagation()}>
                    {item.children.map((child, childIndex) => (
                        <MenuItem
                            key={`${child.label}-${childIndex}`}
                            item={child}
                            index={childIndex}
                            dismiss={dismiss}
                        />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div
            key={`${item.label}-${index}`}
            className={`ctx-item${item.hint ? ' ctx-item--with-hint' : ''}`}
            title={item.title || item.hint || undefined}
            onClick={(e) => {
                e.stopPropagation();
                dismiss();
                item.action?.();
            }}
        >
            <span className="ctx-icon">{item.icon}</span>
            <span className="ctx-label">
                {item.label}
                {item.hint ? <span className="ctx-hint">{item.hint}</span> : null}
            </span>
        </div>
    );
}

/**
 * Auto-opens after box-select completes (`selection:boxComplete`).
 */
export function SelectionActionsMenu({ buildItems }) {
    const [menu, setMenu] = useState(null);
    const dismissACRef = useRef(null);

    const dismiss = useCallback(() => {
        setMenu(null);
        if (dismissACRef.current) {
            dismissACRef.current.abort();
            dismissACRef.current = null;
        }
    }, []);

    useEffect(() => {
        const handler = (payload) => {
            dismiss();
            const built = buildItems?.(payload, dismiss);
            const items = Array.isArray(built) ? built : (built?.items || []);
            if (!items.length) return;

            setMenu({
                x: payload.clientX ?? 0,
                y: payload.clientY ?? 0,
                items,
                layerName: built?.layerName || null
            });

            dismissACRef.current = new AbortController();
            const sig = dismissACRef.current.signal;
            requestAnimationFrame(() => {
                if (sig.aborted) return;
                const onPointer = (e) => {
                    if (!e.target.closest('.map-context-menu')) dismiss();
                };
                document.addEventListener('pointerdown', onPointer, { signal: sig });
                document.addEventListener('contextmenu', onPointer, { signal: sig });
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') dismiss();
                }, { signal: sig });
                document.addEventListener('wheel', () => dismiss(), { signal: sig, passive: true });
            });
        };

        bus.on('selection:boxComplete', handler);
        return () => {
            bus.off('selection:boxComplete', handler);
            dismiss();
        };
    }, [buildItems, dismiss]);

    useEffect(() => {
        if (!menu) return;
        const el = document.querySelector('.map-context-menu.selection-actions-menu');
        if (!el) return;
        const rect = el.getBoundingClientRect();
        let { x, y } = menu;
        if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
        if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
        if (x !== menu.x || y !== menu.y) {
            setMenu((current) => (current ? { ...current, x, y } : current));
        }
    }, [menu]);

    if (!menu) return null;

    return createPortal(
        <div
            className="map-context-menu selection-actions-menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
        >
            {menu.layerName ? <div className="ctx-header">{menu.layerName}</div> : null}
            {menu.items.map((item, index) => (
                <MenuItem key={`${item.label ?? 'sep'}-${index}`} item={item} index={index} dismiss={dismiss} />
            ))}
        </div>,
        document.body
    );
}
