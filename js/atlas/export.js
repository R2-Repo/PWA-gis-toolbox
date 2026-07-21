/**
 * Atlas CSV / printable report helpers.
 */
import { dropsInScope, listScopedDropsByPing } from './triage.js';

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
 * @param {{ scope?: 'network'|'selection' }} [opts]
 */
export function exportDropsCsv(snap, opts = {}) {
    const scope = opts.scope || 'network';
    const drops = dropsInScope(snap, scope);
    const rows = drops.map((d) => {
        const ping = d.ip ? snap.pingResults?.[d.ip] : null;
        return {
            channel: d.channelNumber,
            drop: d.dropNumber,
            inventoryName: d.inventoryName,
            ip: d.ip,
            model: d.model,
            manufacturer: d.manufacturer,
            wireless: d.wireless ? 'yes' : '',
            lat: d.lat,
            lon: d.lon,
            pingStatus: ping?.status || 'untested',
            pingRttMs: ping?.rttMs ?? '',
            pingAt: ping?.at || ''
        };
    });
    const suffix = scope === 'selection' ? 'selection' : 'network';
    downloadTextFile(`atlas-drops-${suffix}-${Date.now()}.csv`, rowsToCsv(rows));
}

/**
 * HTML table rows for a printable findings list.
 * @param {import('./types.js').AtlasFinding[]} findings
 * @param {number} [limit=40]
 */
export function findingsTableHtml(findings, limit = 40) {
    const list = (findings || []).slice(0, limit);
    if (!list.length) return '<p class="muted">No findings in this scope.</p>';
    const rows = list.map((f) =>
        `<tr><td>${escHtml(f.findingType)}</td><td>${escHtml(f.severity)}</td><td>${escHtml(f.status)}</td><td>${escHtml(f.description)}</td><td>${escHtml(f.ip || '')}</td></tr>`
    ).join('');
    const more = (findings || []).length > limit
        ? `<p class="muted">Showing ${limit} of ${findings.length}.</p>`
        : '';
    return `${more}<table><tr><th>Type</th><th>Severity</th><th>Status</th><th>Description</th><th>IP</th></tr>${rows}</table>`;
}

function escHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Full printable report body for current dashboard scope.
 * @param {import('./types.js').AtlasSnapshot} snap
 * @param {ReturnType<typeof buildDashboardStats>} stats
 * @param {import('./types.js').AtlasFinding[]} scopedFindings
 */
export function buildAtlasReportHtml(snap, stats, scopedFindings) {
    const open = (scopedFindings || []).filter((f) => f.status === 'Open');
    const typeRows = countFindingsByType(open, { openOnly: true })
        .map((r) => `<tr><td>${escHtml(r.type)}</td><td>${r.count}</td></tr>`)
        .join('');
    const scopeKey = stats.scopeLabel === 'Network' ? 'network' : 'selection';
    const wirelessCount = dropsInScope(snap, scopeKey).filter((d) => d.wireless).length;

    return `<p class="muted">Scope: ${escHtml(stats.scopeLabel || 'Network')}</p>
<table><tr><th>Metric</th><th>Value</th></tr>
<tr><td>Hubs</td><td>${stats.hubs}</td></tr>
<tr><td>Channels</td><td>${stats.channels}</td></tr>
<tr><td>Drops</td><td>${stats.drops}</td></tr>
<tr><td>Devices</td><td>${stats.devices}</td></tr>
<tr><td>Sites</td><td>${stats.sites}</td></tr>
<tr><td>Wireless drops</td><td>${wirelessCount}</td></tr>
<tr><td>Open findings</td><td>${stats.openFindings}</td></tr>
<tr><td>Ping up/down</td><td>${stats.pingReachable}/${stats.pingUnreachable}</td></tr>
<tr><td>Stale pings</td><td>${stats.pingStale || 0}</td></tr>
<tr><td>Untested</td><td>${stats.pingUntested || 0}</td></tr>
<tr><td>Needs attention</td><td>${stats.pingAttention || 0}</td></tr>
</table>
<h2>Open findings by type</h2>
${typeRows
        ? `<table><tr><th>Type</th><th>Count</th></tr>${typeRows}</table>`
        : '<p class="muted">No open findings.</p>'}
<h2>Open findings</h2>
${findingsTableHtml(open)}`;
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
        notes: f.notes || '',
        entityId: f.entityId || '',
        entityKind: f.entityKind || '',
        ip: f.ip || '',
        createdAt: f.createdAt
    }));
    downloadTextFile(`atlas-findings-${Date.now()}.csv`, rowsToCsv(rows));
}

