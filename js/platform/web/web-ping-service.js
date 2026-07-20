/**
 * Web stub — ICMP ping unavailable in the PWA.
 */

function unavailable() {
    return Promise.reject(new Error('ICMP ping requires the Windows desktop application'));
}

/**
 * @returns {import('../contracts.js').PingService}
 */
export function createWebPingService() {
    return {
        pingOne: unavailable,
        pingMany: unavailable,
        cancel: async () => {}
    };
}
