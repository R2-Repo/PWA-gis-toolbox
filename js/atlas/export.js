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
        entityId: f.entityId || '',
        entityKind: f.entityKind || '',
        ip: f.ip || '',
        createdAt: f.createdAt
    }));
    downloadTextFile(`atlas-findings-${Date.now()}.csv`, rowsToCsv(rows));
}

/**
 * Export import diff lists for tickets.
 * @param {object} diff from diffAtlasImport
 */
export function exportImportDiffCsv(diff) {
    if (!diff) return;
    const rows = [];
    for (const ip of diff.newIps || []) rows.push({ change: 'new_ip', value: ip });
    for (const ip of diff.missingIps || []) rows.push({ change: 'missing_ip', value: ip });
    for (const ip of diff.changedIps || []) rows.push({ change: 'changed_ip', value: ip });
    for (const c of diff.newChannels || []) rows.push({ change: 'new_channel', value: c });
    for (const c of diff.missingChannels || []) rows.push({ change: 'missing_channel', value: c });
    for (const d of diff.newDrops || []) rows.push({ change: 'new_drop', value: d });
    for (const d of diff.missingDrops || []) rows.push({ change: 'missing_drop', value: d });
    downloadTextFile(`atlas-import-diff-${Date.now()}.csv`, rowsToCsv(rows));
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
 * @param {{ scope?: 'network'|'selection' }} [opts]
 */
export function buildDashboardStats(snap, opts = {}) {
    const scope = opts.scope || 'network';
    let hubs = snap.hubs || [];
    let channels = snap.channels || [];
    let drops = snap.drops || [];
    let devices = snap.devices || [];
    let sites = snap.sites || [];
    let findings = snap.findings || [];
    let scopeLabel = 'Network';

    if (scope === 'selection' && snap.areaResults) {
        scopeLabel = 'Area';
        drops = snap.areaResults.drops || [];
        hubs = snap.areaResults.hubs || [];
        channels = snap.areaResults.channels || [];
        devices = snap.areaResults.devices || [];
        const dropIds = new Set(drops.map((d) => d.id));
        const siteIds = new Set(drops.map((d) => d.siteId).filter(Boolean));
        sites = sites.filter((s) => siteIds.has(s.id));
        findings = findings.filter((f) => !f.entityId || dropIds.has(f.entityId));
    } else if (scope === 'selection' && snap.selection) {
        const sel = snap.selection;
        if (sel.kind === 'hub') {
            scopeLabel = 'Hub';
            const hub = hubs.find((h) => h.id === sel.id);
            hubs = hub ? [hub] : [];
            channels = channels.filter(
                (c) => c.primaryHubId === sel.id || c.secondaryHubId === sel.id
                    || (hub && (c.primaryHubCode === hub.hubCode || c.secondaryHubCode === hub.hubCode))
            );
            const chIds = new Set(channels.map((c) => c.id));
            drops = drops.filter((d) => chIds.has(d.channelId));
        } else if (sel.kind === 'channel') {
            scopeLabel = 'Channel';
            channels = channels.filter((c) => c.id === sel.id);
            drops = drops.filter((d) => d.channelId === sel.id);
            const codes = new Set(
                channels.flatMap((c) => [c.primaryHubCode, c.secondaryHubCode]).filter(Boolean)
            );
            hubs = hubs.filter((h) => codes.has(h.hubCode));
        } else if (sel.kind === 'drop') {
            scopeLabel = 'Drop';
            drops = drops.filter((d) => d.id === sel.id);
            const chId = drops[0]?.channelId;
            channels = channels.filter((c) => c.id === chId);
        }
        const dropIps = new Set(drops.map((d) => d.ip).filter(Boolean));
        const dropIds = new Set(drops.map((d) => d.id));
        devices = devices.filter((d) => dropIds.has(d.dropId) || (d.ip && dropIps.has(d.ip)));
        const siteIds = new Set(drops.map((d) => d.siteId).filter(Boolean));
        sites = sites.filter((s) => siteIds.has(s.id));
        findings = findings.filter((f) => !f.entityId || dropIds.has(f.entityId));
    }

    const openFindings = findings.filter((f) => f.status === 'Open');
    const scopedIps = new Set(drops.map((d) => d.ip).filter(Boolean));
    const pingEntries = Object.entries(snap.pingResults || {})
        .filter(([ip]) => scope === 'network' || scopedIps.has(ip))
        .map(([, p]) => p);
    const reachable = pingEntries.filter((p) => p.status === 'reachable').length;
    const unreachable = pingEntries.filter((p) => p.status === 'unreachable').length;
    return {
        scopeLabel,
        hubs: hubs.length,
        channels: channels.length,
        drops: drops.length,
        devices: devices.length,
        sites: sites.length,
        openFindings: openFindings.length,
        missingSiteIds: openFindings.filter((f) => f.findingType === 'missing_site_id').length,
        duplicateIps: openFindings.filter((f) => f.findingType === 'duplicate_ip').length,
        pingReachable: reachable,
        pingUnreachable: unreachable,
        pingTested: reachable + unreachable
    };
}
