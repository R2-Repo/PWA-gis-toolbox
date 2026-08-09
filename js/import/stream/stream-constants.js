/**
 * Streaming import tuning constants — dependency-free (shared by worker + main thread).
 */

/** Hard per-file ceiling for streaming imports. */
export const STREAM_MAX_BYTES = 512 * 1024 * 1024;

/** Hard per-file feature ceiling for streaming imports. */
export const STREAM_MAX_FEATURES = 1_000_000;

/** Features per worker batch — matches WORKSPACE_CHUNK_SIZE so each batch is one chunk. */
export const STREAM_BATCH_FEATURES = 1000;

/** Flush a batch early when its estimated JSON size passes this (dense geometries). */
export const STREAM_BATCH_MAX_BYTES = 8 * 1024 * 1024;

export default {
    STREAM_MAX_BYTES,
    STREAM_MAX_FEATURES,
    STREAM_BATCH_FEATURES,
    STREAM_BATCH_MAX_BYTES
};
