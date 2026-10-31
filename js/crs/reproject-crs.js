/**
 * Strict CRS resolution for reprojection — local defs only, no silent WGS84 fallback.
 */
import { AppError, ErrorCategory } from '../core/error-handler.js';
import { getProj4, normalizeCrsCode, resolveCrs } from './registry.js';

/** @typedef {'source' | 'target'} ReprojectCrsSide */

export class CrsReprojectError extends AppError {
    /**
     * @param {string} message
     * @param {{ side: ReprojectCrsSide, crs: string|null|undefined, reason: string }} details
     */
    constructor(message, { side, crs, reason }) {
        super(message, ErrorCategory.VALIDATION_ERROR, { side, crs, reason });
        this.name = 'CrsReprojectError';
    }
}

/**
 * @param {ReprojectCrsSide} side
 * @returns {string}
 */
function sideLabel(side) {
    return side === 'target' ? 'target' : 'source';
}

/**
 * @param {string|null|undefined} raw
 * @param {ReprojectCrsSide} side
 * @returns {string}
 */
export function assertReprojectCrsInput(raw, side) {
    if (raw == null || String(raw).trim() === '') {
        throw new CrsReprojectError(
            `Reprojection ${sideLabel(side)} coordinate system is missing. Choose a CRS from the app's local preset list or register custom WKT.`,
            { side, crs: raw ?? null, reason: 'missing' }
        );
    }
    return normalizeCrsCode(raw);
}

/**
 * Resolve a CRS code through local registry + proj4 defs, or throw.
 * @param {string|null|undefined} raw
 * @param {ReprojectCrsSide} side
 * @returns {Promise<string>}
 */
export async function requireRegisteredReprojectCrs(raw, side) {
    const normalized = assertReprojectCrsInput(raw, side);
    if (normalized === 'UNKNOWN') {
        throw new CrsReprojectError(
            `Reprojection ${sideLabel(side)} coordinate system is unknown. Pick a specific CRS from the local definitions.`,
            { side, crs: normalized, reason: 'unknown' }
        );
    }

    const resolved = await resolveCrs(normalized);
    if (!resolved) {
        throw new CrsReprojectError(
            `Reprojection ${sideLabel(side)} coordinate system "${normalized}" is not recognized locally. Use a preset from the app or register custom WKT — external EPSG lookup is not supported.`,
            { side, crs: normalized, reason: 'unregistered' }
        );
    }

    const proj4 = await getProj4();
    if (!proj4.defs(normalized)) {
        throw new CrsReprojectError(
            `Reprojection ${sideLabel(side)} coordinate system "${normalized}" could not be loaded from local definitions.`,
            { side, crs: normalized, reason: 'unloadable' }
        );
    }

    return normalized;
}

/**
 * @param {number[]} out
 * @param {string} from
 * @param {string} to
 */
export function assertFiniteReprojectOutput(out, from, to) {
    if (!out || out.length < 2 || !Number.isFinite(out[0]) || !Number.isFinite(out[1])) {
        throw new CrsReprojectError(
            `Reprojection produced invalid coordinates while transforming ${from} → ${to}.`,
            { side: 'source', crs: from, reason: 'non_finite' }
        );
    }
}
