/**
 * Import dialog entry for Toolbox Kit files.
 * Bypasses handleFileImport's kit path, which closes the import UI before importProjectKit finishes.
 * @param {File|Blob} file
 */
export async function importProjectKitFromFile(file) {
    const { importProjectKit } = await import('../tools/tool-handlers.js');
    return importProjectKit(file);
}

export default { importProjectKitFromFile };
