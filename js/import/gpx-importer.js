/**
 * GPX importer using toGeoJSON library
 */
import {
    createSpatialDataset,
    explodeGeometryCollectionsInFeatureCollectionAsync,
    syncSpatialSchemaFeatureCount
} from '../core/data-model.js';
import { AppError, ErrorCategory } from '../core/error-handler.js';
import { parseGpxForImport } from './import-parse-service.js';

/**
 * @param {File|string} file
 * @param {import('../core/task-runner.js').TaskRunner} task
 * @param {{ sourceFileName?: string, text?: string, byteSize?: number, geojson?: object }} [meta]
 */
export async function importGPX(file, task, meta = {}) {
    let geojson;

    if (meta.geojson) {
        geojson = meta.geojson;
    } else {
        task.updateProgress(20, 'Reading GPX...');

        let text;
        if (typeof file === 'string') {
            text = file;
        } else if (meta.text) {
            text = meta.text;
        } else {
            text = await file.text();
        }

        task.updateProgress(50, 'Parsing GPX to GeoJSON...');

        const byteSize = meta.byteSize ?? text.length;
        try {
            ({ geojson } = await parseGpxForImport(text, byteSize));
        } catch (e) {
            throw new AppError(e.message || 'Invalid GPX', ErrorCategory.PARSE_FAILED);
        }
    }

    geojson = await explodeGeometryCollectionsInFeatureCollectionAsync(geojson, task);

    const featCount = geojson.features.length;
    task.updateProgress(90, 'Building dataset...');
    const defaultName = typeof file === 'string'
        ? (meta.sourceFileName || 'GPX_Layer').replace(/\.gpx$/i, '')
        : file.name.replace(/\.gpx$/i, '');
    const sourceFile = typeof file === 'string'
        ? (meta.sourceFileName || 'data.gpx')
        : file.name;

    const dataset = syncSpatialSchemaFeatureCount(createSpatialDataset(defaultName, geojson, {
        file: sourceFile,
        format: 'gpx'
    }));

    if (featCount === 0) {
        dataset._importWarning = 'GPX contains no tracks, routes, or waypoints. An empty layer was created.';
    }

    return dataset;
}
