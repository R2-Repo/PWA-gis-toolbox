/**
 * Parent-child relationship tracking for plan-production features.
 */

import { createStableId } from './id-utils.js';

/**
 * @typedef {object} FeatureRelationship
 * @property {string} relationshipId
 * @property {string} parentId
 * @property {string} childId
 * @property {string} relationshipType
 * @property {object} [metadata]
 */

/**
 * @param {object} input
 * @returns {FeatureRelationship}
 */
export function createRelationship({
    parentId,
    childId,
    relationshipType,
    metadata = {}
}) {
    if (!parentId || !childId) {
        throw new Error('Relationship requires parentId and childId.');
    }
    if (parentId === childId) {
        throw new Error('A feature cannot relate to itself.');
    }
    return {
        relationshipId: createStableId('rel'),
        parentId,
        childId,
        relationshipType: relationshipType || 'parent_child',
        metadata: { ...metadata }
    };
}

/**
 * @param {FeatureRelationship[]} relationships
 * @param {string} parentId
 * @returns {FeatureRelationship[]}
 */
export function getChildren(relationships, parentId) {
    return (relationships || []).filter((rel) => rel.parentId === parentId);
}

/**
 * @param {FeatureRelationship[]} relationships
 * @param {string} childId
 * @returns {FeatureRelationship[]}
 */
export function getParents(relationships, childId) {
    return (relationships || []).filter((rel) => rel.childId === childId);
}

/**
 * @param {FeatureRelationship[]} relationships
 * @param {string} parentId
 * @param {string} childId
 * @param {string} [relationshipType]
 * @param {object} [metadata]
 * @returns {{ relationships: FeatureRelationship[], relationship: FeatureRelationship }}
 */
export function linkParentChild(relationships, parentId, childId, relationshipType = 'parent_child', metadata = {}) {
    const existing = (relationships || []).find((rel) =>
        rel.parentId === parentId &&
        rel.childId === childId &&
        rel.relationshipType === relationshipType
    );
    if (existing) {
        return { relationships: relationships || [], relationship: existing };
    }
    const relationship = createRelationship({ parentId, childId, relationshipType, metadata });
    return {
        relationships: [...(relationships || []), relationship],
        relationship
    };
}

/**
 * @param {FeatureRelationship[]} relationships
 * @param {string} featureId
 * @returns {FeatureRelationship[]}
 */
export function removeRelationshipsForFeature(relationships, featureId) {
    return (relationships || []).filter((rel) => rel.parentId !== featureId && rel.childId !== featureId);
}

/**
 * @param {FeatureRelationship[]} relationships
 * @param {Record<string, { featureId: string }>} featuresById
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRelationships(relationships, featuresById = {}) {
    const errors = [];
    const seen = new Set();

    for (const rel of relationships || []) {
        if (!rel.parentId || !rel.childId) {
            errors.push(`Relationship ${rel.relationshipId || '(unknown)'} is missing parent or child.`);
            continue;
        }
        const key = `${rel.parentId}|${rel.childId}|${rel.relationshipType}`;
        if (seen.has(key)) {
            errors.push(`Duplicate relationship between ${rel.parentId} and ${rel.childId}.`);
        }
        seen.add(key);

        if (featuresById[rel.parentId] == null) {
            errors.push(`Missing parent feature ${rel.parentId}.`);
        }
        if (featuresById[rel.childId] == null) {
            errors.push(`Missing child feature ${rel.childId}.`);
        }
    }

    return { valid: errors.length === 0, errors };
}
