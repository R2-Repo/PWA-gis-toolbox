/**
 * gis-tiles:// MapLibre protocol — routes tile requests to the tile worker,
 * which builds MVT bytes from the local IndexedDB workspace on demand.
 *
 * Tile builds are queued and prefer tiles whose centers are nearer the current
 * map focus (updated from the map camera). That does not change tile contents —
 * only which squares finish first when the worker is busy.
 */
import logger from '../../core/logger.js';
import { GIS_TILE_PROTOCOL } from './tile-constants.js';
import { tileToBBox } from './tile-math.js';

const URL_RE = /^gis-tiles:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.pbf$/;
const EMPTY_TILE = new ArrayBuffer(0);

/** How many tile builds may be in flight on the worker at once. */
const MAX_TILE_INFLIGHT = 2;

let worker = null;
let registered = false;
let protocolSupported = null;
let nextReqId = 1;
/** @type {Map<number, { resolve: Function, reject: Function }>} */
const pending = new Map();

/** @type {{ lon: number, lat: number }|null} */
let focusCenter = null;

/**
 * @typedef {{
 *   reqId: number,
 *   layerId: string,
 *   z: number,
 *   x: number,
 *   y: number,
 *   resolve: Function,
 *   reject: Function,
 *   score: number
 * }} TileQueueJob
 */

/** @type {TileQueueJob[]} */
const waitQueue = [];
let inflight = 0;

/**
 * Update the camera focus used to prioritize tile builds (lon/lat WGS84).
 * @param {number} lon
 * @param {number} lat
 */
export function setGisTileFocus(lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    focusCenter = { lon, lat };
}

/** @returns {{ lon: number, lat: number }|null} */
export function getGisTileFocus() {
    return focusCenter ? { ...focusCenter } : null;
}

/**
 * Distance score for a tile vs current focus (lower = closer = higher priority).
 * @param {number} z
 * @param {number} x
 * @param {number} y
 */
export function tileFocusScore(z, x, y, focus = focusCenter) {
    if (!focus || !Number.isFinite(focus.lon) || !Number.isFinite(focus.lat)) {
        return 0;
    }
    const [w, s, e, n] = tileToBBox(z, x, y);
    const cx = (w + e) / 2;
    const cy = (s + n) / 2;
    const dlon = cx - focus.lon;
    const dlat = cy - focus.lat;
    return dlon * dlon + dlat * dlat;
}

function _ensureWorker() {
    if (worker) return worker;
    worker = new Worker(
        new URL('../../workers/tile-render.worker.js', import.meta.url),
        { type: 'module' }
    );
    worker.onmessage = (event) => {
        const { type, reqId, buffer, error } = event.data || {};
        if (type !== 'tile') return;
        const job = pending.get(reqId);
        if (!job) return;
        pending.delete(reqId);
        inflight = Math.max(0, inflight - 1);
        if (error) job.reject(new Error(error));
        else job.resolve(buffer || null);
        _pumpQueue();
    };
    worker.onerror = (event) => {
        logger.warn('GisTiles', 'Tile worker error', { message: event?.message });
        for (const [, job] of pending) {
            job.reject(new Error(event?.message || 'Tile worker crashed'));
        }
        pending.clear();
        for (const job of waitQueue) {
            job.reject(new Error(event?.message || 'Tile worker crashed'));
        }
        waitQueue.length = 0;
        inflight = 0;
        try {
            worker.terminate();
        } catch { /* ignore */ }
        worker = null;
    };
    return worker;
}

function _pumpQueue() {
    if (!worker && waitQueue.length) _ensureWorker();
    while (inflight < MAX_TILE_INFLIGHT && waitQueue.length) {
        // Pick nearest to focus (stable: lower score, then earlier reqId).
        let bestIdx = 0;
        for (let i = 1; i < waitQueue.length; i++) {
            const a = waitQueue[i];
            const b = waitQueue[bestIdx];
            if (a.score < b.score || (a.score === b.score && a.reqId < b.reqId)) {
                bestIdx = i;
            }
        }
        const [job] = waitQueue.splice(bestIdx, 1);
        inflight += 1;
        pending.set(job.reqId, { resolve: job.resolve, reject: job.reject });
        worker.postMessage({
            type: 'tile',
            reqId: job.reqId,
            layerId: job.layerId,
            z: job.z,
            x: job.x,
            y: job.y
        });
    }
}

function _requestTile(layerId, z, x, y) {
    _ensureWorker();
    const reqId = nextReqId++;
    const score = tileFocusScore(z, x, y);
    return new Promise((resolve, reject) => {
        waitQueue.push({
            reqId,
            layerId,
            z,
            x,
            y,
            resolve,
            reject,
            score
        });
        _pumpQueue();
    });
}

/**
 * Register the protocol once. Returns false when unavailable (no worker /
 * no addProtocol) so callers can fall back to viewport rendering.
 * @returns {boolean}
 */
export function ensureGisTileProtocol() {
    if (registered) return true;
    if (protocolSupported === false) return false;

    const maplibre = globalThis.maplibregl;
    if (typeof Worker === 'undefined' || typeof maplibre?.addProtocol !== 'function') {
        protocolSupported = false;
        return false;
    }

    maplibre.addProtocol(GIS_TILE_PROTOCOL, async (params) => {
        const match = URL_RE.exec(params.url || '');
        if (!match) {
            throw new Error(`Bad gis-tiles URL: ${params.url}`);
        }
        const [, layerId, z, x, y] = match;
        const buffer = await _requestTile(layerId, Number(z), Number(x), Number(y));
        return { data: buffer || EMPTY_TILE };
    });

    registered = true;
    protocolSupported = true;
    return true;
}

/**
 * @param {string} wsLayerId workspace layer id
 * @returns {string} tile URL template for a MapLibre vector source
 */
export function gisTileUrlTemplate(wsLayerId) {
    return `${GIS_TILE_PROTOCOL}://${wsLayerId}/{z}/{x}/{y}.pbf`;
}

/**
 * Drop worker caches for a layer (or all layers) — call after layer data
 * changes or removal so stale tiles are not served.
 * @param {string|null} [layerId]
 */
export function invalidateGisTiles(layerId = null) {
    if (!worker) return;
    worker.postMessage({ type: 'invalidate', layerId });
}

/** Tear down the worker (tests / hard resets). */
export function disposeGisTileWorker() {
    for (const [, job] of pending) {
        job.reject(Object.assign(new Error('Tile worker disposed'), { cancelled: true }));
    }
    pending.clear();
    for (const job of waitQueue) {
        job.reject(Object.assign(new Error('Tile worker disposed'), { cancelled: true }));
    }
    waitQueue.length = 0;
    inflight = 0;
    try {
        worker?.terminate();
    } catch { /* ignore */ }
    worker = null;
}

export default {
    ensureGisTileProtocol,
    gisTileUrlTemplate,
    invalidateGisTiles,
    disposeGisTileWorker,
    setGisTileFocus,
    getGisTileFocus,
    tileFocusScore
};
