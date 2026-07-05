import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dualScreenCoordinator from '../../js/dual-screen/coordinator.js';
import { dismissModal } from '../../js/ui/modals.js';
import {
    clampWidgetModalPosition,
    computeWidgetModalPlacement,
    getRightPanelDockRect,
    getWidgetModalAnchorRect,
    isRightPanelDockAvailable,
    syncWidgetPanelDockReserve,
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
    const [dualScreenActive, setDualScreenActive] = useState(
        () => dualScreenCoordinator.isActive
    );
    const [panelDockAvailable, setPanelDockAvailable] = useState(
        () => isRightPanelDockAvailable()
    );
    const [position, setPosition] = useState(null);

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const width = isMobile ? '96vw' : (modal.options?.width || '600px');
    const usePanelDock = !undocked && !dualScreenActive && panelDockAvailable && !!dockEl;
    const portalTarget = usePanelDock ? dockEl : modalHostEl;

    const close = useCallback((result = null) => dismissModal(modal.id, result), [modal.id]);

    const applyFloatingPlacement = useCallback((active) => {
        const modalEl = modalRef.current;
        if (!modalEl) return;
        setPosition(resolveFloatingPlacement(active, modalEl));
    }, []);

    useEffect(() => {
        setPortalTargets(queryPortalTargets());
    }, []);

    useEffect(() => {
        if (usePanelDock) return undefined;
        requestAnimationFrame(() => applyFloatingPlacement(dualScreenActive));
        return undefined;
    }, [usePanelDock, dualScreenActive, applyFloatingPlacement, modal.id]);

    useEffect(() => {
        const onDualScreenChange = (active) => {
            setDualScreenActive(active);
            if (!userMovedRef.current) {
                setUndocked(active);
            }
            if (active || userMovedRef.current || !isRightPanelDockAvailable()) {
                requestAnimationFrame(() => applyFloatingPlacement(active));
            }
        };
        return dualScreenCoordinator.onStateChange(onDualScreenChange);
    }, [applyFloatingPlacement]);

    useEffect(() => {
        const refreshPanelDock = () => {
            setPanelDockAvailable(isRightPanelDockAvailable());
            setPortalTargets(queryPortalTargets());
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
    }, []);

    useEffect(() => {
        const panel = document.querySelector('.panel-right');
        if (!usePanelDock) {
            syncWidgetPanelDockReserve(panel, 0);
            return undefined;
        }

        const modalEl = modalRef.current;
        if (!modalEl) return undefined;

        const updateReserve = () => {
            syncWidgetPanelDockReserve(panel, modalEl.offsetHeight + 12);
        };

        updateReserve();

        const observer = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(updateReserve)
            : null;
        observer?.observe(modalEl);

        return () => {
            observer?.disconnect();
            syncWidgetPanelDockReserve(panel, 0);
        };
    }, [usePanelDock, modal.id]);

    useEffect(() => {
        const modalEl = modalRef.current;
        if (!modalEl || typeof ResizeObserver === 'undefined' || usePanelDock) return undefined;

        const observer = new ResizeObserver(() => {
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
            if (usePanelDock) return;
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
        syncWidgetPanelDockReserve(document.querySelector('.panel-right'), 0);
    }, []);

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

    const floatingStyle = usePanelDock
        ? undefined
        : {
            width,
            ...(position
                ? {
                    position: 'fixed',
                    left: `${position.left}px`,
                    top: `${position.top}px`,
                    margin: 0
                }
                : { visibility: 'hidden' })
        };

    const content = (
        <div
            ref={overlayRef}
            className={`modal-overlay ${usePanelDock ? 'modal-overlay--panel-dock' : 'modal-overlay--docked'}`}
        >
            <div
                ref={modalRef}
                className={`modal modal--docked${usePanelDock ? ' modal--panel-dock' : ''}`}
                style={floatingStyle}
            >
                <div
                    className="modal-header modal-header--draggable"
                    onPointerDown={onHeaderPointerDown}
                    title={usePanelDock ? 'Drag to undock' : 'Drag to move'}
                >
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
