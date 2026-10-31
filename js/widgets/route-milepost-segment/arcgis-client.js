import { ArcGISRestImporter, esriFeatureToGeoJSON, ARCGIS_MAX_FEATURES } from '../../arcgis/rest-importer.js';
import {
    arcgisQueryAllEsriFeatures,
    arcgisQueryFeaturesPage,
    arcgisResponseExceededTransferLimit,
    convertEsriGeometry
} from '../../arcgis/rest-client.js';
import { AppError, ErrorCategory } from '../../core/error-handler.js';
import { UDOT_ROUTE_SEGMENT_CONFIG } from './config.js';
import { buildRouteIdWhere, buildSelectedRouteWhere } from './engine.js';

const importerCache = new Map();

function getImporter(url) {
    const clean = url.replace(/\/+$/, '').split('?')[0];
    if (!importerCache.has(clean)) {
        importerCache.set(clean, new ArcGISRestImporter());
    }
    return importerCache.get(clean);
}

/**
 * @param {string} url
 */
export async function fetchLayerMetadata(url) {
    const importer = getImporter(url);
    return importer.fetchMetadata(url);
}

/**
 * @param {object} metadata
 * @param {string[]} requiredFields
 */
export function validateLayerFields(metadata, requiredFields) {
    const available = new Set((metadata?.fields || []).map((field) => field.name));
    const missing = requiredFields.filter((name) => !available.has(name));
    if (missing.length > 0) {
        throw new AppError(
            `ArcGIS layer "${metadata?.name || 'layer'}" is missing expected fields: ${missing.join(', ')}`,
            ErrorCategory.PARSE_FAILED,
            { missing, url: metadata?.url }
        );
    }
}

/**
 * @param {typeof UDOT_ROUTE_SEGMENT_CONFIG} config
 */
export async function validateWidgetLayerConfig(config = UDOT_ROUTE_SEGMENT_CONFIG) {
    const [routeMeta, wholeMeta, tenthMeta] = await Promise.all([
        fetchLayerMetadata(config.routeLayerUrl),
        fetchLayerMetadata(config.milepostWholeLayerUrl),
        fetchLayerMetadata(config.milepostTenthLayerUrl)
    ]);

    validateLayerFields(routeMeta, [
        config.routeAliasField,
        config.routeIdField,
        config.routeDirectionField,
        config.routeTypeField,
        config.cartoCodeField
    ]);
    validateLayerFields(wholeMeta, [
        config.milepostRouteIdField,
        config.milepostValueField
    ]);
    validateLayerFields(tenthMeta, [
        config.milepostRouteIdField,
        config.milepostValueField
    ]);

    return { routeMeta, wholeMeta, tenthMeta };
}

/**
 * Lightweight ArcGIS query — never bulk-imports layers.
 * @param {string} url
 * @param {object} options
 */
export async function queryFeatures(url, options = {}) {
    const importer = getImporter(url);
    if (!importer.getMetadata()) {
        await importer.fetchMetadata(url);
    }

    const metadata = importer.getMetadata();
    const maxRec = metadata.maxRecordCount || 1000;
    const {
        where = '1=1',
        outFields = '*',
        returnGeometry = true,
        resultRecordCount = maxRec,
        orderByFields = '',
        resultOffset = 0,
        signal = null
    } = options;

    const data = await arcgisQueryFeaturesPage(metadata.url, {
        where,
        outFields,
        returnGeometry,
        orderByFields,
        objectIdField: metadata.objectIdField
    }, {
        resultOffset,
        resultRecordCount,
        maxRecordCount: maxRec,
        signal,
        timeoutMs: 30_000
    });

    const convert = (geom) => convertEsriGeometry(geom) ?? importer.convertGeometry(geom);
    const features = (data.features || []).map((feature) =>
        esriFeatureToGeoJSON(feature, convert)
    );

    return {
        features,
        exceededTransferLimit: arcgisResponseExceededTransferLimit(data),
        fields: data.fields || metadata.fields || []
    };
}

