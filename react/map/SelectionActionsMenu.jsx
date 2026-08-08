import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import bus from '../../js/core/event-bus.js';
import mapService from '../../js/map/map-service.js';
import { placeMenuOutsideSelectionBox } from '../../js/map/map-interaction-utils.js';

const SUBMENU_GAP = 4;
const SUBMENU_PAD = 8;
const SUBMENU_MAX_H = 320;

/**
 * Flip submenu into the viewport (left/right + clamp vertical) with scroll if needed.
 * @param {DOMRect} parentRect
 * @param {{ width: number, height: number }} size
 */
function placeSubmenu(parentRect, size) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(size.width || 200, vw - SUBMENU_PAD * 2);
    const height = Math.min(size.height || 200, Math.min(SUBMENU_MAX_H, vh - SUBMENU_PAD * 2));

    const spaceRight = vw - parentRect.right - SUBMENU_GAP - SUBMENU_PAD;
    const spaceLeft = parentRect.left - SUBMENU_GAP - SUBMENU_PAD;
    const openLeft = spaceRight < width && spaceLeft > spaceRight;

    let left = openLeft
        ? parentRect.left - SUBMENU_GAP - width
        : parentRect.right + SUBMENU_GAP;
    left = Math.max(SUBMENU_PAD, Math.min(left, vw - width - SUBMENU_PAD));

    let top = parentRect.top;
    if (top + height > vh - SUBMENU_PAD) {
        top = Math.max(SUBMENU_PAD, vh - height - SUBMENU_PAD);
    }

    return { left, top, width, maxHeight: height, openLeft };
}

function MenuItem({ item, index, onItemClick }) {
    if (item.sep) return <div key={`sep-${index}`} className="ctx-sep" />;

    if (item.children?.length) {
        return (
            <SubmenuItem item={item} index={index} onItemClick={onItemClick} />
        );
    }

    const danger = /delete|clear/i.test(item.label || '');

    return (
        <button
            type="button"
            key={`${item.label}-${index}`}
            className={`ctx-item${item.hint ? ' ctx-item--with-hint' : ''}${danger ? ' ctx-item--danger' : ''}`}
            title={item.title || item.hint || undefined}
            onClick={(e) => {
                e.stopPropagation();
                onItemClick?.(item);
            }}
        >
            <span className="ctx-icon" aria-hidden>{item.icon}</span>
            <span className="ctx-label">
                {item.label}
                {item.hint ? <span className="ctx-hint">{item.hint}</span> : null}
            </span>
        </button>
    );
}

