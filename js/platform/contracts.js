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
 * @property {CapabilityStatus} [localSqlite]
 * @property {CapabilityStatus} [icmpPing]
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
 * @property {(contents: string) => Promise<string>} [writeTempGeoJson]
 * @property {(path: string) => Promise<void>} [removeTempFile]
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
 * Abstract handle for the Dual Screen secondary map window.
 * Web uses a browser Window; Windows uses a Tauri WebviewWindow.
 *
 * @typedef {Object} MapWindowHandle
 * @property {boolean} closed
 * @property {() => void | Promise<void>} focus
 * @property {() => void | Promise<void>} close
 */

/**
 * @typedef {Object} OpenMapWindowOptions
 * @property {string} url - Relative app URL (e.g. map-window.html)
 * @property {string} [name] - Browser window name
 * @property {string} [label] - Tauri webview label
 * @property {string} [features] - window.open features string (web)
 * @property {{ width: number, height: number, x?: number, y?: number }} [bounds]
 * @property {string} [title]
 */

/**
 * @typedef {Object} WindowService
 * @property {(opts: OpenMapWindowOptions) => Promise<MapWindowHandle | null>} openMapWindow
 */

/**
 * @typedef {Object} DatabaseService
 * @property {() => Promise<void>} open
 * @property {() => Promise<object>} loadSnapshot
 * @property {(payload: object) => Promise<object>} applyImport
 * @property {(payload: object) => Promise<void>} [savePingResults]
 * @property {(payload?: { limit?: number, includeOneShot?: boolean }) => Promise<{ sessions: object[] }>} [listPingSessions]
 * @property {(payload: { sessionId: string, limit?: number }) => Promise<{ session: object, results: object[] }>} [loadPingSession]
 * @property {(payload: { sessionId: string, stoppedAt?: string }) => Promise<void>} [finalizePingSession]
 * @property {(payload: { key: string }) => Promise<{ key: string, value: string|null }>} [getPref]
 * @property {() => Promise<{ prefs: Record<string, string|null> }>} [getAllPrefs]
 * @property {(payload: { key: string, value: string|number|null }) => Promise<void>} [setPref]
 * @property {(findingId: string, patch: object) => Promise<void>} [updateFinding]
 * @property {() => Promise<{ path: string }>} [ensureImportInbox]
 * @property {() => Promise<void>} [openImportInbox]
 * @property {() => Promise<{ path: string, files: object[] }>} [listImportInbox]
 * @property {(path: string) => Promise<{ name: string, path: string, ext: string, base64: string }>} [readImportFile]
 */

/**
 * @typedef {Object} PingResult
 * @property {string} ip
 * @property {'reachable'|'unreachable'|'warning'} status
 * @property {number|null} [rttMs]
 * @property {string} [error]
 */

/**
 * @typedef {Object} PingService
 * @property {(ip: string, opts?: { timeoutMs?: number }) => Promise<PingResult>} pingOne
 * @property {(ips: string[], opts?: { timeoutMs?: number, concurrency?: number }) => Promise<PingResult[]>} pingMany
 * @property {(sessionId: string) => Promise<void>} [cancel]
 */

/**
 * @typedef {Object} PlatformServices
 * @property {FileService} files
 * @property {ComputeService} compute
 * @property {JobService} jobs
 * @property {NotificationService} notifications
 * @property {WindowService} [windows]
 * @property {DatabaseService} [atlasDb]
 * @property {PingService} [ping]
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
    'largeDatasetProcessing',
    'localSqlite',
    'icmpPing'
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
