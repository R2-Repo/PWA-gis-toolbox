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

/**
 * Compact summary persisted with each apply (counts + diff counts only — no IP lists).
 * @param {object|null|undefined} summary
 * @param {object|null|undefined} [diff] full diff from diffAtlasImport, or null
 * @returns {object}
 */
export function compactImportBatchSummary(summary, diff = null) {
    const counts = summary?.counts || null;
    const diffCounts = diff?.counts || (summary?.diff && typeof summary.diff === 'object' ? summary.diff : null);
    return {
        batchDate: summary?.batchDate ?? null,
        importedAt: summary?.importedAt ?? null,
        workbookName: summary?.workbookName ?? null,
        atmsName: summary?.atmsName ?? null,
        hubListName: summary?.hubListName ?? null,
        counts: counts
            ? {
                hubs: Number(counts.hubs) || 0,
                hubsOfficial: Number(counts.hubsOfficial) || 0,
                hubsInferred: Number(counts.hubsInferred) || 0,
                channels: Number(counts.channels) || 0,
                sites: Number(counts.sites) || 0,
                drops: Number(counts.drops) || 0,
                devices: Number(counts.devices) || 0,
                findings: Number(counts.findings) || 0,
                tmd: Number(counts.tmd) || 0,
                switchFiber: Number(counts.switchFiber) || 0,
                atmsSwitches: Number(counts.atmsSwitches) || 0
            }
            : null,
        diff: diffCounts
            ? {
                newIps: Number(diffCounts.newIps) || 0,
                missingIps: Number(diffCounts.missingIps) || 0,
                changedIps: Number(diffCounts.changedIps) || 0,
                newChannels: Number(diffCounts.newChannels) || 0,
                missingChannels: Number(diffCounts.missingChannels) || 0,
                newDrops: Number(diffCounts.newDrops) || 0,
                missingDrops: Number(diffCounts.missingDrops) || 0
            }
            : null,
        emptyCurrent: !!(diff?.emptyCurrent ?? summary?.emptyCurrent)
    };
}

/**
 * @param {{ summary?: { counts?: object }|null }|null|undefined} batch
 * @returns {string}
 */
export function formatImportBatchCounts(batch) {
    const c = batch?.summary?.counts;
    if (!c) return '';
    return `${c.channels ?? 0} ch · ${c.drops ?? 0} drops · ${c.findings ?? 0} findings`;
}

/**
 * @param {{ summary?: { diff?: object, emptyCurrent?: boolean }|null }|null|undefined} batch
 * @returns {string}
 */
export function formatImportBatchDiff(batch) {
    const summary = batch?.summary;
    if (!summary) return '';
    if (summary.emptyCurrent) return 'Initial import';
    const d = summary.diff;
    if (!d) return '';
    return `+${d.newIps ?? 0} / −${d.missingIps ?? 0} IPs · ${d.changedIps ?? 0} changed`;
}
