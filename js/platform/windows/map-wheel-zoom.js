/**
 * Desktop-only MapLibre wheel / trackpad-pinch zoom for Tauri WebView2.
 *
 * Windows trackpad pinch arrives as wheel events with ctrlKey. With page-zoom
 * hotkeys disabled, WebView2 often drops those events before MapLibre sees them.
 * With hotkeys enabled, the shell would page-zoom unless we preventDefault and
 * apply map zoom instead. This module does that — only when Tauri is present.
 *
 * PWA / browser: do not import or call this module.
 */

import { isTauriAvailable, setWebviewZoom } from './tauri-bridge.js';

/** @type {WeakMap<object, () => void>} */
const installed = new WeakMap();

/**
 * Normalize WheelEvent deltaY to pixel-ish units.
 * @param {WheelEvent} e
 * @returns {number}
 */
export function normalizeWheelDeltaY(e) {
    const dy = Number(e?.deltaY) || 0;
    const mode = Number(e?.deltaMode) || 0;
    // 0 = DOM_DELTA_PIXEL, 1 = DOM_DELTA_LINE, 2 = DOM_DELTA_PAGE
    if (mode === 1) return dy * 16;
    if (mode === 2) return dy * 400;
    return dy;
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {WheelEvent} e
 * @returns {{ lng: number, lat: number } | null}
 */
function pointAround(map, e) {
    try {
        const canvas = map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        return map.unproject([x, y]);
    } catch {
        return null;
    }
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function isEventOverMap(map, target) {
    if (!target || typeof target !== 'object') return false;
    try {
        const root = map.getContainer?.() || map.getCanvasContainer?.() || map.getCanvas?.();
        if (!root) return false;
        if (typeof Node !== 'undefined' && target instanceof Node) {
            return root === target || root.contains(target);
        }
    } catch {
        /* noop */
    }
    return false;
}

/**
 * Apply a zoom step around the pointer (or map center).
 * @param {import('maplibre-gl').Map} map
 * @param {WheelEvent} e
 */
function applyMapZoom(map, e) {
    const dy = normalizeWheelDeltaY(e);
    if (!dy) return;

    // Pinch deltas are typically smaller; use a higher rate so gesture feels native.
    const isPinch = Boolean(e.ctrlKey || e.metaKey);
    const rate = isPinch ? 0.012 : 0.0025;
    const nextZoom = Math.min(
        map.getMaxZoom(),
        Math.max(map.getMinZoom(), map.getZoom() - dy * rate)
    );

    const around = pointAround(map, e);
    const opts = {
        zoom: nextZoom,
        duration: 0,
        essential: true
    };
    if (around) opts.around = around;

    try {
        map.easeTo(opts);
    } catch {
        try {
            map.setZoom(nextZoom);
        } catch {
            /* noop */
        }
    }
}

/**
 * Install WebView2-safe trackpad/mouse wheel zoom on a MapLibre map.
 * No-op when Tauri is not present or when already installed on this map.
 *
 * @param {import('maplibre-gl').Map | null | undefined} map
 * @returns {() => void} dispose
 */
export function installDesktopMapZoom(map) {
    if (!map || !isTauriAvailable()) return () => {};
    if (installed.has(map)) return installed.get(map);

    // Take ownership of wheel zoom so MapLibre and WebView2 do not fight.
    try {
        map.scrollZoom?.disable?.();
    } catch {
        /* noop */
    }

    // Keep page scale at 1×; pinch must zoom the map, not the shell chrome.
    void setWebviewZoom(1);

    /**
     * Capture-phase so we win over WebView2 page zoom for ctrl/meta + wheel.
     * @param {WheelEvent} e
     */
    const onWheelCapture = (e) => {
        const isPinch = Boolean(e.ctrlKey || e.metaKey);
        const overMap = isEventOverMap(map, e.target);

        if (isPinch) {
            // Always block page zoom from trackpad pinch / ctrl+wheel.
            e.preventDefault();
            void setWebviewZoom(1);
            if (overMap) applyMapZoom(map, e);
            return;
        }

        if (overMap) {
            e.preventDefault();
            applyMapZoom(map, e);
        }
    };

    document.addEventListener('wheel', onWheelCapture, { passive: false, capture: true });

    const dispose = () => {
        document.removeEventListener('wheel', onWheelCapture, { capture: true });
        try {
            map.scrollZoom?.enable?.();
        } catch {
            /* noop */
        }
        installed.delete(map);
    };

    installed.set(map, dispose);
    return dispose;
}
