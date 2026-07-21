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
        async listPingSessions(payload = {}) {
            return invokeCommand('atlas_ping_list_sessions', { payload });
        },
        async loadPingSession(payload) {
            return invokeCommand('atlas_ping_load_session', { payload });
        },
        async finalizePingSession(payload) {
            await invokeCommand('atlas_ping_finalize_session', { payload });
        },
        async deletePingSession(payload) {
            await invokeCommand('atlas_ping_delete_session', { payload });
        },
        async deletePingSessions(payload) {
            return invokeCommand('atlas_ping_delete_sessions', { payload });
        },
        async getPref(payload) {
            return invokeCommand('atlas_pref_get', { payload });
        },
        async getAllPrefs() {
            return invokeCommand('atlas_pref_get_all');
        },
        async setPref(payload) {
            await invokeCommand('atlas_pref_set', { payload });
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
