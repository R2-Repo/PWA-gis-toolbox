/**
 * Shared helpers for ephemeral map interactions (sketch rectangles, polygons, picks).
 */

/** Matches box-select epsilon in map-manager `_setupRectangleSelect` (screen px, bbox diagonal). */
export const RECT_DRAG_MIN_DIAGONAL_PX = 10;

/**
 * MapLibre exposes disable/enable on doubleClickZoom; Mapbox had enabled()/isEnabled().
 * @param {import('maplibregl').Map | null | undefined} map
 */
export function isDoubleClickZoomEnabled(map) {
    const handler = map?.doubleClickZoom;
    if (!handler) return false;
    try {
        if (typeof handler.isEnabled === 'function') return handler.isEnabled();
        if (typeof handler.enabled === 'function') return handler.enabled();
    } catch (_) { /* noop */ }
    return true;
}

/** @param {import('maplibregl').Map | null | undefined} map */
export function disableDoubleClickZoom(map) {
    try {
        map?.doubleClickZoom?.disable?.();
    } catch (_) { /* noop */ }
}

/** @param {import('maplibregl').Map | null | undefined} map */
export function enableDoubleClickZoom(map) {
    try {
        map?.doubleClickZoom?.enable?.();
    } catch (_) { /* noop */ }
}

/**
 * @param {import('maplibregl').Map | null | undefined} map
 * @returns {{ restore: () => void }}
 */
export function suspendDoubleClickZoom(map) {
    const wasEnabled = isDoubleClickZoomEnabled(map);
    if (wasEnabled) disableDoubleClickZoom(map);
    return {
        restore() {
            if (wasEnabled) enableDoubleClickZoom(map);
        }
    };
}

/**
 * Prevent feature popups / global map click clears while a transient interaction consumes the gesture.
 * @param {maplibregl.MapMouseEvent | maplibregl.MapTouchEvent} e MapLibre event
 */
export function markMapInteractionHandled(e) {
    if (!e) return;
    try {
        e._drawHandled = true;
        if (e.originalEvent && typeof e.originalEvent === 'object') {
            e.originalEvent._drawHandled = true;
        }
    } catch (_) { /* noop */ }
}

/**
 * @param {number} west
 * @param {number} south
 * @param {number} east
 * @param {number} north
 * @param {(lngLatTuple: number[]) => { x: number, y: number }} project Same contract as MapLibre `map.project`.
 * @param {number} [minPx]
 * @returns {boolean}
 */
/**
 * Box-select drag requires Shift so normal click-drag can pan the map (trackpad + mouse).
 * @param {MouseEvent | TouchEvent | null | undefined} originalEvent
 * @returns {boolean}
 */
export function shouldStartBoxSelectDrag(originalEvent) {
    if (!originalEvent) return false;
    if (originalEvent.button !== undefined && originalEvent.button !== 0) return false;
    return !!originalEvent.shiftKey;
}

export function bboxDiagonalMeetsMinDragPx(west, south, east, north, project, minPx = RECT_DRAG_MIN_DIAGONAL_PX) {
    const p1 = project([west, south]);
    const p2 = project([east, north]);
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    return d >= minPx;
}

/** Cancel in-flight MapLibre camera animations (fitBounds, flyTo, easeTo). */
export function stopMapCamera(map) {
    try {
        map?.stop?.();
    } catch {
        // ignore
    }
}

/**
 * Wait until the map camera is idle, or until timeout.
 * @param {import('maplibre-gl').Map | null | undefined} map
 * @param {number} [timeoutMs]
 */
export function waitForMapIdle(map, timeoutMs = 8000) {
    return new Promise((resolve) => {
        if (!map) {
            resolve();
            return;
        }
        if (typeof map.isMoving === 'function' && !map.isMoving()) {
            resolve();
            return;
        }
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            map.off('moveend', finish);
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(finish, timeoutMs);
        map.once('moveend', finish);
    });
}

/** Re-enable core map gestures if something left them disabled. */
export function ensureMapInteractionHandlers(map) {
    if (!map) return;
    const names = ['dragPan', 'scrollZoom', 'boxZoom', 'doubleClickZoom', 'touchZoomRotate'];
    for (const name of names) {
        const handler = map[name];
        if (handler?.enable && handler.isEnabled && !handler.isEnabled()) {
            handler.enable();
        }
    }
}
