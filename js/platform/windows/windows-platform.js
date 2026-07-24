import { createWindowsFileService } from './windows-file-service.js';
import { createWindowsComputeService } from './windows-compute-service.js';
import { createWindowsJobService } from './windows-job-service.js';
import { createWindowsWindowService } from './windows-window-service.js';
import { createWindowsAtlasDbService } from './windows-atlas-db-service.js';
import { createWindowsUdotFiberDbService } from './windows-udot-fiber-db-service.js';
import { createWindowsPingService } from './windows-ping-service.js';
import { createWindowsGisCatalogService } from './windows-gis-catalog-service.js';
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
            reason: 'Install sidecar GIS deps (pyogrio)'
        },
        localPdal: fromShell.localPdal || {
            available: false,
            reason: 'PDAL not packaged yet'
        },
        duckdb: fromShell.duckdb || {
            available: false,
            reason: 'Install sidecar DuckDB deps'
        },
        largeDatasetProcessing: fromShell.largeDatasetProcessing || {
            // Path import works once the shell is present; sidecar handshake may refine this.
            available: isTauriAvailable(),
            reason: isTauriAvailable()
                ? undefined
                : 'Large-dataset processing requires the Windows desktop app'
        },
        gisLibrary: fromShell.gisLibrary || {
            available: isTauriAvailable(),
            reason: isTauriAvailable() ? undefined : 'Tauri runtime not detected'
        },
        localMartin: fromShell.localMartin || {
            available: false,
            reason: 'Martin deferred — use file-based PMTiles'
        },
        localSqlite: fromShell.localSqlite || {
            available: isTauriAvailable(),
            reason: isTauriAvailable() ? undefined : 'Tauri runtime not detected'
        },
        icmpPing: fromShell.icmpPing || {
            available: isTauriAvailable(),
            reason: isTauriAvailable() ? undefined : 'Tauri runtime not detected'
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
            windows: createWindowsWindowService(),
            atlasDb: createWindowsAtlasDbService(),
            udotFiberDb: createWindowsUdotFiberDbService(),
            ping: createWindowsPingService(),
            gisCatalog: createWindowsGisCatalogService(),
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
