/**
 * Stops a remote camera apply from bouncing moveend back as another viewport
 * message. MapLibre often fires moveend after jumpTo returns, so a flag that
 * is cleared in the same turn is already false when the broadcast runs.
 */

let depth = 0;
const timers = new Set();

export function isViewportEchoSuppressed() {
    return depth > 0;
}

/**
 * Hold viewport broadcasts until the next moveend, or until timeoutMs.
 * @param {object | null | undefined} map
 * @param {{ timeoutMs?: number }} [options]
 * @returns {() => void} release
 */
export function suppressViewportEcho(map, { timeoutMs = 1000 } = {}) {
    depth += 1;
    let released = false;
    let timer = null;
    const release = () => {
        if (released) return;
        released = true;
        depth = Math.max(0, depth - 1);
        try { map?.off?.('moveend', release); } catch { /* map already removed */ }
        if (timer != null) {
            clearTimeout(timer);
            timers.delete(timer);
        }
    };
    try {
        if (typeof map?.once === 'function') map.once('moveend', release);
        else if (typeof map?.on === 'function') map.on('moveend', release);
    } catch { /* ignore */ }
    timer = setTimeout(release, timeoutMs);
    if (typeof timer?.unref === 'function') timer.unref();
    timers.add(timer);
    return release;
}

/** Test helper. Production callers release on moveend or the timeout. */
export function resetViewportEchoSuppression() {
    depth = 0;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
}

function centerPair(camera) {
    const center = camera?.center;
    if (!center) return null;
    const lng = Array.isArray(center) ? Number(center[0]) : Number(center.lng);
    const lat = Array.isArray(center) ? Number(center[1]) : Number(center.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return [lng, lat];
}

/** True when two cameras would not move the map enough to broadcast again. */
export function camerasNearlyEqual(current, next) {
    const a = centerPair(current);
    const b = centerPair(next);
    if (!a || !b) return false;
    const zoomA = Number(current.zoom);
    const zoomB = Number(next.zoom);
    if (!Number.isFinite(zoomA) || !Number.isFinite(zoomB)) return false;
    return Math.abs(a[0] - b[0]) < 1e-5
        && Math.abs(a[1] - b[1]) < 1e-5
        && Math.abs(zoomA - zoomB) < 0.01
        && Math.abs((Number(current.bearing) || 0) - (Number(next.bearing) || 0)) < 0.05
        && Math.abs((Number(current.pitch) || 0) - (Number(next.pitch) || 0)) < 0.05;
}

/**
 * @param {{ echoSuppressed?: boolean, localSuppressed?: boolean, lastSent?: object | null, payload?: object | null }} input
 * @returns {{ send: boolean, lastSent: object | null }}
 */
export function nextViewportBroadcast({ echoSuppressed, localSuppressed, lastSent, payload }) {
    if (echoSuppressed || localSuppressed || !payload) {
        return { send: false, lastSent: lastSent || null };
    }
    if (lastSent && camerasNearlyEqual(lastSent, payload)) {
        return { send: false, lastSent };
    }
    return { send: true, lastSent: payload };
}
