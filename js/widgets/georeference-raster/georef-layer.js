/**
 * Georeferenced image layer contract.
 * Distinct from wireless coverageType: 'raster'.
 */

import { blobToDataUrl, dataUrlToBlob } from '../../core/coverage-raster-layer.js';
import {
    GEOREF_FORMAT,
    GEOREF_TYPE,
    cornersToBbox,
    transformImageCorners
} from './engine.js';

export { GEOREF_FORMAT, GEOREF_TYPE };

/**
 * @param {object|null|undefined} dataset
 */
export function isGeoreferencedImageLayer(dataset) {
    const source = dataset?.source || dataset;
    if (!source) return false;
    return source.georeferenceType === GEOREF_TYPE
        || source.format === GEOREF_FORMAT;
}

export function getGeoreferenceRecord(dataset) {
    if (!isGeoreferencedImageLayer(dataset)) return null;
    return dataset.source?.georeference || null;
}

export function getGeoreferenceRaster(dataset) {
    if (!isGeoreferencedImageLayer(dataset)) return null;
    return dataset.source?.georeferenceRaster || null;
}

export function listGeoreferencedImageLayers(layers = []) {
    return (layers || []).filter(isGeoreferencedImageLayer);
}

/**
 * @param {number[][]} coordinates
 */
export function buildGeorefBoundsGeojson(coordinates, properties = {}) {
    if (!coordinates?.length) {
        return { type: 'FeatureCollection', features: [] };
    }
    const ring = [...coordinates, coordinates[0]];
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [ring] },
            properties: {
                georef_shape: 'image_bounds',
                ...properties
            }
        }]
    };
}

export function buildGeorefRasterPayload({
    url = '',
    mime = 'image/png',
    width,
    height,
    coordinates,
    file = 'georef.png'
}) {
    return {
        url: url || '',
        mime,
        width,
        height,
        coordinates,
        bbox: cornersToBbox(coordinates),
        file
    };
}

export function stripGeoreferenceRasterUrl(raster) {
    if (!raster) return null;
    const { url, dataUrl, ...rest } = raster;
    return rest;
}

export function stripGeoreferenceSourceForPersist(source = {}) {
    if (!isGeoreferencedImageLayer({ source })) return source;
    return {
        ...source,
        format: GEOREF_FORMAT,
        georeferenceType: GEOREF_TYPE,
        georeferenceRaster: stripGeoreferenceRasterUrl(source.georeferenceRaster)
    };
}

export async function blobFromGeoreferenceRaster(raster) {
    if (!raster) return null;
    if (raster.blob instanceof Blob) return raster.blob;
    if (raster.url && raster.url.startsWith('blob:')) {
        try {
            const res = await fetch(raster.url);
            return await res.blob();
        } catch {
            return null;
        }
    }
    if (raster.dataUrl) return dataUrlToBlob(raster.dataUrl);
    return null;
}

export async function dataUrlFromGeoreferenceRaster(raster) {
    if (raster?.dataUrl) return raster.dataUrl;
    const blob = await blobFromGeoreferenceRaster(raster);
    if (!blob) return '';
    return blobToDataUrl(blob);
}

export function coordinatesFromAlignment(alignment, width, height) {
    if (!alignment?.transform) return null;
    return transformImageCorners(alignment.transform, width, height);
}

export default {
    isGeoreferencedImageLayer,
    getGeoreferenceRecord,
    getGeoreferenceRaster,
    listGeoreferencedImageLayers,
    buildGeorefBoundsGeojson,
    buildGeorefRasterPayload,
    stripGeoreferenceSourceForPersist
};
