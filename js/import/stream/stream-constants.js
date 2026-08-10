/**
 * Streaming import tuning constants — dependency-free (shared by worker + main thread).
 *
 * PRODUCT MAX (what may land in the app): 250,000 *stored* features
 * (`MAX_IMPORT_FEATURES` / `STORED_FEATURE_LIMIT`). See docs/IMPORT_LARGE_FILES.md
 * “End-user import gates”.
 *
 * The constants below are SOURCE-READ / WORKER plumbing only — so oversized
 * files are not rejected before the user can filter. Do not describe them as
 * the app’s import max.
 */

/**
 * Max source file bytes the stream reader will open (plumbing, not product max).
 * Filters reduce what is stored; unlock is still ≤ 250k stored features.
 */
export const STREAM_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Worker runaway abort while streaming (plumbing, not product max).
 * Completing import still requires ≤ 250k stored features after reduction.
 */
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
