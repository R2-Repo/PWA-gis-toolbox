/**
 * Shared ArcGIS REST client — all ArcGIS HTTP in the app should go through here.
 */
import { AppError, ErrorCategory } from '../core/error-handler.js';
import { assemblePolygon, ringIsClockwise } from '../import/stream/shp-stream-parser.js';

export const DEFAULT_ARCGIS_TIMEOUT_MS = 15_000;
export const DEFAULT_ARCGIS_QUERY_TIMEOUT_MS = 60_000;
export const DEFAULT_ARCGIS_MAX_RETRIES = 3;
export const ARCGIS_BACKOFF_BASE_MS = 250;
export const ARCGIS_BACKOFF_MAX_MS = 8_000;
export const ARCGIS_BACKOFF_JITTER_MS = 100;

/** Server continue signal for paginated query responses (json or geojson). */
export function arcgisResponseExceededTransferLimit(data) {
    return data?.exceededTransferLimit === true || data?.properties?.exceededTransferLimit === true;
}

/** Close a ring when first and last vertices differ. */
export function closeRing(ring) {
    if (!ring?.length) return ring;
    const [x0, y0] = ring[0];
    const [x1, y1] = ring[ring.length - 1];
    if (x0 === x1 && y0 === y1) return ring;
    return [...ring, [x0, y0]];
}

function ringToRfc7946(ring, isExterior) {
    const closed = closeRing(ring);
    if (closed.length < 4) return null;
    const clockwise = ringIsClockwise(closed);
    const wantClockwise = !isExterior;
    if (clockwise === wantClockwise) return closed;
    return closed.slice().reverse();
}

/** Convert Esri JSON polygon rings to GeoJSON Polygon/MultiPolygon. */
export function esriRingsToGeoJSON(rings) {
    if (!rings?.length) return null;
    const closedRings = rings.map(closeRing).filter((ring) => ring.length >= 4);
    if (!closedRings.length) return null;

    const assembled = assemblePolygon(closedRings);
    if (!assembled) return null;

    const normalizePolygon = (polyRings) => {
        const out = [];
        for (let i = 0; i < polyRings.length; i++) {
            const normalized = ringToRfc7946(polyRings[i], i === 0);
            if (normalized) out.push(normalized);
        }
        return out.length ? out : null;
    };

    if (assembled.type === 'Polygon') {
        const coordinates = normalizePolygon(assembled.coordinates);
        return coordinates ? { type: 'Polygon', coordinates } : null;
    }

    const multi = assembled.coordinates.map(normalizePolygon).filter(Boolean);
    if (!multi.length) return null;
    if (multi.length === 1) {
        return { type: 'Polygon', coordinates: multi[0] };
    }
    return { type: 'MultiPolygon', coordinates: multi };
}

/** @param {object|null} geom Esri JSON geometry */
export function convertEsriGeometry(geom) {
    if (!geom) return null;
    if (geom.x != null && geom.y != null) {
        return { type: 'Point', coordinates: [geom.x, geom.y] };
    }
    if (geom.points) {
        return { type: 'MultiPoint', coordinates: geom.points.map((p) => [p[0], p[1]]) };
    }
    if (geom.paths) {
        if (geom.paths.length === 1) {
            return { type: 'LineString', coordinates: geom.paths[0] };
        }
        return { type: 'MultiLineString', coordinates: geom.paths };
    }
    if (geom.rings) {
        return esriRingsToGeoJSON(geom.rings);
    }
    return null;
}

/**
 * Exponential backoff with jitter (for tests and retries).
 * @param {number} attempt 0-based attempt index after a failure
 * @param {() => number} [random] inject RNG (0..1)
 */
export function computeArcgisRetryDelayMs(attempt, random = Math.random) {
    const exp = Math.min(
        ARCGIS_BACKOFF_MAX_MS,
        ARCGIS_BACKOFF_BASE_MS * (2 ** attempt)
    );
    const jitter = Math.floor(random() * (ARCGIS_BACKOFF_JITTER_MS + 1));
    return exp + jitter;
}

function parseRetryAfterMs(headerValue) {
    if (headerValue == null || headerValue === '') return null;
    const seconds = Number(headerValue);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(headerValue);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    return null;
}

