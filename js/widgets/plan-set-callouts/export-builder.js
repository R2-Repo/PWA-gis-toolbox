/**
 * Export builder for plan set callouts.
 */

import { buildMasterCalloutLegend, buildSheetCalloutTable } from './engine.js';

/**
 * @param {object[]} assignments
 * @param {object[]} definitions
 * @returns {string}
 */
export function buildCalloutAssignmentCsv(assignments = [], definitions = []) {
    const definitionMap = new Map(definitions.map((entry) => [entry.calloutId, entry]));
    const rows = [['feature_id', 'callout_codes', 'callout_descriptions']];

    for (const assignment of assignments) {
        const codes = (assignment.calloutIds || [])
            .map((id) => definitionMap.get(id)?.code || '')
            .filter(Boolean)
            .join('; ');
        const descriptions = (assignment.callouts || [])
            .map((entry) => entry.shortDescription || '')
            .filter(Boolean)
            .join('; ');
        rows.push([
            assignment.featureId || '',
            codes,
            descriptions
        ]);
    }

    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * @param {object[]} legend
 * @returns {string}
 */
export function buildCalloutLegendCsv(legend = []) {
    const rows = [['code', 'shape', 'category', 'description']];
    for (const callout of legend) {
        rows.push([
            callout.code || '',
            callout.shape || '',
            callout.category || '',
            callout.shortDescription || ''
        ]);
    }
    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * @param {object} session
 * @returns {object}
 */
export function buildCalloutExportPackage(session) {
    const profile = session.callouts || {};
    const assignments = profile.assignments || [];
    const placements = profile.placements || [];
    const legend = buildMasterCalloutLegend([
        buildSheetCalloutTable(placements),
        profile.definitions || []
    ]);

    return {
        projectName: session.project?.projectName || 'Plan Set Callouts',
        legend,
        assignments,
        csv: {
            assignments: buildCalloutAssignmentCsv(assignments, profile.definitions || []),
            legend: buildCalloutLegendCsv(legend)
        },
        geojson: buildAssignedFeaturesGeoJson(assignments, session.designFeatures || [])
    };
}

/**
 * @param {object[]} assignments
 * @param {object[]} features
 * @returns {object}
 */
export function buildAssignedFeaturesGeoJson(assignments = [], features = []) {
    const assignmentMap = new Map(assignments.map((entry) => [entry.featureId, entry]));
    const featuresById = new Map(
        features.map((feature, index) => [
            feature.id || feature.properties?.feature_id || feature.properties?.segment_id || `feature-${index}`,
            feature
        ])
    );

    const output = [];
    for (const [featureId, assignment] of assignmentMap) {
        const feature = featuresById.get(featureId);
        if (!feature?.geometry) continue;
        output.push({
            type: 'Feature',
            properties: {
                feature_id: featureId,
                callout_codes: (assignment.callouts || []).map((entry) => entry.code).join(', '),
                callout_count: assignment.calloutIds?.length || 0
            },
            geometry: feature.geometry
        });
    }

    return { type: 'FeatureCollection', features: output };
}
