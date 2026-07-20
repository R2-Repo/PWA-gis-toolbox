/**
 * Temporary repeated ping sessions (frontend scheduler).
 * Uses PingService for each tick; stores results via callbacks.
 */

/** @type {Map<string, { timer: ReturnType<typeof setInterval>|null, stopped: boolean }>} */
const sessions = new Map();

/**
 * @param {number|string} interval
 * @returns {number|null} ms, or null for continuous (fast loop with delay)
 */
export function intervalToMs(interval) {
    if (interval === 'continuous' || interval === 0) return 5000;
    const n = Number(interval);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 60 * 1000);
}

/**
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string[]} opts.targets IPs
 * @param {number|string} opts.interval minutes or 'continuous'
 * @param {(targets: string[]) => Promise<Array<{ ip: string, status: string, rttMs?: number|null, error?: string }>>} opts.pingFn
 * @param {(result: object) => void} [opts.onResult]
 * @param {() => void} [opts.onStop]
 */
export function startPingSession(opts) {
    const { sessionId, targets, interval, pingFn, onResult, onStop } = opts;
    stopPingSession(sessionId);

    const ms = intervalToMs(interval);
    if (ms == null) throw new Error('Invalid ping interval');

    const state = { timer: null, stopped: false };
    sessions.set(sessionId, state);

    const tick = async () => {
        if (state.stopped) return;
        try {
            const results = await pingFn(targets);
            const at = new Date().toISOString();
            for (const r of results || []) {
                onResult?.({
                    sessionId,
                    timestamp: at,
                    ip: r.ip,
                    status: r.status,
                    rttMs: r.rttMs ?? null,
                    error: r.error || null,
                    reachable: r.status === 'reachable'
                });
            }
        } catch (err) {
            onResult?.({
                sessionId,
                timestamp: new Date().toISOString(),
                ip: targets[0] || '',
                status: 'unreachable',
                error: err?.message || String(err),
                reachable: false
            });
        }
    };

    void tick();
    state.timer = setInterval(() => void tick(), ms);

    return {
        sessionId,
        stop: () => {
            stopPingSession(sessionId);
            onStop?.();
        }
    };
}

/**
 * @param {string} sessionId
 */
export function stopPingSession(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.stopped = true;
    if (state.timer) clearInterval(state.timer);
    sessions.delete(sessionId);
}

export function stopAllPingSessions() {
    for (const id of [...sessions.keys()]) stopPingSession(id);
}