function esriErrorCode(data) {
    const code = data?.error?.code;
    return code == null ? null : Number(code);
}

/** @returns {boolean} */
export function isRetryableEsriErrorCode(code) {
    if (code == null || Number.isNaN(code)) return false;
    if (code === 498 || code === 499) return false;
    if (code >= 400 && code < 500) return false;
    if (code >= 500) return true;
    return false;
}

/** @returns {boolean} */
export function isRetryableHttpStatus(status) {
    return status === 429 || (status >= 500 && status < 600);
}

function createLinkedAbortSignal(signals) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    for (const sig of signals) {
        if (!sig) continue;
        if (sig.aborted) {
            ctrl.abort();
            break;
        }
        sig.addEventListener('abort', onAbort, { once: true });
    }
    return ctrl.signal;
}

function timeoutSignal(ms) {
    if (typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms);
    }
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new DOMException('Timeout', 'TimeoutError')), ms);
    return ctrl.signal;
}

function combineTimeoutAndCallerSignal(timeoutMs, callerSignal) {
    const timeout = timeoutSignal(timeoutMs);
    if (!callerSignal) return timeout;
    return createLinkedAbortSignal([timeout, callerSignal]);
}

function sleep(ms, signal) {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason || new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(resolve, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function classifyFetchFailure(err, url) {
    if (err instanceof AppError) return err;
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        return new AppError('Request timed out', ErrorCategory.TIMEOUT, { url });
    }
    if (err?.name === 'TypeError' && String(err.message).includes('Failed to fetch')) {
        return new AppError(
            'Cannot reach this server. It may be blocking cross-origin requests (CORS).',
            ErrorCategory.CORS_BLOCKED,
            { url }
        );
    }
    return new AppError(
        err?.message || 'Network request failed',
        ErrorCategory.NETWORK_ERROR,
        { url }
    );
}

/**
 * Low-level JSON GET with timeout, caller abort, retries, and Esri error detection.
 * @param {string} url
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxRetries]
 */
export async function arcgisFetchJson(url, options = {}) {
    const {
        signal = null,
        timeoutMs = DEFAULT_ARCGIS_TIMEOUT_MS,
        maxRetries = DEFAULT_ARCGIS_MAX_RETRIES
    } = options;

    let attempt = 0;
    while (true) {
        const linked = combineTimeoutAndCallerSignal(timeoutMs, signal);
        try {
            const response = await fetch(url, { signal: linked });
            let data = null;
            try {
                data = await response.json();
            } catch (_) {
                data = null;
            }

            if (response.status === 401 || response.status === 403) {
                throw new AppError(
                    'This layer requires authentication. Only public layers are supported.',
                    ErrorCategory.AUTH_REQUIRED,
                    { url, status: response.status }
                );
            }

            if (isRetryableHttpStatus(response.status)) {
                if (attempt >= maxRetries) {
                    if (response.status === 429) {
                        throw new AppError('Rate limited', ErrorCategory.RATE_LIMIT, { url });
                    }
                    throw new AppError(
                        `Server returned HTTP ${response.status}`,
                        ErrorCategory.HTTP_5XX,
                        { url, status: response.status }
                    );
                }
                const retryAfter = parseRetryAfterMs(response.headers?.get?.('Retry-After'));
                const delayMs = retryAfter ?? computeArcgisRetryDelayMs(attempt);
                attempt += 1;
                await sleep(delayMs, signal);
                continue;
            }

            if (!response.ok) {
                throw new AppError(
                    `Server returned HTTP ${response.status}`,
                    response.status >= 500 ? ErrorCategory.HTTP_5XX : ErrorCategory.HTTP_4XX,
                    { url, status: response.status, body: data }
                );
            }

            if (data?.error) {
                const code = esriErrorCode(data);
                if (isRetryableEsriErrorCode(code) && attempt < maxRetries) {
                    await sleep(computeArcgisRetryDelayMs(attempt), signal);
                    attempt += 1;
                    continue;
                }
                throw new AppError(
                    data.error.message || 'Service returned an error',
                    ErrorCategory.HTTP_4XX,
                    { url, error: data.error, esriCode: code }
                );
            }

            return data;
        } catch (err) {
            if (signal?.aborted || err?.name === 'AbortError') {
                throw classifyFetchFailure(err, url);
            }
            if (err instanceof AppError) {
                throw err;
            }
            if (attempt >= maxRetries) {
                throw classifyFetchFailure(err, url);
            }
            attempt += 1;
            await sleep(computeArcgisRetryDelayMs(attempt - 1), signal);
        }
    }
}

/**
 * @param {object} layerJson Layer ?f=json payload
 */
export function arcgisLayerCapabilities(layerJson) {
    const caps = layerJson?.advancedQueryCapabilities || {};
    return {
        supportsPagination: caps.supportsPagination !== false,
        supportsResultOffset: caps.supportsResultOffset !== false
    };
}

/** @param {object} caps */
export function arcgisSupportsOffsetPaging(caps) {
    return caps.supportsPagination !== false && caps.supportsResultOffset !== false;
}

/**
 * Build shared query params (where, geometry, outFields) for count + feature queries.
 * @param {object} query
 */
export function buildArcgisQuerySearchParams(query) {
    const {
        where = '1=1',
        outFields = '*',
        returnGeometry = true,
        geometry = null,
        geometryType = 'esriGeometryEnvelope',
        spatialRel = 'esriSpatialRelIntersects',
        inSR = '4326',
        outSR = '4326',
        f = 'json',
        orderByFields = null,
        objectIdField = 'OBJECTID'
    } = query;

    const params = new URLSearchParams({
        where: String(where),
        outFields: Array.isArray(outFields) ? outFields.join(',') : String(outFields),
        returnGeometry: String(returnGeometry),
        f: String(f),
        outSR: String(outSR)
    });

    if (geometry) {
        params.set('geometry', typeof geometry === 'string' ? geometry : JSON.stringify(geometry));
        params.set('geometryType', geometryType);
        params.set('spatialRel', spatialRel);
        params.set('inSR', inSR);
    }

    const orderBy = orderByFields != null && String(orderByFields).length > 0
        ? String(orderByFields)
        : String(objectIdField);
    params.set('orderByFields', orderBy);

    return params;
}

/**
 * Feature count using the same filter as a feature query (fail closed when this fails).
 * @returns {Promise<{ count: number|null, countFailed: boolean }>}
 */
export async function arcgisQueryFeatureCount(layerUrl, query, options = {}) {
    const params = buildArcgisQuerySearchParams(query);
    params.set('returnCountOnly', 'true');
    params.delete('orderByFields');
    params.delete('returnGeometry');
    const url = `${String(layerUrl).replace(/\/+$/, '')}/query?${params}`;
    try {
        const data = await arcgisFetchJson(url, {
            ...options,
            timeoutMs: options.timeoutMs ?? DEFAULT_ARCGIS_QUERY_TIMEOUT_MS
        });
        if (data?.count == null || !Number.isFinite(Number(data.count))) {
            return { count: null, countFailed: true };
        }
        return { count: Number(data.count), countFailed: false };
    } catch (_) {
        return { count: null, countFailed: true };
    }
}

function chunkArray(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

/**
 * Paginate Esri JSON features (`f=json`) with offset paging or objectId batches.
 * @param {object} options
 * @param {string} options.layerUrl
 * @param {object} options.layerMeta
 * @param {object} options.query
 * @param {number|null} [options.featureCap]
 * @param {boolean} [options.enforceCapWhenCountUnknown]
 * @param {(features: object[], ctx: object) => Promise<void>|void} [options.onPage]
 * @returns {Promise<{ featureCount: number, truncated: boolean, capped: boolean }>}
 */
export async function arcgisQueryAllEsriFeatures(options) {
    const {
        layerUrl,
        layerMeta,
        query,
        signal = null,
        timeoutMs = DEFAULT_ARCGIS_QUERY_TIMEOUT_MS,
        featureCap = null,
        enforceCapWhenCountUnknown = false,
        onPage = null
    } = options;

    const maxRec = layerMeta.maxRecordCount || 1000;
    const caps = layerMeta.capabilities || arcgisLayerCapabilities(layerMeta.raw || {});
    const useOffsetPaging = arcgisSupportsOffsetPaging(caps);

    let truncated = false;
    let capped = false;
    let total = 0;

    const baseParams = buildArcgisQuerySearchParams({
        ...query,
        objectIdField: layerMeta.objectIdField || 'OBJECTID'
    });

    const fetchPage = async (extraParams) => {
        const params = new URLSearchParams(baseParams);
        for (const [k, v] of Object.entries(extraParams)) {
            params.set(k, v);
        }
        const url = `${layerUrl}/query?${params}`;
        return arcgisFetchJson(url, { signal, timeoutMs });
    };

    const applyCap = () => {
        if (featureCap == null) return false;
        if (total >= featureCap) {
            truncated = true;
            capped = true;
            return true;
        }
        return false;
    };

    if (useOffsetPaging) {
        let offset = 0;
        let done = false;
        while (!done) {
            if (applyCap()) break;
            const remaining = featureCap != null ? featureCap - total : maxRec;
            const pageSize = featureCap != null ? Math.min(maxRec, remaining) : maxRec;
            const data = await fetchPage({
                resultOffset: String(offset),
                resultRecordCount: String(pageSize)
            });
            const features = data.features || [];
            if (!features.length) break;
            let pageFeatures = features;
            if (featureCap != null) {
                const room = featureCap - total;
                if (room <= 0) break;
                if (pageFeatures.length > room) {
                    pageFeatures = pageFeatures.slice(0, room);
                    truncated = true;
                    capped = true;
                }
            }
            total += pageFeatures.length;
            if (onPage) await onPage(pageFeatures, { offset, pageSize });
            if (featureCap != null && total >= featureCap) {
                truncated = true;
                capped = true;
                break;
            }
            if (!arcgisResponseExceededTransferLimit(data)) {
                done = true;
            } else {
                offset += pageFeatures.length;
            }
        }
    } else {
        const idParams = new URLSearchParams(baseParams);
        idParams.set('returnIdsOnly', 'true');
        idParams.delete('returnGeometry');
        idParams.delete('orderByFields');
        const idUrl = `${layerUrl}/query?${idParams}`;
        const idData = await arcgisFetchJson(idUrl, { signal, timeoutMs });
        const objectIds = idData.objectIds || [];
        const batches = chunkArray(objectIds, maxRec);
        for (const batch of batches) {
            if (applyCap()) break;
            const remaining = featureCap != null ? featureCap - total : batch.length;
            const ids = featureCap != null ? batch.slice(0, remaining) : batch;
            if (!ids.length) break;
            const data = await fetchPage({
                objectIds: ids.join(','),
                resultRecordCount: String(Math.min(maxRec, ids.length))
            });
            const features = data.features || [];
            let pageFeatures = features;
            if (featureCap != null) {
                const room = featureCap - total;
                if (room <= 0) break;
                if (pageFeatures.length > room) {
                    pageFeatures = pageFeatures.slice(0, room);
                    truncated = true;
                    capped = true;
                }
            }
            total += pageFeatures.length;
            if (onPage) await onPage(pageFeatures, { objectIds: ids });
            if (featureCap != null && total >= featureCap) {
                truncated = true;
                capped = true;
                break;
            }
        }
    }

    if (enforceCapWhenCountUnknown && featureCap != null && total >= featureCap) {
        truncated = true;
        capped = true;
    }

    return { featureCount: total, truncated, capped };
}

/**
 * Paginate GeoJSON query responses (`f=geojson`) for live-layer envelope fetches.
 * @returns {Promise<{ features: object[], truncated: boolean }>}
 */
export async function arcgisQueryGeoJsonPages(options) {
    const {
        layerUrl,
        query,
        maxFeatures,
        signal = null,
        timeoutMs = DEFAULT_ARCGIS_QUERY_TIMEOUT_MS
    } = options;

    const pageSize = Math.min(1000, query.pageSize || 1000);
    let offset = 0;
    const features = [];
    let truncated = false;

    while (features.length < maxFeatures) {
        const remaining = maxFeatures - features.length;
        const params = buildArcgisQuerySearchParams({ ...query, f: 'geojson' });
        params.set('resultOffset', String(offset));
        params.set('resultRecordCount', String(Math.min(pageSize, remaining)));

        const url = `${String(layerUrl).replace(/\/+$/, '')}/query?${params}`;
        const data = await arcgisFetchJson(url, { signal, timeoutMs });
        const page = data?.type === 'FeatureCollection' ? (data.features || []) : [];
        features.push(...page);

        if (!page.length || !arcgisResponseExceededTransferLimit(data)) break;
        offset += page.length;
        if (features.length >= maxFeatures) {
            truncated = true;
            break;
        }
    }

    return {
        features: features.slice(0, maxFeatures),
        truncated
    };
}

/**
 * Single-page Esri JSON query (used by route-milepost widget).
 */
export async function arcgisQueryFeaturesPage(layerUrl, query, pageOptions = {}) {
    const params = buildArcgisQuerySearchParams(query);
    const {
        resultOffset = 0,
        resultRecordCount = null,
        maxRecordCount = 1000
    } = pageOptions;
    params.set('resultOffset', String(resultOffset));
    params.set(
        'resultRecordCount',
        String(resultRecordCount != null ? Math.min(resultRecordCount, maxRecordCount) : maxRecordCount)
    );
    const url = `${String(layerUrl).replace(/\/+$/, '')}/query?${params}`;
    return arcgisFetchJson(url, pageOptions);
}

/**
 * Resolve copyright / service metadata for a layer endpoint.
 * @param {string} cleanLayerUrl
 * @param {object} layerJson
 */
export async function arcgisResolveLayerAttribution(cleanLayerUrl, layerJson, options = {}) {
    let copyright = layerJson?.copyrightText || '';
    if (copyright) return copyright;
    const match = String(cleanLayerUrl).match(/^(.*\/(?:MapServer|FeatureServer))\/?\d+\/?$/i);
    if (!match) return '';
    try {
        const svc = await arcgisFetchJson(`${match[1]}?f=json`, options);
        return svc?.copyrightText || '';
    } catch (_) {
        return '';
    }
}

export { combineTimeoutAndCallerSignal, timeoutSignal, classifyFetchFailure };

/**
 * Read JSON from a fetch Response with a streaming byte cap.
 * @param {Response} response
 * @param {number} maxBytes
 * @param {AbortSignal} [signal]
 */
export async function readJsonBodyWithByteCap(response, maxBytes, signal = null) {
    if (!response.body) {
        const text = await response.text();
        if (text.length > maxBytes) {
            throw new AppError(
                `Response exceeds ${maxBytes} byte limit`,
                ErrorCategory.OUT_OF_MEMORY,
                { maxBytes, size: text.length }
            );
        }
        return JSON.parse(text);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            if (signal?.aborted) {
                throw classifyFetchFailure(
                    signal.reason || new DOMException('Aborted', 'AbortError'),
                    response.url
                );
            }
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new AppError(
                    `Response exceeds ${maxBytes} byte limit`,
                    ErrorCategory.OUT_OF_MEMORY,
                    { maxBytes, size: total }
                );
            }
            chunks.push(value);
        }
    } finally {
        try {
            reader.releaseLock();
        } catch (_) { /* ignore */ }
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(merged);
    return JSON.parse(text);
}

/**
 * Generic JSON GET with timeout, caller abort, and streaming byte cap (non-Esri).
 * @param {string} url
 * @param {{ signal?: AbortSignal|null, timeoutMs?: number, maxBytes?: number }} [options]
 */
export async function fetchJsonWithLimits(url, options = {}) {
    const {
        signal = null,
        timeoutMs = DEFAULT_ARCGIS_TIMEOUT_MS,
        maxBytes = 32 * 1024 * 1024
    } = options;

    const linked = combineTimeoutAndCallerSignal(timeoutMs, signal);
    try {
        const response = await fetch(url, { signal: linked });
        if (!response.ok) {
            throw new AppError(
                `Request failed (${response.status})`,
                response.status >= 500 ? ErrorCategory.HTTP_5XX : ErrorCategory.HTTP_4XX,
                { url, status: response.status }
            );
        }
        return await readJsonBodyWithByteCap(response, maxBytes, linked);
    } catch (err) {
        throw classifyFetchFailure(err, url);
    }
}
