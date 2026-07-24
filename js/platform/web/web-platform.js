import { createWebFileService } from './web-file-service.js';
import { createWebComputeService } from './web-compute-service.js';
import { createWebJobService } from './web-job-service.js';
import { createWebWindowService } from './web-window-service.js';

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
            capabilities: {}
        },
        services: {
            files: createWebFileService(),
            compute: createWebComputeService(),
            jobs: createWebJobService(),
            windows: createWebWindowService(),
            notifications: {
                show: showToast
            }
        }
    };
}
