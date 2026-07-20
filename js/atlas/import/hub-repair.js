/**
 * Repair ATMS hub fields corrupted by spreadsheet date formatting.
 * Preserves raw; returns normalized candidate + confidence.
 */

/**
 * @param {unknown} raw
 * @param {Set<string>} [knownHubCodes]
 * @returns {{ raw: string, normalized: string|null, confidence: 'high'|'medium'|'low'|'none', notes: string }}
 */
export function repairHubValue(raw, knownHubCodes = new Set()) {
    const rawStr = raw == null ? '' : String(raw);
    if (!rawStr.trim()) {
        return { raw: rawStr, normalized: null, confidence: 'none', notes: 'empty' };
    }

    const trimmed = rawStr.trim();

    // Already looks like Hub 4-01 or 4-01
    const hubMatch = trimmed.match(/^(?:hub\s*)?(\d{1,2})\s*[-/]\s*(\d{1,2})$/i);
    if (hubMatch) {
        const code = `${Number(hubMatch[1])}-${String(Number(hubMatch[2])).padStart(2, '0')}`;
        const confidence = knownHubCodes.size === 0 || knownHubCodes.has(code) ? 'high' : 'medium';
        return { raw: rawStr, normalized: code, confidence, notes: 'direct' };
    }

    // Excel serial / Date object rendered as locale date: "4/1/2026" → 4-01
    const dateSlash = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
    if (dateSlash) {
        const code = `${Number(dateSlash[1])}-${String(Number(dateSlash[2])).padStart(2, '0')}`;
        const confidence = knownHubCodes.has(code) ? 'high' : 'medium';
        return { raw: rawStr, normalized: code, confidence, notes: 'date-slash' };
    }

    // "1-Apr" style (day-month) often means Hub 4-01 (month=4, day=1)
    const dayMonth = trimmed.match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i);
    if (dayMonth) {
        const months = {
            jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
            jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
        };
        const month = months[dayMonth[2].toLowerCase()];
        const day = Number(dayMonth[1]);
        if (month) {
            const code = `${month}-${String(day).padStart(2, '0')}`;
            const confidence = knownHubCodes.has(code) ? 'high' : 'low';
            return { raw: rawStr, normalized: code, confidence, notes: 'day-month-name' };
        }
    }

    // Date object from SheetJS
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        const month = raw.getMonth() + 1;
        const day = raw.getDate();
        const code = `${month}-${String(day).padStart(2, '0')}`;
        const confidence = knownHubCodes.has(code) ? 'high' : 'low';
        return { raw: rawStr, normalized: code, confidence, notes: 'date-object' };
    }

    return { raw: rawStr, normalized: null, confidence: 'none', notes: 'unrecognized' };
}
