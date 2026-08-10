/**
 * Import / render / tool limit taxonomy (Phase 1 adaptive import).
 *
 * Every major constant is one of:
 *   ROUTING  — switch strategy (standard vs stream, viewport vs MVT)
 *   SAFETY   — hard stop (quota, zip bomb, source open ceiling)
 *   OPERATION — this working set / tool cannot run
 *   LEGACY   — kept for compatibility; prefer the named aliases above
 *
 * @see docs/IMPORT_LARGE_FILES.md (“End-user import gates”)
 */
import {
    TEXT_SOFT_BYTES,
    TEXT_STRONG_BYTES,
    TEXT_HARD_BYTES,
    BINARY_SOFT_BYTES,
    BINARY_STRONG_BYTES,
    BINARY_HARD_BYTES,
    MAX_IMPORT_FEATURES
} from './import-preflight.js';
import {
    STREAM_MAX_BYTES,
    STREAM_MAX_FEATURES
} from './stream/stream-constants.js';

/** @typedef {'ROUTING'|'SAFETY'|'OPERATION'|'LEGACY'} LimitKind */

/**
 * Full in-memory FeatureCollection / heavy GIS-tool budget.
 * Workspace layers may store more than this; tools that need the whole layer
 * in RAM still refuse above this count.
 */
export const MATERIALIZE_FEATURE_LIMIT = MAX_IMPORT_FEATURES;

/**
 * Working-set coordinate (vertex) budget for heavy GIS tools.
 * Complements feature count — dense geometries can blow RAM under the feature cap.
 */
export const MATERIALIZE_VERTEX_LIMIT = 5_000_000;

/**
 * Single-feature coordinate ceiling for whole-layer materialize.
 * Blocks pathological mega-polygons even when totals look OK.
 */
export const MATERIALIZE_MAX_COORDS_PER_FEATURE = 500_000;

/**
 * Soft ceiling for features stored via stream → IndexedDB (Gate B unlock).
 * Same numeric value as STREAM_MAX_FEATURES by design (Phase 1).
 */
export const STORED_FEATURE_SOFT_LIMIT = STREAM_MAX_FEATURES;

/** Gate A → Gate B file-size routing (text). */
export const GATE_A_TEXT_REJECT_BYTES = TEXT_STRONG_BYTES;

/** Gate A → Gate B file-size routing (binary archives). */
export const GATE_A_BINARY_REJECT_BYTES = BINARY_STRONG_BYTES;

/** Max source bytes the stream reader will open. */
export const SOURCE_OPEN_MAX_BYTES = STREAM_MAX_BYTES;

/**
 * @type {Array<{
 *   id: string,
 *   kind: LimitKind,
 *   value: number,
 *   unit: 'features'|'bytes'|'coordinates',
 *   note: string
 * }>}
 */
export const IMPORT_LIMIT_REGISTRY = [
    {
        id: 'GATE_A_TEXT_SOFT',
        kind: 'ROUTING',
        value: TEXT_SOFT_BYTES,
        unit: 'bytes',
        note: 'Soft warning before standard import'
    },
    {
        id: 'GATE_A_TEXT_REJECT',
        kind: 'ROUTING',
        value: TEXT_STRONG_BYTES,
        unit: 'bytes',
        note: 'Standard path rejects; streamable formats enter Gate B'
    },
    {
        id: 'GATE_A_TEXT_HARD',
        kind: 'ROUTING',
        value: TEXT_HARD_BYTES,
        unit: 'bytes',
        note: 'Legacy hard band (same reject outcome as STRONG for stream partition)'
    },
    {
        id: 'GATE_A_BINARY_SOFT',
        kind: 'ROUTING',
        value: BINARY_SOFT_BYTES,
        unit: 'bytes',
        note: 'Soft warning for archives/spreadsheets'
    },
    {
        id: 'GATE_A_BINARY_REJECT',
        kind: 'ROUTING',
        value: BINARY_STRONG_BYTES,
        unit: 'bytes',
        note: 'Binary Gate A reject → stream when eligible'
    },
    {
        id: 'GATE_A_BINARY_HARD',
        kind: 'ROUTING',
        value: BINARY_HARD_BYTES,
        unit: 'bytes',
        note: 'Legacy hard band for binary formats'
    },
    {
        id: 'GATE_A_IN_MEMORY_FEATURES',
        kind: 'OPERATION',
        value: MAX_IMPORT_FEATURES,
        unit: 'features',
        note: 'Standard in-memory import feature cap'
    },
    {
        id: 'MATERIALIZE_FEATURE_LIMIT',
        kind: 'OPERATION',
        value: MATERIALIZE_FEATURE_LIMIT,
        unit: 'features',
        note: 'Whole-layer materialize / heavy GIS tools'
    },
    {
        id: 'MATERIALIZE_VERTEX_LIMIT',
        kind: 'OPERATION',
        value: MATERIALIZE_VERTEX_LIMIT,
        unit: 'coordinates',
        note: 'Working-set coordinate budget for heavy GIS tools (Phase 5)'
    },
    {
        id: 'MATERIALIZE_MAX_COORDS_PER_FEATURE',
        kind: 'OPERATION',
        value: MATERIALIZE_MAX_COORDS_PER_FEATURE,
        unit: 'coordinates',
        note: 'Single-feature coordinate ceiling for whole-layer materialize'
    },
    {
        id: 'STORED_FEATURE_SOFT_LIMIT',
        kind: 'ROUTING',
        value: STORED_FEATURE_SOFT_LIMIT,
        unit: 'features',
        note: 'Gate B unlock — max features stored in IndexedDB (Phase 1 soft ceiling)'
    },
    {
        id: 'SOURCE_OPEN_MAX_BYTES',
        kind: 'SAFETY',
        value: SOURCE_OPEN_MAX_BYTES,
        unit: 'bytes',
        note: 'Refuse to open sources larger than this for streaming'
    }
];

/**
 * @param {string} id
 * @returns {(typeof IMPORT_LIMIT_REGISTRY)[number]|undefined}
 */
export function getLimitEntry(id) {
    return IMPORT_LIMIT_REGISTRY.find((e) => e.id === id);
}

export default {
    MATERIALIZE_FEATURE_LIMIT,
    MATERIALIZE_VERTEX_LIMIT,
    MATERIALIZE_MAX_COORDS_PER_FEATURE,
    STORED_FEATURE_SOFT_LIMIT,
    GATE_A_TEXT_REJECT_BYTES,
    GATE_A_BINARY_REJECT_BYTES,
    SOURCE_OPEN_MAX_BYTES,
    IMPORT_LIMIT_REGISTRY,
    getLimitEntry
};
