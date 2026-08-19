/**
 * Folder export via the File System Access API (Chromium).
 * Writes one file at a time so large sheet runs do not accumulate in memory.
 */

/**
 * @returns {boolean}
 */
export function isFolderExportSupported() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/**
 * @param {string} [message]
 * @returns {never}
 */
function throwUnsupported(message) {
    throw new Error(
        message || 'Folder export requires Chrome or Edge. Choose a folder when prompted to save each PDF as it is rendered.'
    );
}

/**
 * Prompt the user to pick a writable output folder.
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function pickExportFolder() {
    if (!isFolderExportSupported()) {
        throwUnsupported();
    }
    try {
        return await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw new Error('Folder export cancelled.');
        }
        throw err;
    }
}

/**
 * Keep the display name intact (including spaces). Only replace characters
 * that Windows / the File System Access API reject in a file name.
 *
 * @param {string} name
 * @returns {string}
 */
export function sanitizeExportFilename(name) {
    return String(name || 'export')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^\.+/, '')
        .replace(/[. ]+$/, '')
        .slice(0, 120) || 'export';
}

/**
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} filename
 * @param {Blob} blob
 */
export async function writeBlobToFolder(dirHandle, filename, blob) {
    if (!dirHandle) {
        throw new Error('No export folder selected.');
    }
    const safeName = sanitizeExportFilename(filename);
    const fileHandle = await dirHandle.getFileHandle(safeName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
}
