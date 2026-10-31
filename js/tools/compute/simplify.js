import * as turf from '@turf/turf';
import { createLoopProgress } from './ctx.js';

function countVertices(geojson) {
    let count = 0;
    const countCoords = (coords) => {
        if (typeof coords[0] === 'number') return 1;
        return coords.reduce((sum, c) => sum + countCoords(c), 0);
    };
    for (const f of (geojson.features || [])) {
        if (f.geometry?.coordinates) {
            count += countCoords(f.geometry.coordinates);
        }
    }
    return count;
}

/**
 * @param {import('geojson').FeatureCollection} inputFc
 * @param {{ tolerance?: number }} params
 * @param {object} [ctx]
 */
export function simplifyFeatureCollection(inputFc, params, ctx) {
    const tolerance = params.tolerance ?? 0.001;
    const features = inputFc.features || [];
    const tick = createLoopProgress(ctx, features.length);
    const simplifiedFeatures = [];
    let failures = 0;

    for (let i = 0; i < features.length; i++) {
        tick(i, 'Simplifying geometries');
        const f = features[i];
        if (!f?.geometry) {
            simplifiedFeatures.push(f);
            continue;
        }
        try {
            const simplified = turf.simplify(f, { tolerance, highQuality: true });
            if (simplified) {
                simplified.properties = { ...f.properties, ...simplified.properties };
                simplifiedFeatures.push(simplified);
            } else {
                simplifiedFeatures.push(f);
            }
        } catch {
            failures++;
            simplifiedFeatures.push(f);
        }
    }

    const geojson = { type: 'FeatureCollection', features: simplifiedFeatures };
    const verticesBefore = countVertices(inputFc);
    const verticesAfter = countVertices(geojson);
    return {
        geojson,
        stats: {
            inCount: features.length,
            outCount: simplifiedFeatures.length,
            failed: failures,
            verticesBefore,
            verticesAfter
        }
    };
}

export function computeSimplify(inputs, config, context) {
    const data = inputs[0];
    if (!data || data.type !== 'spatial') throw new Error('Spatial input required');

    const { geojson, stats } = simplifyFeatureCollection(data.geojson, config, context);
    return {
        ...data,
        name: `${data.name}_simplified`,
        geojson,
        schema: { ...data.schema, featureCount: stats.outCount }
    };
}

export { countVertices };
