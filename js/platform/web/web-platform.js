import { createWebFileService } from './web-file-service.js';
import { createWebComputeService } from './web-compute-service.js';
import { createWebJobService } from './web-job-service.js';

/**
 * @param {{ showToast?: (message: string, type?: string) => void }} [opts]
 * @returns {import('../contracts.js').PlatformBundle}
 */
export function createWebPlatform(opts = {}) {
    const showToast = typeof opts.showToast === 'function'
        ? opts.showToast
        : () => {};

    return {
        platform: {
            runtime: 'web',
            os: 'browser',
            capabilities: {
                nativeFiles: {
                    available: false,
                    reason: 'Native file dialogs require the Windows desktop application'
                },
                pythonCompute: {
                    available: false,
                    reason: 'Python compute requires the Windows desktop application'
                },
                gpuCompute: {
                    available: false,
                    reason: 'GPU compute requires the Windows desktop application'
                },
                localGdal: {
                    available: false,
                    reason: 'Local GDAL requires the Windows desktop application'
                },
                localPdal: {
                    available: false,
                    reason: 'Local PDAL requires the Windows desktop application'
                },
                largeDatasetProcessing: {
                    available: false,
                    reason: 'Large-dataset processing requires the Windows desktop application'
                }
            }
        },
        services: {
            files: createWebFileService(),
            compute: createWebComputeService(),
            jobs: createWebJobService(),
            notifications: {
                show: showToast
            }
        }
    };
}
