/**
 * Shared helpers for ephemeral map interactions (sketch rectangles, polygons, picks).
 */

/** Matches box-select epsilon in map-manager `_setupRectangleSelect` (screen px, bbox diagonal). */
export const RECT_DRAG_MIN_DIAGONAL_PX = 10;

/** Screen-px move threshold: below this, Shift+press is a corner click (two-click box), not a drag. */
export const BOX_SELECT_CLICK_MAX_MOVE_PX = 6;

/**
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @param {number} [maxPx]
 * @returns {boolean} true when movement stays within click tolerance
 */
export function isBoxSelectClickMove(a, b, maxPx = BOX_SELECT_CLICK_MAX_MOVE_PX) {
    if (!a || !b) return false;
    return Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0)) < maxPx;
}

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

/**
 * True when a feature's real coordinates intersect [west, south, east, north].
 * Uses GPS geometry only — not rendered marker size / screen pixels.
 * @param {object} feature GeoJSON Feature
 * @param {[number, number, number, number]} bbox
 * @param {typeof import('@turf/turf') | null} [turfLib]
 * @returns {boolean}
 */
export function featureIntersectsGeographicBbox(feature, bbox, turfLib = typeof globalThis !== 'undefined' ? globalThis.turf : null) {
    if (!feature?.geometry || !Array.isArray(bbox) || bbox.length < 4) return false;
    const [west, south, east, north] = bbox;
    const type = feature.geometry.type;

    const pointInBbox = (coord) => {
        const lng = coord?.[0];
        const lat = coord?.[1];
        return Number.isFinite(lng) && Number.isFinite(lat)
            && lng >= west && lng <= east
            && lat >= south && lat <= north;
    };

    if (type === 'Point') return pointInBbox(feature.geometry.coordinates);
    if (type === 'MultiPoint') {
        return (feature.geometry.coordinates || []).some(pointInBbox);
    }

    if (!turfLib) return false;
    try {
        const bboxPoly = turfLib.bboxPolygon([west, south, east, north]);
        return !!turfLib.booleanIntersects(feature, bboxPoly);
    } catch {
        try {
            const c = turfLib.centroid(feature);
            return pointInBbox(c?.geometry?.coordinates);
        } catch {
            return false;
        }
    }
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
 * Resize only when the MapLibre canvas size does not match its container.
 * Avoids a no-op resize() flash that looks like a viewport reset.
 * @param {import('maplibre-gl').Map | null | undefined} map
 * @returns {boolean} true when resize() ran
 */
export function resizeMapIfNeeded(map) {
    if (!map || typeof map.resize !== 'function') return false;
    try {
        const container = typeof map.getContainer === 'function' ? map.getContainer() : null;
        const canvas = typeof map.getCanvas === 'function' ? map.getCanvas() : null;
        if (container && canvas) {
            const width = container.clientWidth;
            const height = container.clientHeight;
            if (
                width > 0
                && height > 0
                && canvas.clientWidth === width
                && canvas.clientHeight === height
            ) {
                return false;
            }
        }
        map.resize();
        return true;
    } catch {
        return false;
    }
}

/**
 * True when the current camera already matches cameraForBounds for the target.
 * @param {import('maplibre-gl').Map | null | undefined} map
 * @param {[[number, number], [number, number]]} bounds
 * @param {{ padding?: number | object, maxZoom?: number }} [options]
 * @returns {boolean}
 */
export function isCameraAlreadyFittingBounds(map, bounds, options = {}) {
    if (!map || !bounds || typeof map.cameraForBounds !== 'function') return false;
    try {
        const cam = map.cameraForBounds(bounds, {
            padding: options.padding ?? 30,
            maxZoom: options.maxZoom ?? 16
        });
        if (!cam) return false;

        const zoom = typeof map.getZoom === 'function' ? map.getZoom() : null;
        const center = typeof map.getCenter === 'function' ? map.getCenter() : null;
        if (zoom == null || !center) return false;

        const targetZoom = cam.zoom;
        const target = cam.center;
        const targetLng = typeof target?.lng === 'number' ? target.lng : target?.[0];
        const targetLat = typeof target?.lat === 'number' ? target.lat : target?.[1];
        if (!Number.isFinite(targetZoom) || !Number.isFinite(targetLng) || !Number.isFinite(targetLat)) {
            return false;
        }

        const zoomSlop = 0.08;
        const lngSlop = 1e-4;
        const latSlop = 1e-4;
        return Math.abs(zoom - targetZoom) <= zoomSlop
            && Math.abs(center.lng - targetLng) <= lngSlop
            && Math.abs(center.lat - targetLat) <= latSlop;
    } catch {
        return false;
    }
}

/**
 * True when jumpTo/center+zoom would be a no-op for the current camera.
 * @param {import('maplibre-gl').Map | null | undefined} map
 * @param {{ center?: [number, number]|{lng:number,lat:number}, zoom?: number, pitch?: number, bearing?: number }} target
 */
export function isCameraAlreadyAt(map, target = {}) {
    if (!map || typeof map.getCenter !== 'function' || typeof map.getZoom !== 'function') {
        return false;
    }
    try {
        const center = map.getCenter();
        const zoom = map.getZoom();
        const pitch = typeof map.getPitch === 'function' ? map.getPitch() : 0;
        const bearing = typeof map.getBearing === 'function' ? map.getBearing() : 0;

        let targetLng;
        let targetLat;
        if (Array.isArray(target.center)) {
            targetLng = target.center[0];
            targetLat = target.center[1];
        } else if (target.center && typeof target.center === 'object') {
            targetLng = target.center.lng;
            targetLat = target.center.lat;
        } else {
            return false;
        }

        if (!Number.isFinite(targetLng) || !Number.isFinite(targetLat) || !Number.isFinite(target.zoom)) {
            return false;
        }

        const targetPitch = target.pitch ?? 0;
        const targetBearing = target.bearing ?? 0;
        return Math.abs(zoom - target.zoom) <= 0.05
            && Math.abs(center.lng - targetLng) <= 1e-5
            && Math.abs(center.lat - targetLat) <= 1e-5
            && Math.abs(pitch - targetPitch) <= 0.5
            && Math.abs(((bearing - targetBearing + 540) % 360) - 180) <= 0.5;
    } catch {
        return false;
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

/**
 * Client-pixel screen rect for a geographic bbox on the map.
 * @param {import('maplibre-gl').Map} map
 * @param {[number, number, number, number]} bbox [west, south, east, north]
 * @returns {{ left: number, top: number, right: number, bottom: number } | null}
 */
export function geographicBboxToClientRect(map, bbox) {
    if (!map || !Array.isArray(bbox) || bbox.length < 4) return null;
    const [west, south, east, north] = bbox;
    try {
        const container = map.getContainer?.();
        if (!container) return null;
        const origin = container.getBoundingClientRect();
        const p1 = map.project([west, south]);
        const p2 = map.project([east, north]);
        return {
            left: origin.left + Math.min(p1.x, p2.x),
            top: origin.top + Math.min(p1.y, p2.y),
            right: origin.left + Math.max(p1.x, p2.x),
            bottom: origin.top + Math.max(p1.y, p2.y)
        };
    } catch {
        return null;
    }
}

/**
 * Place a floating menu outside a selection rect (avoids covering selected features).
 * Prefers right → left → below → above of the box; falls back to cursor + clamp.
 * @param {{
 *   box?: { left: number, top: number, right: number, bottom: number } | null,
 *   menuWidth: number,
 *   menuHeight: number,
 *   cursorX?: number,
 *   cursorY?: number,
 *   gap?: number,
 *   pad?: number,
 *   viewportWidth?: number,
 *   viewportHeight?: number
 * }} opts
 * @returns {{ x: number, y: number }}
 */
export function placeMenuOutsideSelectionBox(opts) {
    const {
        box,
        menuWidth,
        menuHeight,
        cursorX = 0,
        cursorY = 0,
        gap = 14,
        pad = 8,
        viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024,
        viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768
    } = opts || {};

    const clamp = (x, y) => ({
        x: Math.max(pad, Math.min(x, viewportWidth - menuWidth - pad)),
        y: Math.max(pad, Math.min(y, viewportHeight - menuHeight - pad))
    });

    if (!box) {
        return clamp(cursorX + gap, cursorY + gap);
    }

    const midY = (box.top + box.bottom) / 2;
    const midX = (box.left + box.right) / 2;
    const preferY = Number.isFinite(cursorY) ? cursorY - menuHeight / 2 : midY - menuHeight / 2;
    const preferX = Number.isFinite(cursorX) ? cursorX - menuWidth / 2 : midX - menuWidth / 2;

    const candidates = [
        { x: box.right + gap, y: preferY },
        { x: box.left - gap - menuWidth, y: preferY },
        { x: preferX, y: box.bottom + gap },
        { x: preferX, y: box.top - gap - menuHeight },
        { x: cursorX + gap, y: cursorY + gap }
    ];

    const overlapsBox = (pos) => {
        const r = pos.x + menuWidth;
        const b = pos.y + menuHeight;
        return !(r <= box.left - gap / 2
            || pos.x >= box.right + gap / 2
            || b <= box.top - gap / 2
            || pos.y >= box.bottom + gap / 2);
    };

    let fallback = null;
    for (const raw of candidates) {
        const pos = clamp(raw.x, raw.y);
        if (!overlapsBox(pos)) return pos;
        if (!fallback) fallback = pos;
    }
    return fallback || clamp(cursorX + gap, cursorY + gap);
}

/** Re-enable core map gestures if something left them disabled. */
export function ensureMapInteractionHandlers(map) {
    if (!map) return;
    // Omit boxZoom — intentionally disabled (conflicts with Shift+drag box-select)
    const names = ['dragPan', 'scrollZoom', 'doubleClickZoom', 'touchZoomRotate'];
    for (const name of names) {
        const handler = map[name];
        if (handler?.enable && handler.isEnabled && !handler.isEnabled()) {
            handler.enable();
        }
    }
}
