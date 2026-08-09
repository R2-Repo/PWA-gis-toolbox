/**
 * gis-tiles:// MapLibre protocol — routes tile requests to the tile worker,
 * which builds MVT bytes from the local IndexedDB workspace on demand.
 */
import logger from '../../core/logger.js';
import { GIS_TILE_PROTOCOL } from './tile-constants.js';

const URL_RE = /^gis-tiles:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.pbf$/;
const EMPTY_TILE = new ArrayBuffer(0);

let worker = null;
let registered = false;
let protocolSupported = null;
let nextReqId = 1;
/** @type {Map<number, { resolve: Function, reject: Function }>} */
const pending = new Map();

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
        if (error) job.reject(new Error(error));
        else job.resolve(buffer || null);
    };
    worker.onerror = (event) => {
        logger.warn('GisTiles', 'Tile worker error', { message: event?.message });
        for (const [, job] of pending) {
            job.reject(new Error(event?.message || 'Tile worker crashed'));
        }
        pending.clear();
        try {
            worker.terminate();
        } catch { /* ignore */ }
        worker = null;
    };
    return worker;
}

function _requestTile(layerId, z, x, y) {
    const w = _ensureWorker();
    const reqId = nextReqId++;
    return new Promise((resolve, reject) => {
        pending.set(reqId, { resolve, reject });
        w.postMessage({ type: 'tile', reqId, layerId, z, x, y });
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
    try {
        worker?.terminate();
    } catch { /* ignore */ }
    worker = null;
}

export default {
    ensureGisTileProtocol,
    gisTileUrlTemplate,
    invalidateGisTiles,
    disposeGisTileWorker
};