function SubmenuItem({ item, index, onItemClick }) {
    const parentRef = useRef(null);
    const submenuRef = useRef(null);
    const closeTimerRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);

    const clearCloseTimer = useCallback(() => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    }, []);

    const openMenu = useCallback(() => {
        clearCloseTimer();
        setOpen(true);
    }, [clearCloseTimer]);

    const scheduleClose = useCallback(() => {
        clearCloseTimer();
        // Portal is not a DOM child — allow time to move into the submenu
        closeTimerRef.current = setTimeout(() => setOpen(false), 160);
    }, [clearCloseTimer]);

    useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

    const reposition = useCallback(() => {
        const parent = parentRef.current;
        const submenu = submenuRef.current;
        if (!parent || !submenu) return;
        const parentRect = parent.getBoundingClientRect();
        const size = {
            width: Math.max(submenu.scrollWidth, 180),
            height: submenu.scrollHeight
        };
        setPos(placeSubmenu(parentRect, size));
    }, []);

    useLayoutEffect(() => {
        if (!open) return;
        reposition();
    }, [open, reposition, item.children?.length]);

    return (
        <div
            key={`${item.label}-${index}`}
            ref={parentRef}
            className={`ctx-item ctx-item-has-submenu${open ? ' is-open' : ''}${pos?.openLeft ? ' submenu-left' : ''}`}
            onMouseEnter={openMenu}
            onMouseLeave={scheduleClose}
            onFocus={openMenu}
        >
            <span className="ctx-icon" aria-hidden>{item.icon}</span>
            <span className="ctx-label">{item.label}</span>
            <span className="ctx-submenu-arrow" aria-hidden>{pos?.openLeft ? '◂' : '▸'}</span>
            {open ? createPortal(
                <div
                    ref={submenuRef}
                    className="ctx-submenu ctx-submenu--portal"
                    style={pos ? {
                        left: pos.left,
                        top: pos.top,
                        minWidth: pos.width,
                        maxHeight: pos.maxHeight
                    } : { left: -9999, top: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={openMenu}
                    onMouseLeave={scheduleClose}
                >
                    {item.children.map((child, childIndex) => (
                        <MenuItem
                            key={`${child.label}-${childIndex}`}
                            item={child}
                            index={childIndex}
                            onItemClick={onItemClick}
                        />
                    ))}
                </div>,
                document.body
            ) : null}
        </div>
    );
}

/**
 * Auto-opens after box-select completes (`selection:boxComplete`).
 * Stays open for the life of the selection box — actions do not close it.
 * Closing the menu (X / Clear selection / Esc) clears the box, and vice versa.
 */
export function SelectionActionsMenu({ buildItems }) {
    const [menu, setMenu] = useState(null);
    const menuRef = useRef(null);
    const dismissACRef = useRef(null);
    const placedRef = useRef(false);
    const clearingBoxRef = useRef(false);
    const menuLayerIdRef = useRef(null);

    const dismissMenuOnly = useCallback(() => {
        setMenu(null);
        placedRef.current = false;
        menuLayerIdRef.current = null;
        if (dismissACRef.current) {
            dismissACRef.current.abort();
            dismissACRef.current = null;
        }
    }, []);

    /** Close menu and clear the selection box outline (linked lifetime). */
    const dismiss = useCallback(() => {
        dismissMenuOnly();
        if (clearingBoxRef.current) return;
        clearingBoxRef.current = true;
        try {
            mapService.clearSelectionBoxOutline?.();
        } finally {
            clearingBoxRef.current = false;
        }
    }, [dismissMenuOnly]);

    const onItemClick = useCallback((item) => {
        item.action?.();
        // Only Clear selection (or items marked closeMenu) tear down the box + menu
        if (item.closeMenu || item.label === 'Clear selection') {
            dismiss();
        }
    }, [dismiss]);

    useEffect(() => {
        const onBoxComplete = (payload) => {
            dismissMenuOnly();
            const built = buildItems?.(payload, dismiss);
            const items = Array.isArray(built) ? built : (built?.items || []);
            if (!items.length) return;

            const layerName = built?.layerName || null;
            const count = built?.count ?? payload.count ?? null;
            menuLayerIdRef.current = payload.layerId || null;

            setMenu({
                x: -9999,
                y: -9999,
                items,
                layerName,
                count,
                screenBbox: payload.screenBbox || null,
                cursorX: payload.clientX ?? 0,
                cursorY: payload.clientY ?? 0
            });
            placedRef.current = false;

            dismissACRef.current = new AbortController();
            const sig = dismissACRef.current.signal;
            requestAnimationFrame(() => {
                if (sig.aborted) return;
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') dismiss();
                }, { signal: sig });
            });
        };

        const onBoxCleared = () => {
            if (clearingBoxRef.current) return;
            dismissMenuOnly();
        };

        const onSelectionChanged = (detail) => {
            setMenu((current) => {
                if (!current) return current;
                const layerId = menuLayerIdRef.current;
                if (layerId && detail?.layerId && detail.layerId !== layerId) return current;
                const nextCount = layerId
                    ? (mapService.getSelectionCount?.(layerId) ?? detail?.count ?? current.count)
                    : (detail?.totalCount ?? current.count);
                if (nextCount === current.count) return current;
                return { ...current, count: nextCount };
            });
        };

        bus.on('selection:boxComplete', onBoxComplete);
        bus.on('selection:boxCleared', onBoxCleared);
        bus.on('selection:changed', onSelectionChanged);
        return () => {
            bus.off('selection:boxComplete', onBoxComplete);
            bus.off('selection:boxCleared', onBoxCleared);
            bus.off('selection:changed', onSelectionChanged);
            dismissMenuOnly();
        };
    }, [buildItems, dismiss, dismissMenuOnly]);

    useLayoutEffect(() => {
        if (!menu || placedRef.current) return;
        const el = menuRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const pos = placeMenuOutsideSelectionBox({
            box: menu.screenBbox,
            menuWidth: rect.width || 220,
            menuHeight: rect.height || 280,
            cursorX: menu.cursorX,
            cursorY: menu.cursorY
        });
        placedRef.current = true;
        setMenu((current) => (current ? { ...current, x: pos.x, y: pos.y } : current));
    }, [menu]);

    if (!menu) return null;

    const title = menu.layerName || 'Selection';

    return createPortal(
        <div
            ref={menuRef}
            className="map-context-menu selection-actions-menu"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
            aria-label="Selection actions"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="selection-actions-menu__header">
                <div className="selection-actions-menu__title">{title}</div>
                {menu.count != null ? (
                    <span className="selection-actions-menu__count">{menu.count} selected</span>
                ) : null}
                <button
                    type="button"
                    className="selection-actions-menu__close"
                    title="Close and clear selection box"
                    aria-label="Close and clear selection box"
                    onClick={(e) => {
                        e.stopPropagation();
                        dismiss();
                    }}
                >
                    ✕
                </button>
            </div>
            <div className="selection-actions-menu__body">
                {menu.items.map((item, index) => (
                    <MenuItem key={`${item.label ?? 'sep'}-${index}`} item={item} index={index} onItemClick={onItemClick} />
                ))}
            </div>
        </div>,
        document.body
    );
}
