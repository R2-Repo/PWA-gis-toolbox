/**
 * Public ArcGIS Feature/MapServer envelope queries (GeoJSON).
 */

/**
 * @param {string} [url]
 * @returns {string}
 */
export function normalizeArcgisLayerUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '').split('?')[0];
}

/**
 * @param {{ west: number, south: number, east: number, north: number }} envelope
 */
function isValidEnvelope(envelope) {
    return Number.isFinite(envelope?.west)
        && Number.isFinite(envelope?.south)
        && Number.isFinite(envelope?.east)
        && Number.isFinite(envelope?.north)
        && envelope.east > envelope.west
        && envelope.north > envelope.south;
}

/**
 * Query a public ArcGIS layer by WGS84 envelope.
 * @param {string} url
 * @param {{ west: number, south: number, east: number, north: number }} envelope
 * @param {{
 *   where?: string,
 *   maxFeatures?: number,
 *   pageSize?: number,
 *   signal?: AbortSignal|null
 * }} [opts]
 * @returns {Promise<{ type: 'FeatureCollection', features: object[], truncated: boolean }>}
 */
export async function queryArcgisVectorEnvelope(url, envelope, opts = {}) {
    const {
        where = '1=1',
        maxFeatures = 10_000,
        pageSize = 1000,
        signal = null
    } = opts;

    if (!url || !isValidEnvelope(envelope)) {
        return { type: 'FeatureCollection', features: [], truncated: false };
    }

    const cleanUrl = normalizeArcgisLayerUrl(url);
    const geometry = {
        xmin: envelope.west,
        ymin: envelope.south,
        xmax: envelope.east,
        ymax: envelope.north,
        spatialReference: { wkid: 4326 }
    };

    let offset = 0;
    const features = [];
    let truncated = false;

    while (features.length < maxFeatures) {
        if (signal?.aborted) {
            throw new DOMException('Query cancelled.', 'AbortError');
        }
        const remaining = maxFeatures - features.length;
        const params = new URLSearchParams({
            f: 'geojson',
            where,
            geometry: JSON.stringify(geometry),
            geometryType: 'esriGeometryEnvelope',
            inSR: '4326',
            outSR: '4326',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: '*',
            returnGeometry: 'true',
            resultOffset: String(offset),
            resultRecordCount: String(Math.min(pageSize, remaining))
        });

        const resp = await fetch(`${cleanUrl}/query?${params}`, signal ? { signal } : undefined);
        if (!resp.ok) throw new Error(`FeatureServer query failed (${resp.status})`);
        const data = await resp.json();
        if (data.error) throw new Error(data.error.message || 'FeatureServer query error');

        const page = data.type === 'FeatureCollection' ? (data.features || []) : [];
        features.push(...page);

        const exceeded = data.exceededTransferLimit === true
            || data.properties?.exceededTransferLimit === true;
        if (!page.length || !exceeded) break;

        offset += page.length;
        if (features.length >= maxFeatures) {
            truncated = true;
            break;
        }
    }

    return { type: 'FeatureCollection', features, truncated };
}
