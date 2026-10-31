import * as turf from '@turf/turf';
import { createLoopProgress } from '../workflow-run-helpers.js';

/**
 * Turf simplify without TaskRunner / main-thread globals.
 */
export function computeSimplify(inputs, config, context) {
    const data = inputs[0];
    if (!data || data.type !== 'spatial') throw new Error('Spatial input required');

    const tolerance = config.tolerance ?? 0.001;
    const features = data.geojson.features || [];
    const tick = createLoopProgress(context, features.length);
    const simplifiedFeatures = [];

    for (let i = 0; i < features.length; i++) {
        tick(i, 'Simplifying geometries');
        const f = features[i];
        if (!f?.geometry) {
            simplifiedFeatures.push(f);
            continue;
        }
        try {
            const simplified = turf.simplify(f, { tolerance, highQuality: true });
            if (simplified?.properties == null && f.properties) {
                simplified.properties = { ...f.properties };
            } else if (simplified && f.properties) {
                simplified.properties = { ...f.properties, ...simplified.properties };
            }
            simplifiedFeatures.push(simplified || f);
        } catch {
            simplifiedFeatures.push(f);
        }
    }

    const geojson = { type: 'FeatureCollection', features: simplifiedFeatures };
    return {
        ...data,
        name: `${data.name}_simplified`,
        geojson,
        schema: { ...data.schema, featureCount: simplifiedFeatures.length }
    };
}
