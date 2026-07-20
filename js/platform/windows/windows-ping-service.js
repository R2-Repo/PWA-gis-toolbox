/**
 * Windows ICMP ping service (Tauri IPC).
 */
import { invokeCommand } from './tauri-bridge.js';

/**
 * @returns {import('../contracts.js').PingService}
 */
export function createWindowsPingService() {
    return {
        async pingOne(ip, opts = {}) {
            return invokeCommand('atlas_ping_one', {
                ip,
                timeoutMs: opts.timeoutMs ?? 2000
            });
        },
        async pingMany(ips, opts = {}) {
            return invokeCommand('atlas_ping_many', {
                ips,
                timeoutMs: opts.timeoutMs ?? 2000,
                concurrency: opts.concurrency ?? 8
            });
        },
        async cancel(sessionId) {
            await invokeCommand('atlas_ping_cancel', { sessionId });
        }
    };
}
