/**
 * Shared helpers for workflow runs (abort checks, schema copy, dataset output clone).
 */

export function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw new DOMException('Workflow run cancelled', 'AbortError');
    }
}

/** Call inside tight loops; checks abort every `stride` iterations. */
export function throwIfAbortedPeriodic(signal, index, stride = 512) {
    if (index % stride === 0) {
        throwIfAborted(signal);
    }
}

export function cloneSchema(schema) {
    if (schema == null) return schema;
    return structuredClone(schema);
}

/** Shallow dataset copy so downstream nodes cannot mutate cached upstream payloads. */
export function cloneDatasetOutput(dataset) {
    if (dataset == null) return dataset;
    if (dataset.type === 'spatial') {
        const features = dataset.geojson?.features;
        return {
            ...dataset,
            geojson: features
                ? { type: 'FeatureCollection', features: features.slice() }
                : dataset.geojson,
            schema: cloneSchema(dataset.schema)
        };
    }
    if (dataset.type === 'table') {
        return {
            ...dataset,
            rows: Array.isArray(dataset.rows) ? dataset.rows.slice() : dataset.rows,
            schema: cloneSchema(dataset.schema)
        };
    }
    return structuredClone(dataset);
}
