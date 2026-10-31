/**
 * Geometry reprojection via proj4.
 */
import { createSpatialDataset } from '../core/data-model.js';
import { hasProjectedCoordinates } from './layer-crs.js';
import {
    assertFiniteReprojectOutput,
    CrsReprojectError,
    requireRegisteredReprojectCrs
} from './reproject-crs.js';
import { getProj4 } from './registry.js';
import { isDisplayReady } from './detect.js';

/**
 * @param {object} dataset
 * @param {{ fromCrs?: string, toCrs: string, name?: string }} options
 * @returns {Promise<string>}
 */
async function resolveDatasetFromCrs(options, dataset) {
    const schemaCrs = dataset.schema?.crs;
    const explicitFrom = options.fromCrs;

    if (explicitFrom != null && String(explicitFrom).trim() !== '') {
        const normalizedExplicit = await requireRegisteredReprojectCrs(explicitFrom, 'source');
        if (
            !schemaCrs
            && normalizedExplicit === 'EPSG:4326'
            && hasProjectedCoordinates(dataset.geojson)
        ) {
            throw new CrsReprojectError(
                'Reprojection source coordinate system is missing — this layer has projected coordinates but no CRS is assigned.',
                { side: 'source', crs: null, reason: 'missing' }
            );
        }
        return normalizedExplicit;
    }

    if (schemaCrs != null && String(schemaCrs).trim() !== '') {
        return requireRegisteredReprojectCrs(schemaCrs, 'source');
    }

    if (hasProjectedCoordinates(dataset.geojson)) {
        throw new CrsReprojectError(
            'Reprojection source coordinate system is missing — projected coordinates require an explicit source CRS.',
            { side: 'source', crs: null, reason: 'missing' }
        );
    }

    return requireRegisteredReprojectCrs('EPSG:4326', 'source');
}

/**
 * @param {[number, number]} coord
 * @param {string} fromCrs
 * @param {string} toCrs
 * @returns {Promise<[number, number]>}
 */
export async function reprojectCoordinate(coord, fromCrs, toCrs) {
    const from = await requireRegisteredReprojectCrs(fromCrs, 'source');
    const to = await requireRegisteredReprojectCrs(toCrs, 'target');
    if (from === to) return [...coord];

    const proj4 = await getProj4();
    let out;
    try {
        out = proj4(from, to, coord);
    } catch (e) {
        throw new CrsReprojectError(
            `Reprojection failed for source CRS ${from} → target CRS ${to}: ${e?.message || 'projection error'}`,
            { side: 'source', crs: from, reason: 'transform_failed' }
        );
    }
    assertFiniteReprojectOutput(out, from, to);
    return [out[0], out[1]];
}

/**
 * @param {object|null} geometry
 * @param {string} fromCrs
 * @param {string} toCrs
 * @returns {Promise<object|null>}
 */
export async function reprojectGeometry(geometry, fromCrs, toCrs) {
    if (!geometry || !geometry.coordinates) return geometry;
    const from = await requireRegisteredReprojectCrs(fromCrs, 'source');
    const to = await requireRegisteredReprojectCrs(toCrs, 'target');
    if (from === to) return geometry;

    const clone = JSON.parse(JSON.stringify(geometry));
    await _walkCoords(clone.coordinates, clone.type, async (c) => {
        return reprojectCoordinate(c, from, to);
    });
    return clone;
}

async function _walkCoords(coords, type, fn) {
    if (type === 'Point') {
        const projected = await fn([coords[0], coords[1]]);
        coords[0] = projected[0];
        coords[1] = projected[1];
        return;
    }
    if (type === 'MultiPoint' || type === 'LineString') {
        for (let i = 0; i < coords.length; i++) {
            coords[i] = await fn(coords[i]);
        }
        return;
    }
    if (type === 'MultiLineString' || type === 'Polygon') {
        for (let i = 0; i < coords.length; i++) {
            for (let j = 0; j < coords[i].length; j++) {
                coords[i][j] = await fn(coords[i][j]);
            }
        }
        return;
    }
    if (type === 'MultiPolygon') {
        for (let i = 0; i < coords.length; i++) {
            for (let j = 0; j < coords[i].length; j++) {
                for (let k = 0; k < coords[i][j].length; k++) {
                    coords[i][j][k] = await fn(coords[i][j][k]);
                }
            }
        }
    }
}

/**
 * @param {object} fc FeatureCollection
 * @param {string} fromCrs
 * @param {string} toCrs
 * @returns {Promise<object>}
 */
export async function reprojectFeatureCollection(fc, fromCrs, toCrs) {
    const features = [];
    for (const f of fc.features || []) {
        features.push({
            ...f,
            geometry: f.geometry
                ? await reprojectGeometry(f.geometry, fromCrs, toCrs)
                : null
        });
    }
    return { type: 'FeatureCollection', features };
}

/**
 * @param {object} dataset spatial dataset
 * @param {{ fromCrs?: string, toCrs: string, name?: string }} options
 * @returns {Promise<object>}
 */
export async function reprojectDataset(dataset, options) {
    const fromCrs = await resolveDatasetFromCrs(options, dataset);
    const toCrs = await requireRegisteredReprojectCrs(options.toCrs, 'target');
    const fc = await reprojectFeatureCollection(dataset.geojson, fromCrs, toCrs);

    const out = createSpatialDataset(
        options.name || `${dataset.name}_reproject_${toCrs.replace(':', '')}`,
        fc,
        {
            format: 'derived',
            originalCrs: fromCrs,
            crsDetected: 'reproject',
            sourceLayer: dataset.name
        },
        { crs: toCrs, crsWkt: null }
    );

    if (!isDisplayReady(toCrs)) {
        out.source.crsWarning = `Layer reprojected to ${toCrs} — not suitable for web map display.`;
    }

    return out;
}
