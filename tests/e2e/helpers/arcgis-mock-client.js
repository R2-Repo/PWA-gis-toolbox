const DEFAULT_PORT = 18765;

export function arcgisMockOrigin() {
    const port = process.env.ARCGIS_MOCK_PORT || DEFAULT_PORT;
    return `http://127.0.0.1:${port}`;
}

/** @param {string} layerKey e.g. mock/FeatureServer/0 */
export function mockLayerUrl(layerKey) {
    const [folder, serviceType, layerId] = layerKey.split('/');
    return `${arcgisMockOrigin()}/arcgis/rest/services/${folder}/${serviceType}/${layerId}`;
}

/** @param {import('@playwright/test').APIRequestContext} request */
export async function resetArcgisMockRequests(request) {
    await request.post(`${arcgisMockOrigin()}/mock/reset`);
}

/** @param {import('@playwright/test').APIRequestContext} request */
export async function readArcgisMockRequests(request) {
    const res = await request.get(`${arcgisMockOrigin()}/mock/requests`);
    const json = await res.json();
    return /** @type {{ url: string, method: string, at: number }[]} */ (json.requests || []);
}

/**
 * @param {{ url: string }[]} requests
 * @param {RegExp|string} pattern
 */
export function filterMockRequests(requests, pattern) {
    const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return requests.filter((r) => re.test(r.url));
}
