/**
 * Windows UDOT Fiber Network SQLite service (Tauri IPC only).
 */
import { invokeCommand } from './tauri-bridge.js';

/**
 * @returns {import('../contracts.js').UdotFiberDbService}
 */
export function createWindowsUdotFiberDbService() {
    return {
        async open() {
            await invokeCommand('udot_fiber_db_open');
        },
        async getSyncMeta() {
            return invokeCommand('udot_fiber_get_sync_meta');
        },
        async setSyncMeta(payload) {
            await invokeCommand('udot_fiber_set_sync_meta', { payload });
        },
        async replaceLayer(payload) {
            return invokeCommand('udot_fiber_replace_layer', { payload });
        },
        async loadLayer(payload) {
            return invokeCommand('udot_fiber_load_layer', { payload });
        },
        async loadAllLayers() {
            return invokeCommand('udot_fiber_load_all_layers');
        }
    };
}
