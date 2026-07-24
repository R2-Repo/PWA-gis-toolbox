/**
 * Spatial Join widget engine (points-in-polygons JS path helpers).
 */

export const PREDICATE_OPTIONS = [
    { value: 'within', label: 'Points within polygons' },
    { value: 'intersects', label: 'Intersects' },
    { value: 'contains', label: 'Contains' }
];

/**
 * @param {object} opts
 */
export function validateSpatialJoinConfig({
    leftLayer,
    rightLayer,
    predicate = 'within'
}) {
    const errors = [];
    if (!leftLayer) errors.push('Choose the features layer (left).');
    if (!rightLayer) errors.push('Choose the join layer (right / polygons).');
    if (leftLayer && rightLayer && leftLayer.id === rightLayer.id) {
        errors.push('Left and right layers must be different.');
    }
    const leftCount = leftLayer?.geojson?.features?.length
        ?? leftLayer?.featureCount
        ?? 0;
    const rightCount = rightLayer?.geojson?.features?.length
        ?? rightLayer?.featureCount
        ?? 0;
    if (leftLayer && leftCount === 0) {
        errors.push('The features layer has no features.');
    }
    if (rightLayer && rightCount === 0) {
        errors.push('The join layer has no features.');
    }
    const pred = String(predicate || 'within').toLowerCase();
    if (!['within', 'intersects', 'contains'].includes(pred)) {
        errors.push('Choose a valid spatial predicate.');
    }
    return { errors, predicate: pred };
}
