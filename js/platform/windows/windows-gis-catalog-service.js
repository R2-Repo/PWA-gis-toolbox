/**
 * Windows Local GIS Library catalog (Tauri IPC). Sibling to Atlas DB — never merges schemas.
 */
import { invokeCommand } from './tauri-bridge.js';

/**
 * @returns {import('../contracts.js').GisCatalogService}
 */
export function createWindowsGisCatalogService() {
    return {
        async open() {
            return invokeCommand('gis_catalog_open');
        },
        async libraryRoot() {
            return invokeCommand('gis_catalog_library_root');
        },
        async openLibraryFolder() {
            await invokeCommand('gis_catalog_open_library_folder');
        },
        async listItems() {
            return invokeCommand('gis_catalog_list_items');
        },
        async getItem(id) {
            return invokeCommand('gis_catalog_get_item', { id });
        },
        async ingestPath(payload) {
            return invokeCommand('gis_catalog_ingest_path', { payload });
        },
        async touchItem(id) {
            await invokeCommand('gis_catalog_touch_item', { id });
        },
        async removeItem(id, opts = {}) {
            return invokeCommand('gis_catalog_remove_item', {
                id,
                deleteFiles: opts.deleteFiles !== false
            });
        },
        async readPreview(id) {
            return invokeCommand('gis_catalog_read_preview', { id });
        },
        async setWorkingPath(payload) {
            return invokeCommand('gis_catalog_set_working_path', { payload });
        }
    };
}
