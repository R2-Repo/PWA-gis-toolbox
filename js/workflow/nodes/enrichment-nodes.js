/**
 * Enrichment nodes — enrich features with external data (elevation, etc.)
 */
import { NodeBase } from './node-base.js';
import {
    cloneDatasetOutput,
    cloneSchema,
    createLoopProgress,
    throwIfAborted,
    throwIfAbortedPeriodic
} from '../workflow-run-helpers.js';

const ELEVATION_API = 'https://api.open-elevation.com/api/v1/lookup';
const BATCH_SIZE = 200;

async function queryElevations(coords, { signal, reportProgress } = {}) {
    const results = new Array(coords.length).fill(null);

    for (let i = 0; i < coords.length; i += BATCH_SIZE) {
        throwIfAbortedPeriodic(signal, i, BATCH_SIZE);
        const batch = coords.slice(i, i + BATCH_SIZE);
        reportProgress?.({
            progress: coords.length ? i / coords.length : 0,
            processed: i,
            total: coords.length,
            message: 'Querying elevation'
        });

        const body = JSON.stringify({ locations: batch });
        const resp = await fetch(ELEVATION_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body,
            signal
        });

        if (!resp.ok) throw new Error(`Elevation API error: ${resp.status} ${resp.statusText}`);
        const data = await resp.json();

        if (!data.results || data.results.length !== batch.length) {
            throw new Error('Elevation API returned unexpected number of results');
        }

        for (let j = 0; j < data.results.length; j++) {
            results[i + j] = data.results[j].elevation;
        }
    }

    reportProgress?.({
        progress: 1,
        processed: coords.length,
        total: coords.length,
        message: 'Elevation lookup complete'
    });

    return results;
}

function getRepresentativeCoord(geometry) {
    if (!geometry) return null;
    const type = geometry.type;
    const coords = geometry.coordinates;

    if (type === 'Point') {
        return { longitude: coords[0], latitude: coords[1] };
    }

    const positions = flattenPositions(coords);
    if (positions.length === 0) return null;

    let sumLng = 0, sumLat = 0;
    for (const p of positions) { sumLng += p[0]; sumLat += p[1]; }
    return {
        longitude: sumLng / positions.length,
        latitude: sumLat / positions.length
    };
}

function flattenPositions(arr) {
    if (!Array.isArray(arr)) return [];
    if (typeof arr[0] === 'number') return [arr];
    const out = [];
    for (const item of arr) out.push(...flattenPositions(item));
    return out;
}

export class AddElevationNode extends NodeBase {
    constructor() {
        super('add-elevation', {
            name: 'Add Elevation',
            icon: '⛰️',
            category: 'enrichment',
            color: '#0891b2'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Enriched', dataType: 'dataset' }];
        this.config = { fieldName: 'elevation', units: 'meters' };
    }

    validate() {
        if (!this.config.fieldName) return { valid: false, message: 'Field name is required' };
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');

        const features = data.geojson.features;
        if (features.length === 0) return cloneDatasetOutput(data);

        const coords = features.map(f => getRepresentativeCoord(f.geometry));
        const validCoords = coords.map(c => c || { latitude: 0, longitude: 0 });

        const lookupFn = context?.queryElevations
            ?? ((c) => queryElevations(c, {
                signal: context?.signal,
                reportProgress: context?.reportProgress
            }));

        throwIfAborted(context?.signal);
        const elevations = await lookupFn(validCoords);

        const METERS_TO_FEET = 3.28084;
        const toFeet = this.config.units === 'feet';
        const fieldName = this.config.fieldName;
        const tick = createLoopProgress(context, features.length);

        const enriched = [];
        for (let i = 0; i < features.length; i++) {
            tick(i, 'Applying elevation');
            const f = features[i];
            const elev = coords[i] && elevations[i] != null
                ? (toFeet ? Math.round(elevations[i] * METERS_TO_FEET * 100) / 100 : elevations[i])
                : null;
            enriched.push({
                ...f,
                properties: { ...f.properties, [fieldName]: elev }
            });
        }

        const schema = cloneSchema(data.schema);
        if (!schema.fields.find(f => f.name === fieldName)) {
            schema.fields.push({
                name: fieldName,
                type: 'number',
                nullCount: enriched.filter(f => f.properties[fieldName] == null).length,
                uniqueCount: new Set(enriched.map(f => f.properties[fieldName])).size,
                sampleValues: enriched.slice(0, 5).map(f => f.properties[fieldName]),
                min: Math.min(...enriched.map(f => f.properties[fieldName]).filter(v => v != null)),
                max: Math.max(...enriched.map(f => f.properties[fieldName]).filter(v => v != null)),
                selected: true,
                outputName: fieldName,
                order: schema.fields.length
            });
        }

        return {
            type: 'spatial',
            geojson: { type: 'FeatureCollection', features: enriched },
            schema,
            name: data.name
        };
    }
}

export const ENRICHMENT_NODES = [
    { type: 'add-elevation', label: 'Add Elevation', icon: '⛰️', create: () => new AddElevationNode() }
];
