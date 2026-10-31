/**
 * Streaming import tuning constants — dependency-free (shared by worker + main thread).
 * Numeric values re-export from import-limits.js.
 */
import { LIMITS } from '../import-limits.js';

export const STREAM_MAX_BYTES = LIMITS.streamMaxBytes;
export const STREAM_MAX_FEATURES = LIMITS.storedFeatureSoftLimit;
export const STREAM_BATCH_FEATURES = LIMITS.streamBatchFeatures;
export const STREAM_BATCH_MAX_BYTES = LIMITS.streamBatchMaxBytes;

export default {
    STREAM_MAX_BYTES,
    STREAM_MAX_FEATURES,
    STREAM_BATCH_FEATURES,
    STREAM_BATCH_MAX_BYTES
};
