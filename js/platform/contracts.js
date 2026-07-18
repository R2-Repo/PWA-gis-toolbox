/**
 * Platform contracts shared by the public PWA and Windows desktop runtime.
 * Widget engines/controllers must use these shapes via WidgetContext — never import Tauri.
 */

/** @typedef {'web' | 'windows'} GisRuntime */
/** @typedef {'browser' | 'windows'} GisOs */

/**
 * @typedef {Object} CapabilityStatus
 * @property {boolean} available
 * @property {string} [version]
 * @property {string} [reason]
 */

/**
 * @typedef {Object} PlatformCapabilities
 * @property {CapabilityStatus} [nativeFiles]
 * @property {CapabilityStatus} [pythonCompute]
 * @property {CapabilityStatus} [gpuCompute]
 * @property {CapabilityStatus} [localGdal]
 * @property {CapabilityStatus} [localPdal]
 * @property {CapabilityStatus} [largeDatasetProcessing]
 */

/**
 * @typedef {Object} PlatformInfo
 * @property {GisRuntime} runtime
 * @property {GisOs} os
 * @property {PlatformCapabilities} capabilities
 */

/**
 * @typedef {Object} ComputeRunOptions
 * @property {AbortSignal} [signal]
 * @property {(progress: { percent?: number, stage?: string, message?: string }) => void} [onProgress]
 */

/**
 * @typedef {Object} FileService
 * @property {(opts?: object) => Promise<{ canceled: boolean, path?: string, paths?: string[] }>} [open]
 * @property {(opts?: object) => Promise<{ canceled: boolean, path?: string }>} [save]
 * @property {(opts?: object) => Promise<{ canceled: boolean, path?: string }>} [selectFolder]
 * @property {(path: string) => Promise<void>} [revealInExplorer]
 */

/**
 * @typedef {Object} ComputeService
 * @property {(operation: string, input: unknown, opts?: ComputeRunOptions) => Promise<unknown>} run
 */

/**
 * @typedef {Object} JobHandle
 * @property {string} id
 * @property {string} [operation]
 * @property {(cb: (progress: object) => void) => void} onProgress
 * @property {(cb: (message: string) => void) => void} onLog
 * @property {() => void} cancel
 * @property {Promise<unknown>} result
 */

/**
 * @typedef {Object} JobService
 * @property {(opts: { operation: string, input: unknown }) => Promise<JobHandle>} start
 */

/**
 * @typedef {Object} NotificationService
 * @property {(message: string, type?: string) => void} show
 */

/**
 * @typedef {Object} PlatformServices
 * @property {FileService} files
 * @property {ComputeService} compute
 * @property {JobService} jobs
 * @property {NotificationService} notifications
 */

/**
 * @typedef {Object} PlatformBundle
 * @property {PlatformInfo} platform
 * @property {PlatformServices} services
 */

/** Known capability keys used by registry metadata. */
export const CAPABILITY_KEYS = Object.freeze([
    'nativeFiles',
    'pythonCompute',
    'gpuCompute',
    'localGdal',
    'localPdal',
    'largeDatasetProcessing'
]);

/**
 * @param {PlatformInfo} platform
 * @param {string} key
 * @returns {boolean}
 */
export function hasCapability(platform, key) {
    if (!key) return true;
    return Boolean(platform?.capabilities?.[key]?.available);
}

/**
 * @param {PlatformInfo} platform
 * @param {string[] | undefined} required
 * @returns {boolean}
 */
export function hasRequiredCapabilities(platform, required) {
    if (!required?.length) return true;
    return required.every((key) => hasCapability(platform, key));
}

/**
 * @param {PlatformInfo} platform
 * @param {string[] | undefined} optional
 * @returns {string[]}
 */
export function listAvailableOptionalCapabilities(platform, optional) {
    if (!optional?.length) return [];
    return optional.filter((key) => hasCapability(platform, key));
}
