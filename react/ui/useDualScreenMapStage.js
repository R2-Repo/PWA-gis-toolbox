import { useLayoutEffect, useRef, useState } from 'react';
import dualScreenCoordinator from '../../js/dual-screen/coordinator.js';
import { getWidgetModalAnchorRect } from '../../js/ui/widget-modal-placement.js';

function sameBox(prev, next) {
    if (!prev || !next) return false;
    return Math.abs(prev.left - next.left) < 0.5
        && Math.abs(prev.top - next.top) < 0.5
        && Math.abs(prev.width - next.width) < 0.5
        && Math.abs(prev.height - next.height) < 0.5;
}

/**
 * Viewport box of the primary map column while Dual Screen is on.
 * Dialogs that would cover the side panels open inside this box.
 * @param {boolean} [enabled]
 * @returns {{ active: boolean, box: { left: number, top: number, width: number, height: number } | null }}
 */
export function useDualScreenMapStage(enabled = true) {
    const [active, setActive] = useState(() => enabled && !!dualScreenCoordinator.isActive);
    const [box, setBox] = useState(null);
    const boxRef = useRef(null);

    useLayoutEffect(() => {
        if (!enabled) {
            setActive(false);
            return undefined;
        }
        setActive(!!dualScreenCoordinator.isActive);
        return dualScreenCoordinator.onStateChange(setActive);
    }, [enabled]);

    useLayoutEffect(() => {
        if (!active) {
            if (boxRef.current) {
                boxRef.current = null;
                setBox(null);
            }
            return undefined;
        }

        const read = () => {
            const rect = getWidgetModalAnchorRect(true);
            if (!rect || rect.width < 8 || rect.height < 8) {
                if (!boxRef.current) return;
                boxRef.current = null;
                setBox(null);
                return;
            }
            const next = {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height
            };
            if (sameBox(boxRef.current, next)) return;
            boxRef.current = next;
            setBox(next);
        };

        read();
        window.addEventListener('resize', read);
        const center = document.querySelector('.panel-center');
        const observer = center && typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(read)
            : null;
        observer?.observe(center);

        return () => {
            window.removeEventListener('resize', read);
            observer?.disconnect();
        };
    }, [active]);

    return { active, box };
}

/**
 * @param {{ left: number, top: number, width: number, height: number } | null} box
 * @returns {import('react').CSSProperties | undefined}
 */
export function mapStageStyle(box) {
    if (!box) return undefined;
    return {
        position: 'fixed',
        inset: 'auto',
        left: `${Math.round(box.left)}px`,
        top: `${Math.round(box.top)}px`,
        width: `${Math.round(box.width)}px`,
        height: `${Math.round(box.height)}px`
    };
}
