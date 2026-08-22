export const WIDGET_MODAL_MARGIN = 8;
export const WIDGET_PANEL_DOCK_MARGIN = 8;
export const WIDGET_MODAL_HEADER_HEIGHT = 34;
export const WIDGET_PANEL_DOCK_SELECTOR = '#widget-panel-dock';
export const WIDGET_PANEL_DOCK_MIN_WIDTH = 180;
export const WIDGET_PANEL_DOCK_GAP = 8;
export const WIDGET_PANEL_DOCK_PAD = 8;
export const WIDGET_PANEL_EXPANDED_RATIO = 0.75;
export const WIDGET_PANEL_HALF_RATIO = 0.45;

/**
 * @param {boolean} dualScreenActive
 * @param {Document} [doc]
 * @returns {DOMRect | null}
 */
export function getWidgetModalAnchorRect(dualScreenActive, doc = document) {
    if (!dualScreenActive) return null;
    const center = doc.querySelector('.panel-center');
    if (!center) return null;
    return center.getBoundingClientRect();
}

/**
 * @param {Document} [doc]
 * @returns {DOMRect | null}
 */
export function getRightPanelDockRect(doc = document) {
    const panel = doc.querySelector('.panel-right');
    if (!panel || panel.classList.contains('collapsed')) return null;

    const body = doc.querySelector('.panel-right-body') || panel;
    const rect = body.getBoundingClientRect();
    if (rect.width < WIDGET_PANEL_DOCK_MIN_WIDTH || rect.height < 120) return null;
    return rect;
}

/**
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function isRightPanelDockAvailable(doc = document) {
    return getRightPanelDockRect(doc) != null;
}

/**
 * @param {object} params
 * @param {boolean} params.dualScreenActive
 * @param {number} params.viewportWidth
 * @param {number} params.viewportHeight
 * @param {number} params.modalWidth
 * @param {number} params.modalHeight
 * @param {DOMRect | null} [params.anchorRect]
 * @param {DOMRect | null} [params.rightPanelRect]
 * @param {number} [params.margin]
 * @returns {{ left: number, top: number }}
 */
export function computeWidgetModalPlacement({
    dualScreenActive,
    viewportWidth,
    viewportHeight,
    modalWidth,
    modalHeight,
    anchorRect = null,
    rightPanelRect = null,
    margin = WIDGET_MODAL_MARGIN
}) {
    if (dualScreenActive && anchorRect) {
        return {
            left: anchorRect.left + (anchorRect.width - modalWidth) / 2,
            top: anchorRect.top + (anchorRect.height - modalHeight) / 2
        };
    }

    if (rightPanelRect) {
        return {
            left: rightPanelRect.right - modalWidth - WIDGET_PANEL_DOCK_MARGIN,
            top: rightPanelRect.bottom - modalHeight - WIDGET_PANEL_DOCK_MARGIN
        };
    }

    return {
        left: viewportWidth - modalWidth - margin,
        top: viewportHeight - modalHeight - margin
    };
}

/**
 * @param {object} params
 * @param {number} params.left
 * @param {number} params.top
 * @param {number} params.modalWidth
 * @param {number} params.modalHeight
 * @param {number} params.viewportWidth
 * @param {number} params.viewportHeight
 * @param {number} [params.margin]
 * @param {number} [params.headerHeight]
 * @returns {{ left: number, top: number }}
 */
export function clampWidgetModalPosition({
    left,
    top,
    modalWidth,
    modalHeight,
    viewportWidth,
    viewportHeight,
    margin = WIDGET_MODAL_MARGIN,
    headerHeight = WIDGET_MODAL_HEADER_HEIGHT
}) {
    const minTop = headerHeight + margin;
    const maxLeft = Math.max(margin, viewportWidth - modalWidth - margin);
    const maxTop = Math.max(minTop, viewportHeight - modalHeight - margin);

    return {
        left: Math.min(Math.max(margin, left), maxLeft),
        top: Math.min(Math.max(minTop, top), maxTop)
    };
}

/**
 * @param {Document} [doc]
 * @returns {number}
 */
export function getRightPanelBodyHeight(doc = document) {
    const body = doc.querySelector('.panel-right-body');
    if (!body) return 0;
    return body.getBoundingClientRect().height;
}

/**
 * @param {number} panelHeight
 * @param {{ fillPanel?: boolean }} [options]
 * @returns {{ expandedMax: number, halfMax: number }}
 */
export function computeWidgetDockHeights(panelHeight, options = {}) {
    const safeHeight = Math.max(0, Number(panelHeight) || 0);
    const halfMax = Math.floor(safeHeight * WIDGET_PANEL_HALF_RATIO);
    if (options.fillPanel) {
        return {
            expandedMax: Math.max(0, safeHeight - WIDGET_PANEL_DOCK_PAD * 2),
            halfMax
        };
    }
    return {
        expandedMax: Math.floor(safeHeight * WIDGET_PANEL_EXPANDED_RATIO),
        halfMax
    };
}

/**
 * @param {Document} [doc]
 */
export function refreshWidgetPanelDockReserve(doc = document) {
    const panel = doc.querySelector('.panel-right');
    const dock = doc.querySelector(WIDGET_PANEL_DOCK_SELECTOR);
    if (!panel || !dock) {
        syncWidgetPanelDockReserve(panel, 0);
        return;
    }

    const modals = dock.querySelectorAll('.modal--panel-dock');
    if (!modals.length) {
        syncWidgetPanelDockReserve(panel, 0);
        return;
    }

    let total = WIDGET_PANEL_DOCK_MARGIN * 2;
    modals.forEach((modalEl, index) => {
        total += modalEl.offsetHeight;
        if (index > 0) total += WIDGET_PANEL_DOCK_GAP;
    });

    syncWidgetPanelDockReserve(panel, total);
}

/**
 * @param {HTMLElement | null} panel
 * @param {number} reservePx
 */
export function syncWidgetPanelDockReserve(panel, reservePx) {
    if (!panel) return;
    if (reservePx > 0) {
        panel.classList.add('widget-panel-dock-active');
        panel.style.setProperty('--widget-dock-reserve', `${reservePx}px`);
        return;
    }
    panel.classList.remove('widget-panel-dock-active');
    panel.style.removeProperty('--widget-dock-reserve');
}
