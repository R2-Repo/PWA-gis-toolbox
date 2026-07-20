/**
 * Windows Atlas SQLite service (Tauri IPC only).
 */
import { invokeCommand } from './tauri-bridge.js';

/**
 * @returns {import('../contracts.js').DatabaseService}
 */
export function createWindowsAtlasDbService() {
    return {
        async open() {
            await invokeCommand('atlas_db_open');
        },
        async loadSnapshot() {
            return invokeCommand('atlas_db_load_snapshot');
        },
        async applyImport(payload) {
            return invokeCommand('atlas_import_apply', { payload });
        },
        async savePingResults(payload) {
            await invokeCommand('atlas_ping_save', { payload });
        },
        async updateFinding(findingId, patch) {
            await invokeCommand('atlas_finding_update', { findingId, patch });
        },
        async ensureImportInbox() {
            return invokeCommand('atlas_import_inbox_ensure');
        },
        async openImportInbox() {
            await invokeCommand('atlas_import_inbox_open');
        },
        async listImportInbox() {
            return invokeCommand('atlas_import_inbox_list');
        },
        async readImportFile(path) {
            return invokeCommand('atlas_import_read_file', { path });
        }
    };
}
