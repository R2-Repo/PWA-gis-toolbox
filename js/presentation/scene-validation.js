import { PRESENTATION_SCENE_VERSION } from './presentation-scene-schema.js';
import { estimateEncodedSceneLength } from './presentation-scene-codec.js';

export const SCENE_LIMITS = {
    maxFeatures: 25,
    maxVertices: 1000,
    maxEncodedLength: 50000,
    maxAnimationSteps: 5,
    maxCallouts: 10
};

const SUPPORTED_GEOMETRIES = new Set([
    'Point', 'MultiPoint',
    'LineString', 'MultiLineString',
    'Polygon', 'MultiPolygon'
]);

/**
 * @param {unknown} coords
 * @returns {number}
 */
export function countVertices(coords) {
    if (!Array.isArray(coords)) return 0;
    if (coords.length === 0) return 0;
    if (typeof coords[0] === 'number') return 1;
    return coords.reduce((sum, part) => sum + countVertices(part), 0);
}

/**
 * @param {import('geojson').Geometry | null | undefined} geometry
 * @returns {{ vertices: number, types: Set<string>, valid: boolean, reason?: string }}
 */
export function inspectGeometry(geometry) {
    const types = new Set();
    if (!geometry || typeof geometry !== 'object') {
        return { vertices: 0, types, valid: false, reason: 'Missing geometry' };
    }
    if (!SUPPORTED_GEOMETRIES.has(geometry.type)) {
        return { vertices: 0, types, valid: false, reason: `Unsupported geometry type: ${geometry.type}` };
    }
    types.add(geometry.type);
    const vertices = countVertices(geometry.coordinates);
    if (!Number.isFinite(vertices) || vertices <= 0) {
        return { vertices: 0, types, valid: false, reason: 'Geometry has no coordinates' };
    }
    return { vertices, types, valid: true };
}

/**
 * @param {import('geojson').FeatureCollection | null | undefined} featureCollection
 */
export function summarizeFeatures(featureCollection) {
    const features = featureCollection?.features || [];
    const geometryTypes = new Set();
    let vertexCount = 0;
    const issues = [];

    for (const feature of features) {
        const result = inspectGeometry(feature?.geometry);
        if (!result.valid) {
            issues.push(result.reason || 'Invalid feature');
            continue;
        }
        result.types.forEach((type) => geometryTypes.add(type));
        vertexCount += result.vertices;
    }

    return {
        featureCount: features.length,
        geometryTypes: [...geometryTypes],
        vertexCount,
        issues
    };
}

/**
 * @param {import('geojson').FeatureCollection | null | undefined} featureCollection
 * @param {object} [options]
 * @param {number} [options.maxFeatures]
 * @param {number} [options.maxVertices]
 * @param {number} [options.maxEncodedLength]
 * @param {object} [options.sceneDraft] - optional full scene for URL size estimate
 */
export function validatePresentationFeatures(featureCollection, options = {}) {
    const limits = {
        maxFeatures: options.maxFeatures ?? SCENE_LIMITS.maxFeatures,
        maxVertices: options.maxVertices ?? SCENE_LIMITS.maxVertices,
        maxEncodedLength: options.maxEncodedLength ?? SCENE_LIMITS.maxEncodedLength
    };

    const summary = summarizeFeatures(featureCollection);
    const errors = [...summary.issues];

    if (summary.featureCount === 0) {
        errors.push('Select at least one feature for the presentation.');
    }
    if (summary.featureCount > limits.maxFeatures) {
        errors.push(`Too many features (${summary.featureCount}). Maximum is ${limits.maxFeatures}.`);
    }
    if (summary.vertexCount > limits.maxVertices) {
        errors.push(`Too many vertices (${summary.vertexCount}). Maximum is ${limits.maxVertices}.`);
    }

    let estimatedUrlLength = 0;
    if (options.sceneDraft) {
        estimatedUrlLength = estimateEncodedSceneLength(options.sceneDraft);
        if (estimatedUrlLength > limits.maxEncodedLength) {
            errors.push(`Encoded URL is too long (${estimatedUrlLength} chars). Maximum is ${limits.maxEncodedLength}.`);
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        summary,
        estimatedUrlLength,
        tooLargeMessage: errors.length > 0
            ? 'This selection is too large for a presentation URL. Select fewer features, simplify the geometry, or use a normal workspace export.'
            : null
    };
}

/**
 * @param {import('../presentation/presentation-scene-schema.js').PresentationScene} scene
 */
export function validatePresentationScene(scene) {
    const errors = [];

    if (!scene || typeof scene !== 'object') {
        return { ok: false, errors: ['Scene is missing'], scene: null };
    }
    if (scene.version !== PRESENTATION_SCENE_VERSION) {
        errors.push(`Unsupported scene version: ${scene.version}`);
    }
    if (scene.mode !== 'present') {
        errors.push(`Unsupported mode: ${scene.mode}`);
    }

    const animations = scene.animations || [];
    if (animations.length > SCENE_LIMITS.maxAnimationSteps) {
        errors.push(`Too many animation steps (${animations.length}). Maximum is ${SCENE_LIMITS.maxAnimationSteps}.`);
    }

    const callouts = scene.callouts || [];
    if (callouts.length > SCENE_LIMITS.maxCallouts) {
        errors.push(`Too many callouts (${callouts.length}). Maximum is ${SCENE_LIMITS.maxCallouts}.`);
    }

    const featureValidation = validatePresentationFeatures(scene.features, {
        sceneDraft: scene
    });
    errors.push(...featureValidation.errors);

    return {
        ok: errors.length === 0,
        errors,
        summary: featureValidation.summary,
        estimatedUrlLength: featureValidation.estimatedUrlLength,
        tooLargeMessage: featureValidation.tooLargeMessage
    };
}
