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

/**
 * Progress + abort helper for workflow node loops.
 * @param {object} context execute context
 * @param {number} total item count
 * @param {{ minIntervalMs?: number, abortStride?: number }} [opts]
 */
export function createLoopProgress(context, total, opts = {}) {
    const minIntervalMs = opts.minIntervalMs ?? 100;
    const abortStride = opts.abortStride ?? 64;
    let lastReportAt = 0;

    return (index, message) => {
        throwIfAbortedPeriodic(context?.signal, index, abortStride);
        if (!context?.reportProgress || total <= 0) return;
        const now = performance.now();
        const isLast = index >= total - 1;
        if (!isLast && now - lastReportAt < minIntervalMs && index % abortStride !== 0) return;
        lastReportAt = now;
        context.reportProgress({
            progress: (index + 1) / total,
            processed: index + 1,
            total,
            message
        });
    };
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
