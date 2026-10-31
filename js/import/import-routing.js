/**
 * Decide standard vs optimizer import route based on crash-risk signals (not file size alone).
 */
import { detectFormat } from './importer.js';
import { formatBytes, preflightFile } from './import-preflight.js';
import {
    estimateImportPeakBytes,
    sniffCoordinateCountEstimate,
    sniffFeatureCountEstimate
} from './import-memory-budget.js';
import { LIMITS } from './import-limits.js';
import { decideAdmission } from './import-admission.js';

/** Estimated peak memory above this → Import Optimizer (below 24 MB reject). */
export const OPTIMIZER_PEAK_BYTES = LIMITS.optimizerPeakBytes;

/** Coordinate sniff above this → Optimizer (below 2M reject). */
export const OPTIMIZER_COORDINATE_THRESHOLD = LIMITS.optimizerCoordinateThreshold;

/** KMZ/KML file size above this may suggest heavy embedded assets. */
export const KML_HEAVY_BYTES = LIMITS.kmlHeavyBytes;

export const WORKSPACE_FEATURE_THRESHOLD = LIMITS.workspaceFeatureThreshold;

export const ROUTE_REASON = {
    FEATURE_COUNT: 'feature_count',
    PEAK_MEMORY: 'peak_memory',
    COORDINATE_DENSITY: 'coordinate_density',
    KML_HEAVY: 'kml_heavy'
};

const KML_FORMATS = new Set(['kml', 'kmz', 'xml']);

function _isKmlFamily(format) {
    return format != null && KML_FORMATS.has(format);
}

/**
 * Assess one file using optional precomputed scan row.
 * @param {File} file
 * @param {object|null} scan
 * @returns {Promise<{ reasons: string[], featureEstimate: number|null, peakBytes: number, useWorkspace: boolean, admission: ReturnType<typeof decideAdmission> }>}
 */
export async function assessFileImportRisk(file, scan = null) {
    const format = scan?.format ?? detectFormat(file);
    const featureEstimate = scan?.featureEstimate ?? await sniffFeatureCountEstimate(file);
    const peakBytes = scan?.estimatedPeakBytes ?? estimateImportPeakBytes(file);
    const reasons = [];

    if (featureEstimate != null && featureEstimate >= WORKSPACE_FEATURE_THRESHOLD) {
        reasons.push(ROUTE_REASON.FEATURE_COUNT);
    }
    if (peakBytes >= OPTIMIZER_PEAK_BYTES) {
        reasons.push(ROUTE_REASON.PEAK_MEMORY);
    }

    const coordEstimate = scan?.coordinateEstimate ?? await sniffCoordinateCountEstimate(file);
    if (coordEstimate != null && coordEstimate >= OPTIMIZER_COORDINATE_THRESHOLD) {
        reasons.push(ROUTE_REASON.COORDINATE_DENSITY);
    }

    if (_isKmlFamily(format) && (file.size ?? 0) >= KML_HEAVY_BYTES) {
        reasons.push(ROUTE_REASON.KML_HEAVY);
    }

    const preflight = preflightFile(file, { format });
    const admission = decideAdmission({
        entry: 'file',
        format,
        files: [{
            name: file.name,
            format,
            bytes: file.size ?? 0,
            featureEstimate
        }],
        overPreflightReject: preflight.level === 'reject',
        streamEligible: null
    });

    const useWorkspace = admission.useWorkspace;

    return { reasons, featureEstimate, peakBytes, useWorkspace, format, admission };
}

/**
 * @param {File[]} files
 * @param {{ scans?: Array<object> }} [options]
 */
export async function assessImportRoute(files, options = {}) {
    const scans = options.scans || [];
    const scanByName = new Map(scans.map((s) => [s.fileName, s]));

    const fileRisks = [];
    const allReasons = new Set();

    for (const file of files || []) {
        const scan = scanByName.get(file.name) || null;
        const risk = await assessFileImportRisk(file, scan);
        fileRisks.push({ fileName: file.name, ...risk });
        for (const r of risk.reasons) allReasons.add(r);
    }

    const reasons = [...allReasons];
    const route = reasons.length > 0 ? 'optimizer' : 'standard';
    const useWorkspace = fileRisks.some((r) => r.useWorkspace);

    const admission = decideAdmission({
        entry: 'file',
        files: (files || []).map((file, i) => {
            const risk = fileRisks[i];
            return {
                name: file.name,
                format: risk?.format ?? detectFormat(file),
                bytes: file.size ?? 0,
                featureEstimate: risk?.featureEstimate ?? null
            };
        })
    });

    return {
        route,
        reasons,
        useWorkspace: admission.useWorkspace || useWorkspace,
        showProgressNotice: route === 'optimizer' && (admission.useWorkspace || useWorkspace),
        fileRisks,
        admission
    };
}

export function shouldConvertToWorkspace(featureCount, importOpts = {}) {
    if (importOpts.useWorkspace === true) return true;
    const admission = decideAdmission({
        entry: 'file',
        featureCount: featureCount ?? 0
    });
    return admission.useWorkspace;
}

export function arcgisShouldUseWorkspace(totalCount, queryOpts = {}) {
    const admission = decideAdmission({
        entry: 'arcgis-rest',
        featureCount: totalCount,
        spatialFilter: queryOpts.spatialFilter,
        returnGeometry: true,
        allowLargeDownload: queryOpts.allowLargeDownload
    });
    return admission.useWorkspace;
}

export function assessImportRouteFromScans(scans) {
    const reasons = new Set();
    let useWorkspace = false;

    for (const scan of scans || []) {
        const feat = scan.featureEstimate;
        if (feat != null && feat >= WORKSPACE_FEATURE_THRESHOLD) {
            reasons.add(ROUTE_REASON.FEATURE_COUNT);
            useWorkspace = true;
        }
        const peak = scan.estimatedPeakBytes ?? 0;
        if (peak >= OPTIMIZER_PEAK_BYTES) reasons.add(ROUTE_REASON.PEAK_MEMORY);
        const coord = scan.coordinateEstimate;
        if (coord != null && coord >= OPTIMIZER_COORDINATE_THRESHOLD) {
            reasons.add(ROUTE_REASON.COORDINATE_DENSITY);
        }
        if (_isKmlFamily(scan.format) && (scan.sizeBytes ?? 0) >= KML_HEAVY_BYTES) {
            reasons.add(ROUTE_REASON.KML_HEAVY);
        }
    }

    const reasonList = [...reasons];
    const route = reasonList.length > 0 ? 'optimizer' : 'standard';

    const admission = decideAdmission({
        entry: 'file',
        files: (scans || []).map((scan) => ({
            name: scan.fileName,
            format: scan.format,
            bytes: scan.sizeBytes,
            featureEstimate: scan.featureEstimate
        }))
    });

    return {
        route,
        reasons: reasonList,
        useWorkspace: admission.useWorkspace || useWorkspace,
        showProgressNotice: route === 'optimizer' && (admission.useWorkspace || useWorkspace),
        admission
    };
}

export default {
    OPTIMIZER_PEAK_BYTES,
    OPTIMIZER_COORDINATE_THRESHOLD,
    KML_HEAVY_BYTES,
    WORKSPACE_FEATURE_THRESHOLD,
    ROUTE_REASON,
    assessFileImportRisk,
    assessImportRoute,
    assessImportRouteFromScans,
    shouldConvertToWorkspace,
    arcgisShouldUseWorkspace
};
