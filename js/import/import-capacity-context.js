/**
 * Phase 4 — device + project capacity context for adaptive import.
 *
 * Separate pressures (never one mystery score):
 *   device: heap / storage / cores
 *   project: feature / storage / memory-resident
 *   modifiers: may only *tighten* soft ceilings (never raise taxonomy max)
 *
 * @see docs/IMPORT_LARGE_FILES.md
 * @see js/import/import-limit-taxonomy.js
 */
import { getLayerFeatureCount, isWorkspaceLayer } from '../core/data-model.js';
import { getBrowserHeapInfo } from './import-memory-budget.js';
import {
    MATERIALIZE_FEATURE_LIMIT,
    MATERIALIZE_VERTEX_LIMIT,
    STORED_FEATURE_SOFT_LIMIT
} from './import-limit-taxonomy.js';
import { getStorageQuotaSummary } from '../workspace/storage-summary.js';
import { hasStorageHeadroom } from '../workspace/source-file-store.js';

/** Project feature-count bands (sum across open layers). */
export const PROJECT_FEATURE_MODERATE = 250_000;
export const PROJECT_FEATURE_HIGH = 750_000;

/** Storage usageRatio bands. */
export const STORAGE_RATIO_MODERATE = 0.55;
export const STORAGE_RATIO_HIGH = 0.78;

/** Heap used/limit bands (when performance.memory exists). */
export const HEAP_RATIO_MODERATE = 0.55;
export const HEAP_RATIO_HIGH = 0.75;

/** In-memory (non-workspace) feature bands. */
export const RESIDENT_FEATURE_MODERATE = 50_000;
export const RESIDENT_FEATURE_HIGH = 150_000;

/**
 * @returns {{
 *   heap: { available: number, used: number, limit: number, usedRatio: number }|null,
 *   cores: number|null,
 *   deviceMemoryGb: number|null
 * }}
 */
export function gatherDeviceProfileSync() {
    const heapRaw = getBrowserHeapInfo();
    const heap = heapRaw
        ? {
            available: heapRaw.available,
            used: heapRaw.used,
            limit: heapRaw.limit,
            usedRatio: heapRaw.limit > 0 ? heapRaw.used / heapRaw.limit : 0
        }
        : null;

    const cores = typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
        ? navigator.hardwareConcurrency
        : null;

    const deviceMemoryGb = typeof navigator !== 'undefined'
        && Number.isFinite(/** @type {any} */ (navigator).deviceMemory)
        ? /** @type {any} */ (navigator).deviceMemory
        : null;

    return { heap, cores, deviceMemoryGb };
}

/**
 * @param {object[]} [layers]
 * @returns {{
 *   layerCount: number,
 *   workspaceLayerCount: number,
 *   totalFeatures: number,
 *   residentFeatures: number,
 *   feature: 'low'|'moderate'|'high',
 *   memoryResident: 'low'|'moderate'|'high'
 * }}
 */
export function gatherProjectPressure(layers = []) {
    const list = Array.isArray(layers) ? layers.filter(Boolean) : [];
    let totalFeatures = 0;
    let residentFeatures = 0;
    let workspaceLayerCount = 0;

    for (const layer of list) {
        const count = getLayerFeatureCount(layer) || 0;
        totalFeatures += count;
        if (isWorkspaceLayer(layer)) {
            workspaceLayerCount++;
        } else {
            residentFeatures += count;
        }
    }

    /** @type {'low'|'moderate'|'high'} */
    let feature = 'low';
    if (totalFeatures >= PROJECT_FEATURE_HIGH) feature = 'high';
    else if (totalFeatures >= PROJECT_FEATURE_MODERATE) feature = 'moderate';

    /** @type {'low'|'moderate'|'high'} */
    let memoryResident = 'low';
    if (residentFeatures >= RESIDENT_FEATURE_HIGH) memoryResident = 'high';
    else if (residentFeatures >= RESIDENT_FEATURE_MODERATE) memoryResident = 'moderate';

    return {
        layerCount: list.length,
        workspaceLayerCount,
        totalFeatures,
        residentFeatures,
        feature,
        memoryResident
    };
}

/**
 * @param {{ usageRatio?: number }} storage
 * @returns {'low'|'moderate'|'high'}
 */
export function storagePressureFromRatio(usageRatio = 0) {
    if (usageRatio >= STORAGE_RATIO_HIGH) return 'high';
    if (usageRatio >= STORAGE_RATIO_MODERATE) return 'moderate';
    return 'low';
}

/**
 * @param {{ heap?: { usedRatio?: number }|null }} device
 * @returns {'low'|'moderate'|'high'|'unknown'}
 */
export function heapPressureFromDevice(device = {}) {
    const ratio = device.heap?.usedRatio;
    if (ratio == null || !Number.isFinite(ratio)) return 'unknown';
    if (ratio >= HEAP_RATIO_HIGH) return 'high';
    if (ratio >= HEAP_RATIO_MODERATE) return 'moderate';
    return 'low';
}

