import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dismissModal } from '../../js/ui/modals.js';
import { mapStageStyle, useDualScreenMapStage } from './useDualScreenMapStage.js';
import {
    clampWidgetModalPosition,
    computeWidgetDockHeights,
    computeWidgetModalPlacement,
    getRightPanelBodyHeight,
    getRightPanelDockRect,
    getWidgetModalAnchorRect,
    isRightPanelDockAvailable,
    refreshWidgetPanelDockReserve,
    WIDGET_PANEL_DOCK_SELECTOR
} from '../../js/ui/widget-modal-placement.js';

const UNDOCK_DRAG_PX = 4;
const MODAL_HOST_SELECTOR = '#modal-host';

/**
 * Isolated body shell — parent re-renders (portal, position) must not wipe imperative
 * innerHTML or the React island mounted by openReactIsland onMount.
 */
const WidgetModalBody = memo(function WidgetModalBody({ modal, close }) {
    const bodyRef = useRef(null);
    const mountedRef = useRef(false);

    useEffect(() => {
        const body = bodyRef.current;
        const overlay = body?.closest('.modal-overlay');
        if (!body || !overlay || overlay._gisReactIslandMounted) return;

        body.innerHTML = modal.contentHtml || '';
        mountedRef.current = true;
        overlay._gisReactIslandMounted = true;
        overlay._close = close;
        overlay._resolve = () => {};
        modal.options?.onMount?.(overlay, close);
    }, [modal, close]);

    return <div className="modal-body" ref={bodyRef} />;
}, (prev, next) => prev.modal.id === next.modal.id);

function measureModal(modalEl) {
    const rect = modalEl.getBoundingClientRect();
    return {
        width: rect.width || modalEl.offsetWidth,
        height: rect.height || modalEl.offsetHeight
    };
}

function samePlacement(prev, next) {
    if (!prev || !next) return false;
    return Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.top - next.top) < 0.5;
}

function resolveFloatingPlacement(dualScreenActive, modalEl) {
    const { width, height } = measureModal(modalEl);
    const anchorRect = getWidgetModalAnchorRect(dualScreenActive);
    const rightPanelRect = dualScreenActive ? null : getRightPanelDockRect();
    const raw = computeWidgetModalPlacement({
        dualScreenActive,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        modalWidth: width,
        modalHeight: height,
        anchorRect,
        rightPanelRect
    });
    return clampWidgetModalPosition({
        ...raw,
        modalWidth: width,
        modalHeight: height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
    });
}

function queryPortalTargets() {
    if (typeof document === 'undefined') {
        return { dockEl: null, modalHostEl: null };
    }
    return {
        dockEl: document.querySelector(WIDGET_PANEL_DOCK_SELECTOR),
        modalHostEl: document.querySelector(MODAL_HOST_SELECTOR)
    };
}

