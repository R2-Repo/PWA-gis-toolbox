/**
 * Display helpers for import_batch metadata rows.
 */

/**
 * @param {{ workbookName?: string|null, atmsName?: string|null }|null|undefined} batch
 * @returns {string}
 */
export function importBatchFileLabel(batch) {
    if (!batch) return '';
    const parts = [batch.workbookName, batch.atmsName].map((s) => String(s || '').trim()).filter(Boolean);
    return parts.join(' + ') || 'Import';
}

/**
 * @param {{ batchDate?: string|null, importedAt?: string|null, workbookName?: string|null, atmsName?: string|null }|null|undefined} batch
 * @returns {{ title: string, files: string }}
 */
export function describeImportBatch(batch) {
    const files = importBatchFileLabel(batch);
    const title = String(batch?.batchDate || '').trim() || files;
    return { title, files };
}