/**
 * Paginate until all matching features are retrieved (soft cap for widget queries).
 * @param {string} url
 * @param {object} options
 */
export async function queryAllFeatures(url, options = {}) {
    const importer = getImporter(url);
    if (!importer.getMetadata()) {
        await importer.fetchMetadata(url);
    }
    const metadata = importer.getMetadata();
    const allFeatures = [];
    const convert = (geom) => convertEsriGeometry(geom) ?? importer.convertGeometry(geom);

    await arcgisQueryAllEsriFeatures({
        layerUrl: metadata.url,
        layerMeta: metadata,
        query: {
            where: options.where ?? '1=1',
            outFields: options.outFields ?? '*',
            returnGeometry: options.returnGeometry ?? true,
            orderByFields: options.orderByFields,
            objectIdField: metadata.objectIdField
        },
        signal: options.signal ?? null,
        featureCap: options.featureCap ?? ARCGIS_MAX_FEATURES,
        enforceCapWhenCountUnknown: Boolean(metadata.countFailed),
        onPage: (page) => {
            for (const feature of page) {
                allFeatures.push(esriFeatureToGeoJSON(feature, convert));
            }
        }
    });

    return allFeatures;
}

/**
 * @param {string} where
 * @param {typeof UDOT_ROUTE_SEGMENT_CONFIG} config
 */
export async function searchRoutes(where, config = UDOT_ROUTE_SEGMENT_CONFIG) {
    const result = await queryFeatures(config.routeLayerUrl, {
        where,
        outFields: config.routeSearchOutFields,
        returnGeometry: false,
        resultRecordCount: config.routeSearchLimit,
        orderByFields: config.routeAliasField
    });
    return result.features.map((feature) => feature.properties || {});
}

/**
 * @param {string} routeId
 * @param {typeof UDOT_ROUTE_SEGMENT_CONFIG} config
 * @param {string} [direction]
 */
export async function queryRouteFeaturesById(routeId, config = UDOT_ROUTE_SEGMENT_CONFIG, direction = null) {
    const where = direction
        ? buildSelectedRouteWhere(routeId, direction, config)
        : buildRouteIdWhere(routeId, config);
    return queryAllFeatures(config.routeLayerUrl, {
        where,
        outFields: config.routeGeometryOutFields,
        returnGeometry: true
    });
}

/**
 * @param {string} where
 * @param {'whole'|'tenth'} layerKey
 * @param {typeof UDOT_ROUTE_SEGMENT_CONFIG} config
 */
export async function queryMilepostFeatures(where, layerKey, config = UDOT_ROUTE_SEGMENT_CONFIG) {
    const url = layerKey === 'whole'
        ? config.milepostWholeLayerUrl
        : config.milepostTenthLayerUrl;
    return queryAllFeatures(url, {
        where,
        outFields: config.milepostOutFields,
        returnGeometry: true,
        orderByFields: config.milepostValueField
    });
}

/**
 * Verify direction codes exist on the route layer.
 * @param {typeof UDOT_ROUTE_SEGMENT_CONFIG} config
 */
export async function verifyDirectionValues(config = UDOT_ROUTE_SEGMENT_CONFIG) {
    const posWhere = `${config.routeDirectionField} = '${String(config.positiveDirectionValue).replace(/'/g, "''")}'`;
    const negWhere = `${config.routeDirectionField} = '${String(config.negativeDirectionValue).replace(/'/g, "''")}'`;

    const [positive, negative] = await Promise.all([
        queryFeatures(config.routeLayerUrl, {
            where: posWhere,
            outFields: [config.routeDirectionField],
            returnGeometry: false,
            resultRecordCount: 1
        }),
        queryFeatures(config.routeLayerUrl, {
            where: negWhere,
            outFields: [config.routeDirectionField],
            returnGeometry: false,
            resultRecordCount: 1
        })
    ]);

    return {
        positiveFound: positive.features.length > 0,
        negativeFound: negative.features.length > 0
    };
}
