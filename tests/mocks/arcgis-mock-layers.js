/**
 * ArcGIS REST mock layer definitions and query handlers (hand-built; no live API).
 */

const PNG_1X1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const MOCK_FIELDS = [
    { name: 'OBJECTID', type: 'esriFieldTypeOID', alias: 'OBJECTID' },
    { name: 'NAME', type: 'esriFieldTypeString', alias: 'Name' },
    { name: 'SCORE', type: 'esriFieldTypeInteger', alias: 'Score' },
    { name: 'CARTO_CODE', type: 'esriFieldTypeString', alias: 'Carto' },
    { name: 'MODEL', type: 'esriFieldTypeString', alias: 'Model' }
];

const UDOT_ROUTES_RENDERER = {
    type: 'uniqueValue',
    field1: 'CARTO_CODE',
    fieldDelimiter: ', ',
    uniqueValueInfos: [
        {
            value: '1',
            label: 'Interstate',
            symbol: { type: 'esriSLS', style: 'esriSLSSolid', color: [115, 178, 255, 255], width: 2 }
        },
        {
            value: '2',
            label: 'US Route',
            symbol: { type: 'esriSLS', style: 'esriSLSSolid', color: [255, 0, 0, 255], width: 2 }
        }
    ]
};

const PICTURE_RENDERER = {
    type: 'uniqueValue',
    field1: 'MODEL',
    uniqueValueInfos: [
        {
            value: 'Cabinet',
            label: 'Cabinet',
            symbol: {
                type: 'esriPMS',
                url: 'abc123',
                imageData: PNG_1X1,
                contentType: 'image/png',
                width: 24,
                height: 24
            }
        }
    ]
};

/** @param {number} id */
export function pointGeometry4326(id) {
    const lon = -111.5 + ((id * 17) % 500) / 1000;
    const lat = 40.5 + ((id * 13) % 400) / 1000;
    return { x: lon, y: lat };
}

/** @param {number} id */
export function esriPointFeature(id, extra = {}) {
    return {
        attributes: { OBJECTID: id, NAME: `Feature ${id}`, SCORE: id, ...extra },
        geometry: pointGeometry4326(id)
    };
}

export function esriPolylineFeature(id, cartoCode = '1') {
    const base = pointGeometry4326(id);
    return {
        attributes: { OBJECTID: id, NAME: `Line ${id}`, CARTO_CODE: cartoCode },
        geometry: {
            paths: [
                [
                    [base.x, base.y],
                    [base.x + 0.02, base.y + 0.01]
                ]
            ]
        }
    };
}

export function esriPolygonFeature(id) {
    const c = pointGeometry4326(id);
    const ring = [
        [c.x, c.y],
        [c.x + 0.03, c.y],
        [c.x + 0.03, c.y + 0.02],
        [c.x, c.y + 0.02],
        [c.x, c.y]
    ];
    return {
        attributes: { OBJECTID: id, NAME: `Poly ${id}` },
        geometry: { rings: [ring] }
    };
}

/**
 * @typedef {object} MockLayerDef
 * @property {string} name
 * @property {'FeatureServer'|'MapServer'} serviceType
 * @property {string} geometryType
 * @property {number} featureCount
 * @property {number} [maxRecordCount]
 * @property {object} [capabilities]
 * @property {object} [drawingInfo]
 * @property {object} [spatialReference]
 * @property {string} [behavior]
 * @property {(id: number) => object} [buildFeature]
 */

