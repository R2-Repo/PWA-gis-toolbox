/**
 * Shared plan-production services exposed for cross-widget use.
 */

export {
    getStationingRoutes,
    getNearestStationingRoute,
    getStationAtCoordinate,
    getStationRangeForLine,
    getMilepostAtCoordinate,
    formatStation,
    applyStationingToLineFeature,
    applyStationingToPointFeature,
    lineSliceAlongRoute
} from '../plan-project/stationing-adapter.js';

export {
    createPlanProjectRecord,
    loadPlanProject,
    savePlanProject,
    serializeProjectBundle,
    restoreProjectBundle,
    createProjectRevisionSnapshot,
    serializePlanProjectJson,
    parsePlanProjectJson
} from '../plan-project/plan-project-service.js';

export {
    linkParentChild,
    getChildren,
    getParents,
    validateRelationships,
    removeRelationshipsForFeature
} from '../plan-project/relationship-model.js';

export {
    calculateMapFrameGroundDimensions,
    generateSheetFramesAlongRoute,
    assignFeaturesToSheets,
    generateMatchLine,
    buildOverviewSheet,
    validateSheetCoverage
} from '../widgets/sheet-cutting/engine.js';

export {
    generateFeatureAssignments,
    buildSheetCalloutTable,
    buildMasterCalloutLegend,
    evaluateCalloutRule
} from '../widgets/plan-set-callouts/engine.js';

export {
    generateSheetAwarePlacements,
    buildSheetCalloutMarkersGeoJson,
    buildPerSheetCalloutTablesCsv,
    validateSheetAwarePlacements,
    resolveFeatureDistanceAlongRoute
} from '../widgets/plan-set-callouts/sheet-placement-engine.js';
