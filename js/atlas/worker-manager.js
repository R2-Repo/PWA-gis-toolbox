/**
 * Pop-out channel monitor workers (V2).
 */

/** @type {Map<string, { channelNumber: string, log: object[], sessionId: string|null }>} */
const workers = new Map();

/**
 * @param {string} channelNumber
 */
export function openChannelWorker(channelNumber) {
    const id = `worker-${channelNumber}`;
    if (!workers.has(id)) {
        workers.set(id, { channelNumber, log: [], sessionId: null });
    }
    return { id, ...workers.get(id) };
}

/**
 * @param {string} workerId
 */
export function closeChannelWorker(workerId) {
    workers.delete(workerId);
}

/**
 * @returns {object[]}
 */
export function listChannelWorkers() {
    return [...workers.entries()].map(([id, w]) => ({ id, ...w }));
}

/**
 * @param {string} workerId
 * @param {object} entry
 */
export function appendWorkerLog(workerId, entry) {
    const w = workers.get(workerId);
    if (!w) return;
    w.log.push({ ...entry, at: entry.at || new Date().toISOString() });
    if (w.log.length > 500) w.log.shift();
}

/**
 * @param {string} workerId
 * @param {string|null} sessionId
 */
export function setWorkerSessionId(workerId, sessionId) {
    const w = workers.get(workerId);
    if (w) w.sessionId = sessionId;
}
