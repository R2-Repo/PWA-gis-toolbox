/**
 * Web Worker — offload heavy import parsing from the main thread.
 */
import { DOMParser } from '@xmldom/xmldom';
import toGeoJSON from '@mapbox/togeojson';
import JSZip from 'jszip';
import shp from 'shpjs';
import { parseGeoJSONText } from '../import/parsers/parse-geojson.js';
import { parseKmlText } from '../import/parsers/parse-kml.js';
import { parseGpxText } from '../import/parsers/parse-gpx.js';
import { extractKmlFromKmzBuffer } from '../import/parsers/parse-kmz-buffer.js';
import { parseShapefileBuffer } from '../import/parsers/parse-shapefile-buffer.js';

self.onmessage = async (event) => {
    const { id, op, payload } = event.data || {};
    try {
        let result;
        switch (op) {
            case 'geojson':
                result = parseGeoJSONText(payload);
                break;
            case 'kml':
                result = parseKmlText(payload, {
                    DOMParserImpl: DOMParser,
                    toGeoJsonLib: toGeoJSON
                });
                break;
            case 'gpx':
                result = parseGpxText(payload, {
                    DOMParserImpl: DOMParser,
                    toGeoJsonLib: toGeoJSON
                });
                break;
            case 'kmz': {
                const extracted = await extractKmlFromKmzBuffer(payload, JSZip);
                const parsed = parseKmlText(extracted.kmlText, {
                    DOMParserImpl: DOMParser,
                    toGeoJsonLib: toGeoJSON
                });
                result = {
                    ...parsed,
                    mainKmlPath: extracted.mainKmlPath,
                    reason: extracted.reason
                };
                break;
            }
            case 'shapefile':
                result = await parseShapefileBuffer(payload, shp, { JSZipLib: JSZip });
                break;
            default:
                throw new Error(`Unknown import parse op: ${op}`);
        }
        self.postMessage({ id, ok: true, result });
    } catch (error) {
        self.postMessage({
            id,
            ok: false,
            error: error?.message || String(error)
        });
    }
};
