import { createWindowsFileService } from './windows-file-service.js';
import { createWindowsComputeService } from './windows-compute-service.js';
import { createWindowsJobService } from './windows-job-service.js';
import { invokeCommand, isTauriAvailable } from './tauri-bridge.js';

/**
 * Build capability map from the Rust handshake, with safe defaults.
 * @param {object} [handshake]
 * @returns {import('../contracts.js').PlatformCapabilities}
 */
function capabilitiesFromHandshake(handshake) {
    const fromShell = handshake?.capabilities || {};
    return {
        nativeFiles: fromShell.nativeFiles || {
            available: isTauriAvailable(),
            reason: isTauriAvailable() ? undefined : 'Tauri runtime not detected'
        },
        pythonCompute: fromShell.pythonCompute || {
            available: false,
            reason: 'Python sidecar not packaged yet'
        },
        gpuCompute: fromShell.gpuCompute || {
            available: false,
            reason: 'GPU backend not configured yet'
        },
        localGdal: fromShell.localGdal || {
            available: false,
            reason: 'GDAL not packaged yet'
        },
        localPdal: fromShell.localPdal || {
            available: false,
            reason: 'PDAL not packaged yet'
        },
        largeDatasetProcessing: fromShell.largeDatasetProcessing || {
            available: false,
            reason: 'Large-dataset processing not packaged yet'
        }
    };
}

/**
 * Synchronous Windows platform bundle (nativeFiles available when Tauri is present).
 * Handshake refresh can update capability details asynchronously.
 *
 * @param {{ showToast?: (message: string, type?: string) => void, handshake?: object }} [opts]
 * @returns {import('../contracts.js').PlatformBundle}
 */
export function createWindowsPlatform(opts = {}) {
    const showToast = typeof opts.showToast === 'function'
        ? opts.showToast
        : () => {};

    const jobs = createWindowsJobService();
    const compute = createWindowsComputeService(jobs);

    return {
        platform: {
            runtime: 'windows',
            os: 'windows',
            capabilities: capabilitiesFromHandshake(opts.handshake)
        },
        services: {
            files: createWindowsFileService(),
            compute,
            jobs,
            notifications: {
                show: showToast
            }
        }
    };
}

/**
 * Ask the Rust shell for capability status and return an updated bundle.
 * @param {{ showToast?: (message: string, type?: string) => void }} [opts]
 * @returns {Promise<import('../contracts.js').PlatformBundle>}
 */
export async function createWindowsPlatformWithHandshake(opts = {}) {
    let handshake = null;
    try {
        handshake = await invokeCommand('platform_handshake');
    } catch {
        handshake = null;
    }
    return createWindowsPlatform({ ...opts, handshake });
}