export function DockedWidgetModal({ modal }) {
    const overlayRef = useRef(null);
    const modalRef = useRef(null);
    const userMovedRef = useRef(false);
    const dragRef = useRef(null);
    const [{ dockEl, modalHostEl }, setPortalTargets] = useState(queryPortalTargets);
    const [undocked, setUndocked] = useState(false);
    const { active: dualScreenActive, box: mapStageBox } = useDualScreenMapStage();
    const [panelDockAvailable, setPanelDockAvailable] = useState(
        () => isRightPanelDockAvailable()
    );
    const [position, setPosition] = useState(null);
    const [heightMode, setHeightMode] = useState('expanded');
    const fillPanel = modal.options?.fillPanel === true;
    const [dockHeights, setDockHeights] = useState(() => {
        const panelHeight = getRightPanelBodyHeight();
        return computeWidgetDockHeights(panelHeight, { fillPanel });
    });

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const width = isMobile ? '96vw' : (modal.options?.width || '600px');
    // Dual Screen hides the main map. Open panel dialogs in that column instead of over the side panels.
    const usePanelDock = !dualScreenActive && !undocked && panelDockAvailable && !!dockEl;
    const centerStage = dualScreenActive && !usePanelDock;
    const portalTarget = usePanelDock ? dockEl : modalHostEl;

    const close = useCallback((result = null) => dismissModal(modal.id, result), [modal.id]);

    const applyFloatingPlacement = useCallback((active) => {
        const modalEl = modalRef.current;
        if (!modalEl) return;
        const next = resolveFloatingPlacement(active, modalEl);
        setPosition((prev) => (samePlacement(prev, next) ? prev : next));
    }, []);

    const updateDockHeights = useCallback(() => {
        const panelHeight = getRightPanelBodyHeight();
        const next = computeWidgetDockHeights(panelHeight, { fillPanel });
        setDockHeights((prev) => (
            prev.expandedMax === next.expandedMax && prev.halfMax === next.halfMax ? prev : next
        ));
    }, [fillPanel]);

    const scheduleReserveRefresh = useCallback(() => {
        requestAnimationFrame(() => refreshWidgetPanelDockReserve());
    }, []);

    useEffect(() => {
        setPortalTargets((prev) => {
            const next = queryPortalTargets();
            if (prev.dockEl === next.dockEl && prev.modalHostEl === next.modalHostEl) return prev;
            return next;
        });
    }, []);

    useEffect(() => {
        if (usePanelDock || centerStage) return undefined;
        let cancelled = false;
        let frame = 0;
        let tries = 0;
        const tick = () => {
            if (cancelled) return;
            tries += 1;
            if (!modalRef.current && tries < 8) {
                frame = requestAnimationFrame(tick);
                return;
            }
            applyFloatingPlacement(dualScreenActive);
        };
        frame = requestAnimationFrame(tick);
        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
        };
    }, [usePanelDock, centerStage, dualScreenActive, applyFloatingPlacement, modal.id]);

    const wasDualScreenRef = useRef(dualScreenActive);
    useEffect(() => {
        if (wasDualScreenRef.current === dualScreenActive) return;
        wasDualScreenRef.current = dualScreenActive;
        if (dualScreenActive) {
            userMovedRef.current = false;
            setPosition(null);
            setUndocked(false);
            return;
        }
        if (!userMovedRef.current) {
            setUndocked(false);
            setPosition(null);
        }
    }, [dualScreenActive]);

    useEffect(() => {
        const refreshPanelDock = () => {
            const available = isRightPanelDockAvailable();
            setPanelDockAvailable((prev) => (prev === available ? prev : available));
            setPortalTargets((prev) => {
                const next = queryPortalTargets();
                if (prev.dockEl === next.dockEl && prev.modalHostEl === next.modalHostEl) return prev;
                return next;
            });
            updateDockHeights();
        };

        refreshPanelDock();
        window.addEventListener('resize', refreshPanelDock);

        const panel = document.querySelector('.panel-right');
        const observer = panel && typeof MutationObserver !== 'undefined'
            ? new MutationObserver(refreshPanelDock)
            : null;
        if (panel && observer) {
            observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
        }

        return () => {
            window.removeEventListener('resize', refreshPanelDock);
            observer?.disconnect();
        };
    }, [updateDockHeights]);

    useEffect(() => {
        if (usePanelDock) return undefined;
        refreshWidgetPanelDockReserve();
        return undefined;
    }, [usePanelDock]);

    useEffect(() => {
        if (!usePanelDock) return undefined;

        const modalEl = modalRef.current;
        if (!modalEl) return undefined;

        scheduleReserveRefresh();

        const observer = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(scheduleReserveRefresh)
            : null;
        observer?.observe(modalEl);

        return () => {
            observer?.disconnect();
            requestAnimationFrame(() => refreshWidgetPanelDockReserve());
        };
    }, [usePanelDock, modal.id, heightMode, dockHeights, scheduleReserveRefresh]);

    useEffect(() => {
        const modalEl = modalRef.current;
        if (!modalEl || typeof ResizeObserver === 'undefined' || usePanelDock) return undefined;

        const observer = new ResizeObserver(() => {
            if (dualScreenActive && !userMovedRef.current) return;
            if (!userMovedRef.current) {
                applyFloatingPlacement(dualScreenActive);
                return;
            }
            setPosition((prev) => {
                if (!prev) return prev;
                const { width: modalWidth, height: modalHeight } = measureModal(modalEl);
                return clampWidgetModalPosition({
                    left: prev.left,
                    top: prev.top,
                    modalWidth,
                    modalHeight,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight
                });
            });
        });

        observer.observe(modalEl);
        return () => observer.disconnect();
    }, [applyFloatingPlacement, dualScreenActive, usePanelDock]);

    useEffect(() => {
        const onResize = () => {
            if (usePanelDock || (dualScreenActive && !userMovedRef.current)) return;
            const modalEl = modalRef.current;
            if (!modalEl) return;
            setPosition((prev) => {
                const { width: modalWidth, height: modalHeight } = measureModal(modalEl);
                const next = prev || resolveFloatingPlacement(dualScreenActive, modalEl);
                return clampWidgetModalPosition({
                    left: next.left,
                    top: next.top,
                    modalWidth,
                    modalHeight,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight
                });
            });
        };

        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [dualScreenActive, usePanelDock]);

    useEffect(() => () => {
        requestAnimationFrame(() => refreshWidgetPanelDockReserve());
    }, []);

    const onHalfHeightClick = (event) => {
        event.stopPropagation();
        if (heightMode === 'minimized') {
            setHeightMode('expanded');
            return;
        }
        setHeightMode((prev) => (prev === 'half' ? 'expanded' : 'half'));
    };

    const onMinimizeClick = (event) => {
        event.stopPropagation();
        if (heightMode === 'minimized') {
            setHeightMode('expanded');
            return;
        }
        setHeightMode('minimized');
        requestAnimationFrame(() => refreshWidgetPanelDockReserve());
    };

    const onHeaderClick = (event) => {
        if (!usePanelDock || heightMode !== 'minimized') return;
        if (event.target.closest('.close-modal')) return;
        setHeightMode('expanded');
    };

    const onHeaderPointerDown = (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('.close-modal, button, a, input, select, textarea, label')) return;

        const modalEl = modalRef.current;
        if (!modalEl) return;

        event.preventDefault();

        const startRect = modalEl.getBoundingClientRect();
        dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            originLeft: usePanelDock ? startRect.left : (position?.left ?? startRect.left),
            originTop: usePanelDock ? startRect.top : (position?.top ?? startRect.top),
            fromPanelDock: usePanelDock,
            undocked: false
        };
        modalEl.setPointerCapture?.(event.pointerId);

        const onPointerMove = (moveEvent) => {
            const drag = dragRef.current;
            if (!drag) return;

            const deltaX = moveEvent.clientX - drag.startX;
            const deltaY = moveEvent.clientY - drag.startY;

            if (drag.fromPanelDock && !drag.undocked) {
                if (Math.hypot(deltaX, deltaY) < UNDOCK_DRAG_PX) return;
                drag.undocked = true;
                drag.fromPanelDock = false;
                userMovedRef.current = true;
                setUndocked(true);
                setPosition({
                    left: startRect.left,
                    top: startRect.top
                });
                drag.originLeft = startRect.left;
                drag.originTop = startRect.top;
            } else if (!drag.markedMoved) {
                drag.markedMoved = true;
                userMovedRef.current = true;
                setUndocked(true);
            }

            const { width: modalWidth, height: modalHeight } = measureModal(modalEl);
            const next = clampWidgetModalPosition({
                left: drag.originLeft + deltaX,
                top: drag.originTop + deltaY,
                modalWidth,
                modalHeight,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight
            });
            setPosition(next);
        };

        const onPointerUp = (upEvent) => {
            modalEl.releasePointerCapture?.(upEvent.pointerId);
            dragRef.current = null;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    };

    const panelDockStyle = usePanelDock
        ? {
            '--widget-panel-expanded-max': `${dockHeights.expandedMax}px`,
            '--widget-panel-half-max': `${dockHeights.halfMax}px`
        }
        : undefined;

    const centerLimits = centerStage
        ? {
            maxWidth: 'calc(100% - 16px)',
            maxHeight: mapStageBox
                ? `${Math.max(160, Math.round(mapStageBox.height) - 16)}px`
                : 'calc(100% - 16px)',
            minWidth: 0,
            ...(fillPanel && !position && mapStageBox
                ? { height: `${Math.max(160, Math.round(mapStageBox.height) - 16)}px` }
                : {})
        }
        : null;

    const floatingStyle = usePanelDock
        ? panelDockStyle
        : {
            width,
            ...centerLimits,
            ...(position
                ? {
                    position: 'fixed',
                    left: `${position.left}px`,
                    top: `${position.top}px`,
                    margin: 0
                }
                : centerStage
                    ? {}
                    : { visibility: 'hidden' })
        };

    const content = (
        <div
            ref={overlayRef}
            className={`modal-overlay ${usePanelDock ? 'modal-overlay--panel-dock' : 'modal-overlay--docked'}${centerStage ? ' modal-overlay--map-stage' : ''}`}
            style={centerStage ? mapStageStyle(mapStageBox) : undefined}
        >
            <div
                ref={modalRef}
                className={`modal modal--docked${usePanelDock ? ' modal--panel-dock' : ''}`}
                style={floatingStyle}
                data-height-mode={usePanelDock ? heightMode : undefined}
                data-panel-fill={usePanelDock && fillPanel ? 'true' : undefined}
            >
                <div
                    className={`modal-header modal-header--draggable${usePanelDock ? ' modal-header--panel-dock' : ''}`}
                    onPointerDown={onHeaderPointerDown}
                    onClick={onHeaderClick}
                    title={usePanelDock ? 'Drag to undock' : 'Drag to move'}
                >
                    <span className="modal-header__title">{modal.title}</span>
                    <div className="modal-header__actions">
                        {usePanelDock ? (
                            <>
                                <button
                                    type="button"
                                    className="btn-icon widget-dock-btn widget-dock-btn--minimize"
                                    aria-label="Minimize"
                                    title="Minimize"
                                    onClick={onMinimizeClick}
                                />
                                <button
                                    type="button"
                                    className="btn-icon widget-dock-btn widget-dock-btn--half"
                                    aria-label={heightMode === 'half' ? 'Expand height' : 'Half height'}
                                    title={heightMode === 'half' ? 'Expand height' : 'Half height'}
                                    onClick={onHalfHeightClick}
                                />
                            </>
                        ) : null}
                        <button
                            type="button"
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
                </div>
                <WidgetModalBody modal={modal} close={close} />
                {modal.options?.footer ? (
                    <div className="modal-footer modal-footer-slot" />
                ) : null}
            </div>
        </div>
    );

    if (!portalTarget) return null;
    return createPortal(content, portalTarget);
}
