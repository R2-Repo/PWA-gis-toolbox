/**
 * Atlas CSV / printable report helpers.
 */

/**
 * @param {string} filename
 * @param {string} csv
 */
export function downloadTextFile(filename, csv) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {string}
 */
export function rowsToCsv(rows) {
    if (!rows.length) return '';
    const keys = Object.keys(rows[0]);
    const esc = (v) => {
        const s = v == null ? '' : String(v);
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };
    return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}

/**
 * @param {import('./types.js').AtlasSnapshot} snap
 */
export function exportDropsCsv(snap) {
    const rows = (snap.drops || []).map((d) => ({
        channel: d.channelNumber,
        drop: d.dropNumber,
        inventoryName: d.inventoryName,
        ip: d.ip,
        model: d.model,
        manufacturer: d.manufacturer,
        lat: d.lat,
        lon: d.lon
    }));
    downloadTextFile(`atlas-drops-${Date.now()}.csv`, rowsToCsv(rows));
}

/**
 * @param {import('./types.js').AtlasFinding[]} findings
 */
export function exportFindingsCsv(findings) {
    const rows = (findings || []).map((f) => ({
        type: f.findingType,
        severity: f.severity,
        status: f.status,
        description: f.description,
        suggestedAction: f.suggestedAction,
        createdAt: f.createdAt
    }));
    downloadTextFile(`atlas-findings-${Date.now()}.csv`, rowsToCsv(rows));
}

/**
 * @param {Array<object>} results ping session rows
 */
export function exportPingSessionCsv(results) {
    const rows = (results || []).map((r) => ({
        timestamp: r.timestamp || r.at,
        ip: r.ip || r.targetIp,
        reachable: r.status === 'reachable' || r.reachable === true,
        rttMs: r.rttMs ?? r.responseTimeMs ?? '',
        error: r.error || '',
        channel: r.channelNumber || '',
        drop: r.dropNumber ?? '',
        sessionId: r.sessionId || ''
    }));
    downloadTextFile(`atlas-ping-session-${Date.now()}.csv`, rowsToCsv(rows));
}

/**
 * Open a simple printable HTML report.
 * @param {{ title: string, bodyHtml: string }} opts
 */
export function openPrintableReport({ title, bodyHtml }) {
    const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>${title}</title>
<style>body{font-family:Segoe UI,sans-serif;padding:24px;color:#111}
h1{font-size:20px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left}
.muted{color:#666}</style></head><body>
<h1>${title}</h1>
<p class="muted">Generated ${new Date().toLocaleString()}</p>
${bodyHtml}
</body></html>`);
    w.document.close();
}

/**
 * @param {import('./types.js').AtlasSnapshot} snap
 */
export function buildDashboardStats(snap) {
    const openFindings = (snap.findings || []).filter((f) => f.status === 'Open');
    const ips = Object.values(snap.pingResults || {});
    const reachable = ips.filter((p) => p.status === 'reachable').length;
    const unreachable = ips.filter((p) => p.status === 'unreachable').length;
    return {
        hubs: snap.hubs?.length || 0,
        channels: snap.channels?.length || 0,
        drops: snap.drops?.length || 0,
        devices: snap.devices?.length || 0,
        sites: snap.sites?.length || 0,
        openFindings: openFindings.length,
        missingSiteIds: openFindings.filter((f) => f.findingType === 'missing_site_id').length,
        duplicateIps: openFindings.filter((f) => f.findingType === 'duplicate_ip').length,
        pingReachable: reachable,
        pingUnreachable: unreachable,
        pingTested: reachable + unreachable
    };
}