/**
 * Soft-ceiling modifiers — only tighten taxonomy maxima.
 * @param {{
 *   device?: ReturnType<typeof gatherDeviceProfileSync> & { storage?: object, heapPressure?: string },
 *   project?: ReturnType<typeof gatherProjectPressure> & { storage?: string }
 * }} input
 */
export function computeCapacityModifiers(input = {}) {
    const device = input.device || {};
    const project = input.project || {};

    let storedFeatureSoftLimit = STORED_FEATURE_SOFT_LIMIT;
    let materializeFeatureLimit = MATERIALIZE_FEATURE_LIMIT;
    let materializeVertexLimit = MATERIALIZE_VERTEX_LIMIT;
    /** Extra multiplier applied to source bytes for quota headroom checks. */
    let streamStorageMultiplier = 2;
    /** @type {string[]} */
    const reasons = [];

    const storagePressure = project.storage
        || storagePressureFromRatio(device.storage?.usageRatio || 0);
    const heapPressure = device.heapPressure || heapPressureFromDevice(device);
    const projectFeature = project.feature || 'low';
    const resident = project.memoryResident || 'low';

    if (storagePressure === 'high') {
        storedFeatureSoftLimit = Math.min(storedFeatureSoftLimit, 400_000);
        materializeFeatureLimit = Math.min(materializeFeatureLimit, 100_000);
        materializeVertexLimit = Math.min(materializeVertexLimit, 2_000_000);
        streamStorageMultiplier = Math.max(streamStorageMultiplier, 3);
        reasons.push('storage_high');
    } else if (storagePressure === 'moderate') {
        storedFeatureSoftLimit = Math.min(storedFeatureSoftLimit, 700_000);
        materializeFeatureLimit = Math.min(materializeFeatureLimit, 175_000);
        materializeVertexLimit = Math.min(materializeVertexLimit, 3_500_000);
        streamStorageMultiplier = Math.max(streamStorageMultiplier, 2.5);
        reasons.push('storage_moderate');
    }

    if (heapPressure === 'high') {
        materializeFeatureLimit = Math.min(materializeFeatureLimit, 80_000);
        materializeVertexLimit = Math.min(materializeVertexLimit, 1_000_000);
        storedFeatureSoftLimit = Math.min(storedFeatureSoftLimit, 500_000);
        reasons.push('heap_high');
    } else if (heapPressure === 'moderate') {
        materializeFeatureLimit = Math.min(materializeFeatureLimit, 150_000);
        materializeVertexLimit = Math.min(materializeVertexLimit, 2_500_000);
        reasons.push('heap_moderate');
    }

    if (projectFeature === 'high') {
        storedFeatureSoftLimit = Math.min(storedFeatureSoftLimit, 500_000);
        materializeFeatureLimit = Math.min(materializeFeatureLimit, 120_000);
        materializeVertexLimit = Math.min(materializeVertexLimit, 2_500_000);
        reasons.push('project_features_high');
    } else if (projectFeature === 'moderate') {
        storedFeatureSoftLimit = Math.min(storedFeatureSoftLimit, 800_000);
        materializeFeatureLimit = Math.min(materializeFeatureLimit, 200_000);
        materializeVertexLimit = Math.min(materializeVertexLimit, 4_000_000);
        reasons.push('project_features_moderate');
    }

    if (resident === 'high') {
        materializeFeatureLimit = Math.min(materializeFeatureLimit, 100_000);
        materializeVertexLimit = Math.min(materializeVertexLimit, 1_500_000);
        reasons.push('resident_memory_high');
    } else if (resident === 'moderate') {
        materializeFeatureLimit = Math.min(materializeFeatureLimit, 175_000);
        materializeVertexLimit = Math.min(materializeVertexLimit, 3_000_000);
        reasons.push('resident_memory_moderate');
    }

    // Low-core / low-RAM devices: modest further tighten on materialize only.
    if (device.cores != null && device.cores > 0 && device.cores <= 4) {
        materializeFeatureLimit = Math.min(materializeFeatureLimit, 150_000);
        materializeVertexLimit = Math.min(materializeVertexLimit, 2_500_000);
        reasons.push('low_core_count');
    }
    if (device.deviceMemoryGb != null && device.deviceMemoryGb > 0 && device.deviceMemoryGb <= 4) {
        materializeFeatureLimit = Math.min(materializeFeatureLimit, 120_000);
        materializeVertexLimit = Math.min(materializeVertexLimit, 2_000_000);
        storedFeatureSoftLimit = Math.min(storedFeatureSoftLimit, 600_000);
        reasons.push('low_device_memory');
    }

    return {
        storedFeatureSoftLimit: Math.max(50_000, Math.floor(storedFeatureSoftLimit)),
        materializeFeatureLimit: Math.max(25_000, Math.floor(materializeFeatureLimit)),
        materializeVertexLimit: Math.max(250_000, Math.floor(materializeVertexLimit)),
        streamStorageMultiplier,
        taxonomyStoredSoftLimit: STORED_FEATURE_SOFT_LIMIT,
        taxonomyMaterializeLimit: MATERIALIZE_FEATURE_LIMIT,
        taxonomyMaterializeVertexLimit: MATERIALIZE_VERTEX_LIMIT,
        tightened: reasons.length > 0,
        reasons
    };
}

