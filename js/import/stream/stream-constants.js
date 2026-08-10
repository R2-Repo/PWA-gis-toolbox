/**
 * Streaming import tuning constants — dependency-free (shared by worker + main thread).
 *
 * Phase 1 adaptive import:
 *   STORED_FEATURE_SOFT_LIMIT / STREAM_MAX_FEATURES (1M) — Gate B stored unlock + worker abort
 *   MATERIALIZE_FEATURE_LIMIT (250k) — whole-layer RAM / heavy tools (see import-limit-taxonomy.js)
 *   STREAM_MAX_BYTES (2 GB) — SAFETY source-open ceiling
 *
 * @see docs/IMPORT_LARGE_FILES.md (“End-user import gates”)
 */

/**
 * Max source file bytes the stream reader will open (SAFETY).
 */
export const STREAM_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Soft stored-feature ceiling for stream → IndexedDB (Gate B unlock + worker abort).
 * Same value as STORED_FEATURE_SOFT_LIMIT in import-limit-taxonomy.js.
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