/** @type {Record<string, MockLayerDef>} */
export const LAYER_REGISTRY = {
    'mock/FeatureServer/0': {
        name: 'Mock Points',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPoint',
        featureCount: 3,
        buildFeature: (id) => esriPointFeature(id)
    },
    'mock/FeatureServer/1': {
        name: 'Mock Polylines',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPolyline',
        featureCount: 2,
        buildFeature: (id) => esriPolylineFeature(id, id === 1 ? '1' : '2')
    },
    'mock/FeatureServer/2': {
        name: 'Mock Polygons',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPolygon',
        featureCount: 1,
        drawingInfo: {
            renderer: {
                type: 'simple',
                symbol: {
                    type: 'esriSFS',
                    style: 'esriSFSSolid',
                    color: [252, 229, 204, 180],
                    outline: {
                        type: 'esriSLS',
                        style: 'esriSLSSolid',
                        color: [110, 110, 110, 255],
                        width: 0.7
                    }
                }
            },
            labelingInfo: [{
                labelPlacement: 'esriServerPolygonPlacementAlwaysHorizontal',
                labelExpression: '[NAME]',
                symbol: {
                    type: 'esriTS',
                    color: [17, 17, 17, 255],
                    haloColor: [255, 255, 255, 255],
                    haloSize: 1.25,
                    font: { size: 12, family: 'Arial' }
                }
            }]
        },
        buildFeature: (id) => esriPolygonFeature(id)
    },
    'mock/FeatureServer/3': {
        name: 'Mock Paged Points',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPoint',
        featureCount: 2500,
        maxRecordCount: 1000,
        buildFeature: (id) => esriPointFeature(id)
    },
    'mock/FeatureServer/4': {
        name: 'Mock Styled Lines',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPolyline',
        featureCount: 2,
        drawingInfo: { renderer: UDOT_ROUTES_RENDERER },
        buildFeature: (id) => esriPolylineFeature(id, id === 1 ? '1' : '2')
    },
    'mock/FeatureServer/5': {
        name: 'Mock Picture Points',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPoint',
        featureCount: 2,
        drawingInfo: { renderer: PICTURE_RENDERER },
        buildFeature: (id) =>
            esriPointFeature(id, { MODEL: id === 1 ? 'Cabinet' : 'Other' })
    },
    'mock/FeatureServer/6': {
        name: 'Mock Mercator Meta',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPoint',
        featureCount: 2,
        spatialReference: { wkid: 3857, latestWkid: 3857 },
        buildFeature: (id) => esriPointFeature(id)
    },
    'mock/FeatureServer/7': {
        name: 'Mock ObjectId Batch',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPoint',
        featureCount: 5,
        maxRecordCount: 2,
        capabilities: { supportsPagination: false, supportsResultOffset: false },
        buildFeature: (id) => esriPointFeature(id)
    },
    'mock/MapServer/0': {
        name: 'Mock Map Point Layer',
        serviceType: 'MapServer',
        geometryType: 'esriGeometryPoint',
        featureCount: 2,
        buildFeature: (id) => esriPointFeature(id)
    },
    'error-empty/FeatureServer/0': {
        name: 'Empty Layer',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPoint',
        featureCount: 0,
        buildFeature: () => null
    },
    'error-http500/FeatureServer/0': {
        name: 'HTTP 500 Layer',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPoint',
        featureCount: 0,
        behavior: 'http500-meta'
    },
    'error-esri498/FeatureServer/0': {
        name: 'Token Error Layer',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPoint',
        featureCount: 0,
        behavior: 'esri498-meta'
    },
    'error-esri400/FeatureServer/0': {
        name: 'Bad Query Layer',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPoint',
        featureCount: 1,
        behavior: 'esri400-query',
        buildFeature: (id) => esriPointFeature(id)
    },
    'error-malformed/FeatureServer/0': {
        name: 'Malformed Layer',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPoint',
        featureCount: 1,
        behavior: 'malformed-query',
        buildFeature: (id) => esriPointFeature(id)
    },
    'error-slow/FeatureServer/0': {
        name: 'Slow Layer',
        serviceType: 'FeatureServer',
        geometryType: 'esriGeometryPoint',
        featureCount: 50,
        behavior: 'slow-query',
        buildFeature: (id) => esriPointFeature(id)
    }
};

/**
 * @param {string} layerKey e.g. mock/FeatureServer/0
 */
export function getLayerDef(layerKey) {
    return LAYER_REGISTRY[layerKey] || null;
}

/**
 * @param {string} layerKey
 * @param {URLSearchParams} params
 */