/**
 * Full async capacity snapshot for import / stream / tools.
 * @param {{ layers?: object[], extraBytes?: number }} [options]
 */
export async function getImportCapacityContext(options = {}) {
    const layers = options.layers || [];
    const extraBytes = Math.max(0, Number(options.extraBytes) || 0);

    const deviceSync = gatherDeviceProfileSync();
    const storage = await getStorageQuotaSummary();
    const projectBase = gatherProjectPressure(layers);
    const storagePressure = storagePressureFromRatio(storage.usageRatio);
    const heapPressure = heapPressureFromDevice(deviceSync);

    const device = {
        ...deviceSync,
        storage,
        heapPressure,
        storagePressure
    };
    const project = {
        ...projectBase,
        storage: storagePressure
    };
    const modifiers = computeCapacityModifiers({ device, project });

    let headroomOk = true;
    if (extraBytes > 0) {
        const need = Math.ceil(extraBytes * modifiers.streamStorageMultiplier);
        headroomOk = await hasStorageHeadroom(need);
    }

    return {
        version: 1,
        device,
        project,
        modifiers,
        headroomOk,
        computedAt: new Date().toISOString()
    };
}

/**
 * Preflight for streaming import — SAFETY deny + soft capacity warnings.
 * @param {{ files?: File[], layers?: object[] }} input
 * @returns {Promise<{
 *   ok: boolean,
 *   denyReason?: string,
 *   warnings: string[],
 *   capacity: Awaited<ReturnType<typeof getImportCapacityContext>>
 * }>}
 */
export async function assessStreamCapacity(input = {}) {
    const files = Array.isArray(input.files) ? input.files.filter(Boolean) : [];
    const layers = input.layers || [];
    const totalSourceBytes = files.reduce((sum, f) => sum + (f?.size || 0), 0);
    const capacity = await getImportCapacityContext({
        layers,
        extraBytes: totalSourceBytes
    });

    const warnings = [];
    if (!capacity.headroomOk) {
        return {
            ok: false,
            denyReason: 'Not enough browser storage for this import. Free space in Storage settings, or import a smaller subset.',
            warnings,
            capacity
        };
    }

    if (capacity.project.storage === 'high' || capacity.device.storagePressure === 'high') {
        warnings.push('Browser storage is nearly full — consider removing unused preserved sources before large imports.');
    }
    if (capacity.project.feature === 'high') {
        warnings.push('This project already holds a large number of features — new imports may slow the map.');
    }
    if (capacity.device.heapPressure === 'high') {
        warnings.push('This browser tab is using a lot of memory — close other tabs or restart before importing more.');
    }
    if (capacity.modifiers.tightened) {
        warnings.push(
            `Capacity safeguards tightened store unlock to ${capacity.modifiers.storedFeatureSoftLimit.toLocaleString()} features for this session.`
        );
    }

    return { ok: true, warnings, capacity };
}

/**
 * Sync materialize limit for tools (project-aware; no storage async).
 * @param {object[]} [layers]
 */
export function getAdaptiveMaterializeLimit(layers = []) {
    return getAdaptiveMaterializeLimits(layers).featureLimit;
}

/**
 * Sync feature + vertex materialize limits (Phase 5).
 * @param {object[]} [layers]
 * @returns {{ featureLimit: number, vertexLimit: number }}
 */
export function getAdaptiveMaterializeLimits(layers = []) {
    const device = gatherDeviceProfileSync();
    const project = gatherProjectPressure(layers);
    const modifiers = computeCapacityModifiers({ device, project });
    return {
        featureLimit: modifiers.materializeFeatureLimit,
        vertexLimit: modifiers.materializeVertexLimit
    };
}

/**
 * Sync stored soft limit for Gate B UI when async context is unavailable.
 * @param {object[]} [layers]
 */
export function getAdaptiveStoredSoftLimit(layers = []) {
    const device = gatherDeviceProfileSync();
    const project = gatherProjectPressure(layers);
    return computeCapacityModifiers({ device, project }).storedFeatureSoftLimit;
}

export default {
    gatherDeviceProfileSync,
    gatherProjectPressure,
    storagePressureFromRatio,
    heapPressureFromDevice,
    computeCapacityModifiers,
    getImportCapacityContext,
    assessStreamCapacity,
    getAdaptiveMaterializeLimit,
    getAdaptiveMaterializeLimits,
    getAdaptiveStoredSoftLimit
};
