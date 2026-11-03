/**
 * Stamp map display features with a stable identity index.
 * A stored `_featureIndex` is kept; batch position is only a fallback.
 */
import { flattenFeatureGeometryCollections } from '../core/data-model.js';
import { renderFeatureIndex } from '../workspace/feature-identity.js';

function _stampInPlace(feature, featureIndex, datasetId) {
    if (!feature.properties) feature.properties = {};
    else if (!Object.prototype.hasOwnProperty.call(feature.properties, '_featureIndex')) {
        feature.properties = { ...feature.properties };
    }
    feature.properties._featureIndex = featureIndex;
    feature.properties._datasetId = datasetId;
}

/**
 * @param {object} dataset
 * @returns {object[]}
 */
export function tagFeaturesForMap(dataset) {
    const skipFlatten = dataset._geometryExploded === true;
    const taggedFeatures = [];
    const features = dataset.geojson?.features || [];

    for (let origIndex = 0; origIndex < features.length; origIndex++) {
        const f = features[origIndex];
        if (!f?.geometry) continue;
        const featureIndex = renderFeatureIndex(f, origIndex);

        if (skipFlatten) {
            _stampInPlace(f, featureIndex, dataset.id);
            taggedFeatures.push(f);
            continue;
        }

        const parts = flattenFeatureGeometryCollections(f);
        for (const part of parts) {
            taggedFeatures.push({
                ...part,
                properties: {
                    ...(part.properties || {}),
                    _featureIndex: renderFeatureIndex(part, featureIndex),
                    _datasetId: dataset.id
                }
            });
        }
    }
    return taggedFeatures;
}

/**
 * Tag an incremental batch. `startIndex` is the fallback when a feature
 * has no stored identity yet (in-memory import).
 * @param {object} dataset
 * @param {object[]} rawFeatures
 * @param {number} startIndex
 * @returns {object[]}
 */
export function tagFeatureBatch(dataset, rawFeatures, startIndex) {
    const skipFlatten = dataset._geometryExploded === true;
    const tagged = [];
    for (let i = 0; i < (rawFeatures?.length || 0); i++) {
        const origIndex = startIndex + i;
        const f = rawFeatures[i];
        if (!f?.geometry) continue;
        const featureIndex = renderFeatureIndex(f, origIndex);

        if (skipFlatten) {
            _stampInPlace(f, featureIndex, dataset.id);
            tagged.push(f);
            continue;
        }

        const parts = flattenFeatureGeometryCollections(f);
        for (const part of parts) {
            tagged.push({
                ...part,
                properties: {
                    ...(part.properties || {}),
                    _featureIndex: renderFeatureIndex(part, featureIndex),
                    _datasetId: dataset.id
                }
            });
        }
    }
    return tagged;
}
