import {
    invokeCommand,
    openNativeDialog,
    saveNativeDialog
} from './tauri-bridge.js';

/**
 * Native Windows file dialogs via Tauri plugin-dialog.
 * @returns {import('../contracts.js').FileService}
 */
export function createWindowsFileService() {
    return {
        async open(opts = {}) {
            const selection = await openNativeDialog({
                multiple: Boolean(opts.multiple),
                directory: false,
                title: opts.title,
                filters: opts.filters
            });
            if (selection == null) return { canceled: true };
            if (Array.isArray(selection)) {
                return { canceled: false, paths: selection, path: selection[0] };
            }
            return { canceled: false, path: selection, paths: [selection] };
        },

        async save(opts = {}) {
            const path = await saveNativeDialog({
                title: opts.title,
                defaultPath: opts.defaultPath,
                filters: opts.filters
            });
            if (path == null) return { canceled: true };
            return { canceled: false, path };
        },

        async selectFolder(opts = {}) {
            const selection = await openNativeDialog({
                directory: true,
                multiple: false,
                title: opts.title
            });
            if (selection == null) return { canceled: true };
            const path = Array.isArray(selection) ? selection[0] : selection;
            return { canceled: false, path };
        },

        async revealInExplorer(path) {
            if (!path) return;
            await invokeCommand('reveal_in_explorer', { path });
        },

        async writeTempGeoJson(contents) {
            return invokeCommand('write_temp_geojson', { contents: String(contents ?? '') });
        },

        async removeTempFile(path) {
            if (!path) return;
            await invokeCommand('remove_temp_file', { path });
        },

        async stat(path) {
            if (!path) throw new Error('stat requires a path');
            return invokeCommand('file_stat', { path });
        }
    };
}