/**
 * Export current triage list (unreachable / stale / untested / attention).
 * @param {import('./types.js').AtlasSnapshot} snap
 * @param {{ scope?: 'network'|'selection', mode?: string }} [opts]
 */
export function exportTriageCsv(snap, opts = {}) {
    const mode = opts.mode || 'unreachable';
    const scope = opts.scope || 'network';
    const rows = listScopedDropsByPing(snap, { scope, mode }).map((r) => ({
        mode,
        scope,
        channel: r.drop.channelNumber,
        drop: r.drop.dropNumber,
        inventoryName: r.drop.inventoryName,
        ip: r.ip,
        status: r.status,
        rttMs: r.rttMs ?? '',
        age: r.age,
        stale: r.stale ? 'yes' : '',
        at: r.at || ''
    }));
    downloadTextFile(`atlas-triage-${mode}-${Date.now()}.csv`, rowsToCsv(rows));
}

/**
 * Count findings by type (for import review / dashboard).
 * @param {import('./types.js').AtlasFinding[]} findings
 * @param {{ openOnly?: boolean }} [opts]
 * @returns {Array<{ type: string, count: number }>}
 */
export function countFindingsByType(findings, opts = {}) {
    const openOnly = opts.openOnly !== false;
    /** @type {Map<string, number>} */
    const map = new Map();
    for (const f of findings || []) {
        if (openOnly && f.status !== 'Open') continue;
        const t = f.findingType || 'unknown';
        map.set(t, (map.get(t) || 0) + 1);
    }
    return [...map.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * Export import diff lists for tickets.
 * @param {object} diff from diffAtlasImport
 */
export function exportImportDiffCsv(diff) {
    if (!diff) return;
    const rows = [];
    for (const ip of diff.newIps || []) rows.push({ change: 'new_ip', value: ip, field: '', from: '', to: '' });
    for (const ip of diff.missingIps || []) rows.push({ change: 'missing_ip', value: ip, field: '', from: '', to: '' });
    if (diff.changedIpDetails?.length) {
        for (const row of diff.changedIpDetails) {
            for (const c of row.changes || []) {
                rows.push({
                    change: 'changed_ip',
                    value: row.ip,
                    field: c.field,
                    from: c.from,
                    to: c.to
                });
            }
        }
    } else {
        for (const ip of diff.changedIps || []) {
            rows.push({ change: 'changed_ip', value: ip, field: '', from: '', to: '' });
        }
    }
    for (const c of diff.newChannels || []) rows.push({ change: 'new_channel', value: c, field: '', from: '', to: '' });
    for (const c of diff.missingChannels || []) rows.push({ change: 'missing_channel', value: c, field: '', from: '', to: '' });
    for (const d of diff.newDrops || []) rows.push({ change: 'new_drop', value: d, field: '', from: '', to: '' });
    for (const d of diff.missingDrops || []) rows.push({ change: 'missing_drop', value: d, field: '', from: '', to: '' });
    downloadTextFile(`atlas-import-diff-${Date.now()}.csv`, rowsToCsv(rows));
}

/**
 * @param {Array<object>} results ping session rows
 */
/**
 * @param {Array<object>} results
 * @param {{ label?: string, sessionId?: string }} [opts]
 */
export function exportPingSessionCsv(results, opts = {}) {
    const rows = (results || []).map((r) => ({
        timestamp: r.timestamp || r.at,
        ip: r.ip || r.targetIp,
        reachable: r.status === 'reachable' || r.reachable === true,
        rttMs: r.rttMs ?? r.responseTimeMs ?? '',
        error: r.error || '',
        channel: r.channelNumber || '',
        drop: r.dropNumber ?? '',
        sessionId: r.sessionId || opts.sessionId || ''
    }));
    const slug = String(opts.label || 'session')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'session';
    downloadTextFile(`atlas-ping-${slug}-${Date.now()}.csv`, rowsToCsv(rows));
}

/**
 * Keep monitor sessions in history lists (hide one-shot noise).
 * @param {{ label?: string|null }|null|undefined} session
 */
export function isMonitorHistorySession(session) {
    const label = String(session?.label || '').trim().toLowerCase();
    return label !== 'one-shot';
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

    // Entity selection wins over a stale area query
    if (scope === 'selection' && snap.selection && snap.selection.kind !== 'area') {
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
        } else if (sel.kind === 'device') {
            scopeLabel = 'Device';
            const device = devices.find((d) => d.id === sel.id);
            devices = device ? [device] : [];
            drops = drops.filter((d) => d.deviceId === sel.id || (device?.ip && d.ip === device.ip));
            const chId = drops[0]?.channelId;
            channels = channels.filter((c) => c.id === chId);
        } else if (sel.kind === 'site') {
            scopeLabel = 'Site';
            sites = sites.filter((s) => s.id === sel.id);
            drops = drops.filter((d) => d.siteId === sel.id);
            const chIds = new Set(drops.map((d) => d.channelId).filter(Boolean));
            channels = channels.filter((c) => chIds.has(c.id));
        }
        const dropIps = new Set(drops.map((d) => d.ip).filter(Boolean));
        const dropIds = new Set(drops.map((d) => d.id));
        if (sel.kind !== 'device') {
            devices = devices.filter((d) => dropIds.has(d.dropId) || (d.ip && dropIps.has(d.ip)));
        }
        const siteIds = new Set(drops.map((d) => d.siteId).filter(Boolean));
        if (sel.kind !== 'site') {
            sites = sites.filter((s) => siteIds.has(s.id));
        }
        findings = findings.filter((f) => !f.entityId || dropIds.has(f.entityId) || f.entityId === sel.id
            || (f.ip && dropIps.has(f.ip)));
    } else if (scope === 'selection' && snap.areaResults) {
        scopeLabel = 'Area';
        drops = snap.areaResults.drops || [];
        hubs = snap.areaResults.hubs || [];
        channels = snap.areaResults.channels || [];
        devices = snap.areaResults.devices || [];
        const dropIds = new Set(drops.map((d) => d.id));
        const dropIps = new Set(drops.map((d) => d.ip).filter(Boolean));
        const siteIds = new Set(drops.map((d) => d.siteId).filter(Boolean));
        sites = sites.filter((s) => siteIds.has(s.id));
        findings = findings.filter((f) =>
            (f.entityId && dropIds.has(f.entityId))
            || (f.ip && dropIps.has(f.ip))
            || (snap.areaResults.warnings || []).some((w) => w.id === f.id));
    }

    const openFindings = findings.filter((f) => f.status === 'Open');
    const scopedIps = new Set(drops.map((d) => d.ip).filter(Boolean));
    const pingEntries = Object.entries(snap.pingResults || {})
        .filter(([ip]) => scope === 'network' || scopedIps.has(ip))
        .map(([, p]) => p);
    const reachable = pingEntries.filter((p) => p.status === 'reachable').length;
    const unreachable = pingEntries.filter((p) => p.status === 'unreachable').length;
    const pingStale = listScopedDropsByPing(snap, { scope, mode: 'stale' }).length;
    const pingUntested = listScopedDropsByPing(snap, { scope, mode: 'untested' }).length;
    const pingAttention = listScopedDropsByPing(snap, { scope, mode: 'attention' }).length;
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
        atmsUnmatched: openFindings.filter((f) => f.findingType === 'atms_unmatched').length,
        coordinateDisagreement: openFindings.filter((f) => f.findingType === 'coordinate_disagreement').length,
        damagedHubValue: openFindings.filter((f) => f.findingType === 'damaged_hub_value').length,
        workbookNotInAtms: openFindings.filter((f) => f.findingType === 'workbook_not_in_atms').length,
        missingSwitchfiber: openFindings.filter((f) => f.findingType === 'missing_switchfiber').length,
        missingChannel: openFindings.filter((f) => f.findingType === 'missing_channel').length,
        missingDrop: openFindings.filter((f) => f.findingType === 'missing_drop').length,
        missingSecondaryHub: openFindings.filter((f) => f.findingType === 'missing_secondary_hub').length,
        wirelessDrops: drops.filter((d) => d.wireless).length,
        provisionalDevices: devices.filter((d) => d.provisional).length,
        pingReachable: reachable,
        pingUnreachable: unreachable,
        pingStale,
        pingUntested,
        pingAttention,
        pingTested: reachable + unreachable
    };
}
