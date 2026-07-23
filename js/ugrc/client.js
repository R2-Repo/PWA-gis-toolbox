import { UGRC_API_BASE, UGRC_REVERSE_MILEPOST_DEFAULTS } from './config.js';

/**
 * @param {{ lng: number, lat: number, apiKey: string, buffer?: number, spatialReference?: number, includeRampSystem?: boolean, suggest?: number }} opts
 * @returns {string}
 */
export function buildReverseMilepostUrl(opts) {
    const lng = Number(opts.lng);
    const lat = Number(opts.lat);
    const apiKey = String(opts.apiKey || '').trim();
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        throw new Error('Valid longitude and latitude are required');
    }
    if (!apiKey) {
        throw new Error('UGRC API key is required');
    }

    const buffer = opts.buffer ?? UGRC_REVERSE_MILEPOST_DEFAULTS.buffer;
    const spatialReference = opts.spatialReference ?? UGRC_REVERSE_MILEPOST_DEFAULTS.spatialReference;
    const params = new URLSearchParams({
        buffer: String(buffer),
        spatialReference: String(spatialReference),
        apiKey
    });
    if (opts.includeRampSystem != null) {
        params.set('includeRampSystem', opts.includeRampSystem ? 'true' : 'false');
    }
    if (opts.suggest != null) {
        params.set('suggest', String(opts.suggest));
    }

    return `${UGRC_API_BASE}/reverse/milepost/${encodeURIComponent(String(lng))}/${encodeURIComponent(String(lat))}?${params}`;
}

/**
 * @param {unknown} payload
 * @returns {{ route: string, milepost: number, offsetMeters: number|null, side: string|null, dominant: boolean|null, candidates: object[] }|null}
 */
export function normalizeReverseMilepostResult(payload) {
    const result = payload && typeof payload === 'object' ? payload.result : null;
    if (!result || typeof result !== 'object') return null;

    const route = result.route != null ? String(result.route).trim() : '';
    const milepost = Number(result.milepost);
    if (!route || !Number.isFinite(milepost)) return null;

    const offsetMeters = Number.isFinite(Number(result.offsetMeters))
        ? Number(result.offsetMeters)
        : null;

    return {
        route,
        milepost,
        offsetMeters,
        side: result.side != null ? String(result.side) : null,
        dominant: typeof result.dominant === 'boolean' ? result.dominant : null,
        candidates: Array.isArray(result.candidates) ? result.candidates : []
    };
}

/**
 * Compact clipboard / toast label, e.g. "Route 15P · MP 299.312"
 * @param {{ route: string, milepost: number }} result
 * @returns {string}
 */
export function formatRouteMilepostLabel(result) {
    if (!result?.route || !Number.isFinite(Number(result.milepost))) return '';
    return `Route ${result.route} · MP ${Number(result.milepost)}`;
}

/**
 * Longer success message including offset when available.
 * @param {{ route: string, milepost: number, offsetMeters?: number|null }} result
 * @returns {string}
 */
export function formatRouteMilepostMessage(result) {
    const base = formatRouteMilepostLabel(result);
    if (!base) return '';
    if (result.offsetMeters == null || !Number.isFinite(Number(result.offsetMeters))) {
        return base;
    }
    const offset = Number(result.offsetMeters);
    const offsetText = offset < 100 ? offset.toFixed(1) : String(Math.round(offset));
    return `${base} (${offsetText} m from route)`;
}

/**
 * @param {Response} response
 * @param {unknown} body
 * @returns {Error}
 */
function buildUgrcHttpError(response, body) {
    const message =
        (body && typeof body === 'object' && (body.message || body.error))
            ? String(body.message || body.error)
            : `UGRC request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.code = body && typeof body === 'object' ? body.status || body.code : response.status;
    err.body = body;
    return err;
}

/**
 * Reverse route/milepost geocode via UGRC.
 * @param {{ lat: number, lng: number, apiKey: string, buffer?: number, spatialReference?: number, includeRampSystem?: boolean, suggest?: number, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<{ ok: true, result: object } | { ok: false, reason: 'no_match'|'http'|'network'|'invalid', error?: Error, status?: number }>}
 */
export async function reverseMilepost(opts) {
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        return { ok: false, reason: 'network', error: new Error('fetch is not available') };
    }

    let url;
    try {
        url = buildReverseMilepostUrl(opts);
    } catch (error) {
        return { ok: false, reason: 'invalid', error };
    }

    let response;
    try {
        response = await fetchImpl(url, {
            method: 'GET',
            headers: { Accept: 'application/json' }
        });
    } catch (error) {
        return { ok: false, reason: 'network', error };
    }

    let body = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }

    if (!response.ok) {
        // UGRC often returns 404 / 400 when nothing is in buffer — treat as no match when clear.
        const msg = String(body?.message || body?.error || '').toLowerCase();
        if (response.status === 404 || msg.includes('no') || msg.includes('not found') || msg.includes('unable')) {
            return { ok: false, reason: 'no_match', status: response.status };
        }
        return { ok: false, reason: 'http', status: response.status, error: buildUgrcHttpError(response, body) };
    }

    const result = normalizeReverseMilepostResult(body);
    if (!result) {
        return { ok: false, reason: 'no_match', status: response.status };
    }
    return { ok: true, result };
}
