/**
 * Streaming shapefile → GeoJSON features: pairs .shp geometry records with
 * .dbf attribute rows in lockstep and reprojects via the .prj WKT (proj4),
 * matching the standard shpjs behavior of returning WGS84 output.
 * Dependencies injected (proj4) — pure and node-testable.
 */
import { createByteReader } from './byte-reader.js';
import { iterateShpRecords } from './shp-stream-parser.js';
import { iterateDbfRecords, decoderFromCpg } from './dbf-stream-parser.js';

const WGS84_DEF = '+proj=longlat +datum=WGS84 +no_defs';

/** True when the .prj describes a plain WGS84 geographic CRS (no transform needed). */
export function prjIsWgs84(prjWkt) {
    const head = String(prjWkt || '').slice(0, 200).replace(/\s+/g, '').toUpperCase();
    return head.startsWith('GEOGCS["GCS_WGS_1984"')
        || head.startsWith('GEOGCS["WGS84"')
        || head.startsWith('GEOGCS["WGS_1984"')
        || head.startsWith('GEOGCRS["WGS84"');
}

/**
 * Build a coordinate transform from .prj WKT, or null when none is needed.
 * @param {string|null} prjWkt
 * @param {object|null} proj4Lib
 * @returns {{ transform: ((coord: [number,number]) => [number,number])|null, warning: string|null }}
 */
export function buildPrjTransform(prjWkt, proj4Lib) {
    if (!prjWkt || prjIsWgs84(prjWkt)) {
        return { transform: null, warning: null };
    }
    if (!proj4Lib) {
        return { transform: null, warning: 'No projection engine available — coordinates imported unprojected.' };
    }
    try {
        const converter = proj4Lib(prjWkt, WGS84_DEF);
        const probe = converter.forward([0, 0]);
        if (!Number.isFinite(probe[0]) || !Number.isFinite(probe[1])) {
            throw new Error('probe failed');
        }
        return {
            transform: (coord) => converter.forward([coord[0], coord[1]]),
            warning: null
        };
    } catch {
        return {
            transform: null,
            warning: 'The shapefile projection (.prj) could not be parsed — coordinates imported unprojected.'
        };
    }
}

function _mapGeometryCoords(geometry, fn) {
    const walk = (coords, depth) => {
        if (depth === 0) return fn(coords);
        return coords.map((c) => walk(c, depth - 1));
    };
    switch (geometry.type) {
        case 'Point': return { ...geometry, coordinates: fn(geometry.coordinates) };
        case 'MultiPoint':
        case 'LineString': return { ...geometry, coordinates: walk(geometry.coordinates, 1) };
        case 'MultiLineString':
        case 'Polygon': return { ...geometry, coordinates: walk(geometry.coordinates, 2) };
        case 'MultiPolygon': return { ...geometry, coordinates: walk(geometry.coordinates, 3) };
        default: return geometry;
    }
}

/**
 * @param {{
 *   shpStream: ReadableStream<Uint8Array>,
 *   dbfStream?: ReadableStream<Uint8Array>|null,
 *   prjWkt?: string|null,
 *   cpgText?: string|null,
 *   proj4Lib?: object|null
 * }} sources
 * @returns {{
 *   features: AsyncGenerator<object>,
 *   getBytesConsumed: () => number,
 *   warnings: string[]
 * }}
 */
export function streamShapefileFeatures(sources) {
    const { shpStream, dbfStream = null, prjWkt = null, cpgText = null, proj4Lib = null } = sources;

    const shpReader = createByteReader(shpStream);
    const dbfReader = dbfStream ? createByteReader(dbfStream) : null;
    const { transform, warning } = buildPrjTransform(prjWkt, proj4Lib);
    const warnings = warning ? [warning] : [];

    async function* generate() {
        const shpIter = iterateShpRecords(shpReader);
        const dbfIter = dbfReader
            ? iterateDbfRecords(dbfReader, decoderFromCpg(cpgText))
            : null;

        try {
            while (true) {
                const shpNext = await shpIter.next();
                if (shpNext.done) break;

                let properties = {};
                if (dbfIter) {
                    const dbfNext = await dbfIter.next();
                    if (!dbfNext.done && dbfNext.value) properties = dbfNext.value;
                }

                let geometry = shpNext.value.geometry;
                if (geometry && transform) {
                    geometry = _mapGeometryCoords(geometry, transform);
                }

                yield { type: 'Feature', geometry, properties };
            }
        } finally {
            await shpReader.cancel();
            if (dbfReader) await dbfReader.cancel();
        }
    }

    return {
        features: generate(),
        getBytesConsumed: () => shpReader.bytesConsumed + (dbfReader?.bytesConsumed ?? 0),
        warnings
    };
}

export default { streamShapefileFeatures, buildPrjTransform, prjIsWgs84 };