export function handleLayerQuery(layerKey, params) {
    const def = getLayerDef(layerKey);
    if (!def) return { status: 404, body: { error: { code: 404, message: 'Layer not found' } } };

    if (def.behavior === 'esri400-query' && params.get('returnCountOnly') !== 'true') {
        return { status: 200, body: { error: { code: 400, message: 'Invalid query' } } };
    }
    if (def.behavior === 'malformed-query' && params.get('returnCountOnly') !== 'true') {
        return { status: 200, body: null, malformed: true };
    }

    const total = def.featureCount ?? 0;

    if (params.get('returnCountOnly') === 'true') {
        return { status: 200, body: { count: total } };
    }

    if (params.get('returnIdsOnly') === 'true') {
        const ids = [];
        for (let i = 1; i <= total; i++) ids.push(i);
        return { status: 200, body: { objectIds: ids } };
    }

    const maxRec = def.maxRecordCount || 1000;
    const caps = def.capabilities || { supportsPagination: true, supportsResultOffset: true };
    const useOffset =
        caps.supportsPagination !== false && caps.supportsResultOffset !== false;

    if (!useOffset && params.get('objectIds')) {
        const ids = params
            .get('objectIds')
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n));
        const features = ids.map((id) => def.buildFeature?.(id)).filter(Boolean);
        return { status: 200, body: { features } };
    }

    const offset = Number(params.get('resultOffset') || 0);
    const reqCount = Number(params.get('resultRecordCount') || maxRec);
    const pageSize = Math.min(maxRec, reqCount);
    const features = [];
    for (let i = 0; i < pageSize; i++) {
        const id = offset + i + 1;
        if (id > total) break;
        const f = def.buildFeature?.(id);
        if (f) features.push(f);
    }
    const fetched = offset + features.length;
    const exceeded = fetched < total;
    return {
        status: 200,
        body: {
            features,
            exceededTransferLimit: exceeded
        }
    };
}

/**
 * @param {string} layerKey
 */
export function layerMetadataJson(layerKey) {
    const def = getLayerDef(layerKey);
    if (!def) return null;

    if (def.behavior === 'http500-meta') {
        return { error: 'http500' };
    }
    if (def.behavior === 'esri498-meta') {
        return { error: { code: 498, message: 'Invalid token.' } };
    }

    const maxRecordCount = def.maxRecordCount ?? 1000;
    const caps = def.capabilities || {
        supportsPagination: true,
        supportsResultOffset: true
    };

    return {
        currentVersion: 11.1,
        id: Number(layerKey.split('/').pop()) || 0,
        name: def.name,
        type: 'Feature Layer',
        geometryType: def.geometryType,
        objectIdField: 'OBJECTID',
        displayField: 'NAME',
        fields: MOCK_FIELDS,
        maxRecordCount,
        advancedQueryCapabilities: {
            supportsPagination: caps.supportsPagination !== false,
            supportsResultOffset: caps.supportsResultOffset !== false
        },
        drawingInfo: def.drawingInfo || null,
        spatialReference: def.spatialReference || { wkid: 4326, latestWkid: 4326 },
        copyrightText: layerKey.startsWith('mock/MapServer')
            ? ''
            : `Mock ${def.name}`
    };
}

/**
 * @param {string} servicePath e.g. mock/FeatureServer
 */
export function serviceMetadataJson(servicePath) {
    const [folder, type] = servicePath.split('/');
    return {
        currentVersion: 11.1,
        serviceDescription: 'GIS mock service',
        copyrightText: `Mock service ${folder}`,
        layers: [{ id: 0, name: 'Layer 0' }]
    };
}

export function parseLayerKeyFromPathname(pathname) {
    const m = pathname.match(
        /^\/arcgis\/rest\/services\/(.+)\/(FeatureServer|MapServer)\/(\d+)\/?$/i
    );
    if (!m) return null;
    return `${m[1]}/${m[2]}/${m[3]}`;
}

export function parseServiceKeyFromPathname(pathname) {
    const m = pathname.match(/^\/arcgis\/rest\/services\/(.+)\/(FeatureServer|MapServer)\/?$/i);
    if (!m) return null;
    return `${m[1]}/${m[2]}`;
}
