/**
 * Atlas workspace controller — load DB, import, ping, selection.
 */
import { getPlatformBundle } from '../platform/create-platform.js';
import { hasCapability } from '../platform/contracts.js';
import {
    getAtlasSnapshot,
    patchAtlasSnapshot,
    setAtlasSelection,
    setPingStatuses,
    resetAtlasSnapshot
} from './store.js';
import {
    syncAtlasMapLayers,
    flyToAtlasPoint,
    fitAtlasPoints,
    clearAtlasMapLayers,
    enableAtlasMapInteraction,
    disableAtlasMapInteraction
} from './map-layers.js';
import { buildAtlasImportPayload } from './import/pipeline.js';
import { diffAtlasImport } from './import/diff.js';
import { compactImportBatchSummary } from './import/batch-format.js';
import { buildDashboardStats, exportPingSessionCsv, sessionsOlderThan } from './export.js';
import { startPingSession, stopPingSession, stopAllPingSessions } from './monitor.js';
import { queryAtlasInArea } from './area-query.js';
import { collectHubIps } from './triage.js';
import {
    defaultAtlasPrefs,
    normalizeAtlasPrefs,
    serializePrefValue
} from './prefs.js';
import { applyFindingStatusPatch, isFindingStatus } from './findings-status.js';
import { disableAtlasHotkeys, enableAtlasHotkeys } from './hotkeys.js';
import bus from '../core/event-bus.js';

function notify(message, level = 'info') {
    getPlatformBundle().services?.notifications?.show?.(message, level);
}

/** Toast helper for Atlas UI modules. */
export function atlasNotify(message, level = 'info') {
    notify(message, level);
}

/**
 * @returns {import('../platform/contracts.js').DatabaseService | null}
 */
function db() {
    return getPlatformBundle().services?.atlasDb || null;
}

/**
 * @returns {import('../platform/contracts.js').PingService | null}
 */
function ping() {
    return getPlatformBundle().services?.ping || null;
}

export function atlasCapabilities() {
    const { platform } = getPlatformBundle();
    return {
        available: hasCapability(platform, 'localSqlite'),
        canPing: hasCapability(platform, 'icmpPing')
    };
}

/**
 * Open DB and hydrate in-memory snapshot + map.
 */
export async function openAtlasWorkspace() {
    const service = db();
    if (!service?.open) {
        throw new Error('Atlas database is only available in the Windows desktop app');
    }
    await service.open();
    const data = await service.loadSnapshot();
    const prefs = await loadAtlasPrefs();
    const pingResults = data.pingResults || {};
    const base = {
        loaded: true,
        hubs: data.hubs || [],
        channels: data.channels || [],
        drops: data.drops || [],
        devices: data.devices || [],
        sites: data.sites || [],
        findings: data.findings || [],
        pingResults,
        lastImport: data.lastImport || null,
        selection: getAtlasSnapshot().selection,
        areaResults: getAtlasSnapshot().areaResults,
        prefs
    };
    patchAtlasSnapshot({
        ...base,
        stats: buildDashboardStats(base, { scope: prefs.dashScope })
    });
    syncAtlasMapLayers(getAtlasSnapshot());
    enableAtlasMapInteraction((sel) => selectAtlasEntity(sel));
    enableAtlasHotkeys({
        onFocusSearch: () => bus.emit('atlas:focus-search'),
        onEscape: () => clearAtlasFocus()
    });
    bus.emit('atlas:opened', getAtlasSnapshot());
    bus.emit('atlas:prefs', prefs);
    // Retention prune after hydrate (non-blocking for UI)
    if (prefs.sessionsRetentionDays > 0) {
        void pruneAtlasPingSessions({
            olderThanDays: prefs.sessionsRetentionDays,
            quiet: true
        }).catch(() => {});
    }
    return getAtlasSnapshot();
}

/**
 * @returns {Promise<ReturnType<typeof defaultAtlasPrefs>>}
 */
export async function loadAtlasPrefs() {
    if (!atlasCapabilities().available) return defaultAtlasPrefs();
    const service = db();
    if (!service?.getAllPrefs) return defaultAtlasPrefs();
    try {
        const res = await service.getAllPrefs();
        return normalizeAtlasPrefs(res?.prefs || {});
    } catch {
        return defaultAtlasPrefs();
    }
}

/**
 * Persist one operator preference and patch the in-memory snapshot.
 * @param {string} key
 * @param {string|number|null|undefined} value
 */
export async function setAtlasPref(key, value) {
    const serialized = serializePrefValue(key, value);
    if (value != null && value !== '' && serialized === null) {
        return getAtlasSnapshot().prefs || defaultAtlasPrefs();
    }
    const service = db();
    if (atlasCapabilities().available && service?.setPref) {
        try {
            await service.setPref({ key, value: serialized });
        } catch {
            /* prefs optional */
        }
    }
    const current = getAtlasSnapshot().prefs || defaultAtlasPrefs();
    const raw = {
        'monitor.interval': String(current.monitorInterval),
        'dashboard.scope': current.dashScope,
        'triage.mode': current.triageMode,
        'sessions.retentionDays': String(current.sessionsRetentionDays)
    };
    if (serialized == null) delete raw[key];
    else raw[key] = serialized;
    const prefs = normalizeAtlasPrefs(raw);
    patchAtlasSnapshot({ prefs });
    bus.emit('atlas:prefs', prefs);
    return prefs;
}

export async function refreshAtlasFromDb() {
    return openAtlasWorkspace();
}

/**
 * Normalize File / path / already-parsed inputs into pipeline shape.
 * @param {{
 *   workbookFile?: File,
 *   atmsFile?: File,
 *   workbookPath?: string,
 *   atmsPath?: string,
 *   workbook?: { name: string, buffer: ArrayBuffer },
 *   atms?: { name: string, text: string }
 * }} files
 */
async function resolveImportInputs(files = {}) {
    const { readAtlasImportPath } = await import('./import/inbox.js');

    /** @type {{ name: string, buffer: ArrayBuffer } | undefined} */
    let workbookFile = files.workbook;
    /** @type {{ name: string, text: string } | undefined} */
    let atmsFile = files.atms;

    if (!workbookFile && files.workbookFile) {
        workbookFile = {
            name: files.workbookFile.name,
            buffer: await files.workbookFile.arrayBuffer()
        };
    }
    if (!atmsFile && files.atmsFile) {
        atmsFile = {
            name: files.atmsFile.name,
            text: await files.atmsFile.text()
        };
    }
    if (!workbookFile && files.workbookPath) {
        workbookFile = await readAtlasImportPath(files.workbookPath, 'workbook');
    }
    if (!atmsFile && files.atmsPath) {
        atmsFile = await readAtlasImportPath(files.atmsPath, 'atms');
    }

    return { workbookFile, atmsFile };
}

/**
 * Build import payload + summary without writing the database (review step).
 * @param {Parameters<typeof resolveImportInputs>[0]} files
 */
export async function previewAtlasImport(files) {
    const { workbookFile, atmsFile } = await resolveImportInputs(files);
    if (!workbookFile && !atmsFile) {
        throw new Error('Select or detect a FiberSwitchLocation workbook and/or ATMS CSV');
    }
    const payload = await buildAtlasImportPayload({ workbookFile, atmsFile });
    const diff = diffAtlasImport(payload, getAtlasSnapshot());
    return {
        summary: {
            ...payload.summary,
            diff: diff.counts,
            diffDetails: diff
        },
        payload,
        diff
    };
}

/**
 * Apply a previously previewed payload, or build+apply from files.
 * Replaces the current Atlas network tables.
 * @param {Parameters<typeof resolveImportInputs>[0] | { payload: object }} input
 */
export async function runAtlasImport(input) {
    const service = db();
    if (!service?.applyImport) {
        throw new Error('Atlas import requires the Windows desktop app');
    }

    let payload = input?.payload;
    /** @type {object|null} */
    let diff = null;
    if (!payload) {
        const preview = await previewAtlasImport(input || {});
        payload = preview.payload;
        diff = preview.diff || null;
    } else {
        // Snapshot vs current DB before replace (counts only — no IP lists stored).
        diff = diffAtlasImport(payload, getAtlasSnapshot());
    }

    const summary = compactImportBatchSummary(payload.summary, diff);
    payload = { ...payload, summary };

    await service.applyImport(payload);
    await refreshAtlasFromDb();
    return summary;
}

/**
 * List past import batch metadata (newest first). Not restorable.
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function listAtlasImportBatches(opts = {}) {
    if (!atlasCapabilities().available) return [];
    const service = db();
    if (!service?.listImportBatches) return [];
    try {
        const res = await service.listImportBatches(opts);
        return res?.batches || [];
    } catch {
        return [];
    }
}

/**
 * @param {import('./types.js').AtlasSelection} selection
 */
export function selectAtlasEntity(selection) {
    // Entity pick clears area scope so triage/dashboard follow the selection
    if (selection?.kind && selection.kind !== 'area' && getAtlasSnapshot().areaResults) {
        patchAtlasSnapshot({ areaResults: null });
    }
    setAtlasSelection(selection);
    const snap = getAtlasSnapshot();
    if (selection.kind === 'drop') {
        const drop = snap.drops.find((d) => d.id === selection.id);
        if (drop?.lat != null) flyToAtlasPoint({ lat: drop.lat, lon: drop.lon });
    } else if (selection.kind === 'hub') {
        const hub = snap.hubs.find((h) => h.id === selection.id);
        const hubChannels = snap.channels.filter(
            (c) => c.primaryHubId === selection.id || c.secondaryHubId === selection.id
                || (hub && (c.primaryHubCode === hub.hubCode || c.secondaryHubCode === hub.hubCode))
        );
        const chIds = new Set(hubChannels.map((c) => c.id));
        const points = [
            ...(hub?.lat != null ? [{ lat: hub.lat, lon: hub.lon }] : []),
            ...snap.drops.filter((d) => chIds.has(d.channelId) && d.lat != null)
                .map((d) => ({ lat: d.lat, lon: d.lon }))
        ];
        if (points.length) fitAtlasPoints(points);
        else if (hub?.lat != null) flyToAtlasPoint({ lat: hub.lat, lon: hub.lon });
    } else if (selection.kind === 'channel') {
        const drops = snap.drops
            .filter((d) => d.channelId === selection.id && d.lat != null)
            .map((d) => ({ lat: d.lat, lon: d.lon }));
        fitAtlasPoints(drops);
    } else if (selection.kind === 'device') {
        const device = snap.devices.find((d) => d.id === selection.id);
        const drop = snap.drops.find((d) => d.deviceId === device?.id || (device?.ip && d.ip === device.ip));
        if (drop?.lat != null) flyToAtlasPoint({ lat: drop.lat, lon: drop.lon });
        else if (device?.lat != null) flyToAtlasPoint({ lat: device.lat, lon: device.lon });
    } else if (selection.kind === 'site') {
        const site = snap.sites.find((s) => s.id === selection.id);
        const drop = snap.drops.find((d) => d.siteId === selection.id);
        if (drop?.lat != null) flyToAtlasPoint({ lat: drop.lat, lon: drop.lon });
        else if (site?.lat != null) flyToAtlasPoint({ lat: site.lat, lon: site.lon });
    }
    const next = getAtlasSnapshot();
    patchAtlasSnapshot({ stats: buildDashboardStats(next, { scope: 'selection' }) });
    syncAtlasMapLayers(getAtlasSnapshot());
}

/**
 * @param {string[]} ips
 */
export async function pingTargets(ips) {
    const service = ping();
    if (!service?.pingMany) {
        const err = new Error('ICMP ping requires the Windows desktop app');
        notify(err.message, 'error');
        throw err;
    }
    const unique = [...new Set(ips.filter(Boolean))];
    if (!unique.length) {
        notify('No IPs to ping', 'warning');
        return [];
    }
    notify(`Pinging ${unique.length} IP${unique.length === 1 ? '' : 's'}…`, 'info');
    const pending = Object.fromEntries(unique.map((ip) => [ip, { status: 'pending', at: new Date().toISOString() }]));
    setPingStatuses(pending);
    syncAtlasMapLayers(getAtlasSnapshot());

    try {
        const results = await service.pingMany(unique);
        /** @type {Record<string, import('./types.js').PingStatusEntry>} */
        const map = {};
        for (const r of results) {
            map[r.ip] = {
                status: r.status,
                rttMs: r.rttMs ?? null,
                error: r.error,
                at: new Date().toISOString()
            };
        }
        setPingStatuses(map);
        syncAtlasMapLayers(getAtlasSnapshot());

        try {
            await db()?.savePingResults?.({
                sessionId: crypto.randomUUID(),
                label: 'one-shot',
                results: results.map((r) => ({
                    ...r,
                    at: map[r.ip]?.at
                }))
            });
        } catch {
            /* persistence optional for one-shot */
        }

        const up = results.filter((r) => r.status === 'reachable').length;
        const down = results.filter((r) => r.status === 'unreachable').length;
        const other = results.length - up - down;
        notify(
            `Ping done: ${up} up · ${down} down${other ? ` · ${other} other` : ''}`,
            down && !up ? 'warning' : 'success'
        );
        return results;
    } catch (err) {
        notify(err?.message || 'Ping failed', 'error');
        throw err;
    }
}

/**
 * @param {string} channelId
 */
export async function pingChannel(channelId) {
    const snap = getAtlasSnapshot();
    const ips = snap.drops.filter((d) => d.channelId === channelId).map((d) => d.ip).filter(Boolean);
    return pingTargets(ips);
}

/**
 * @param {string} dropId
 */
export async function pingDrop(dropId) {
    const drop = getAtlasSnapshot().drops.find((d) => d.id === dropId);
    if (!drop?.ip) throw new Error('Drop has no IP');
    return pingTargets([drop.ip]);
}

/**
 * @param {string} hubId
 * @param {'all'|'primary'|'secondary'} [role]
 */
export async function pingHub(hubId, role = 'all') {
    const ips = collectHubIps(hubId, role, getAtlasSnapshot());
    if (!ips.length) throw new Error('No switch IPs found for this hub');
    return pingTargets(ips);
}

/**
 * @param {object} geometry
 */
export function runAreaQuery(geometry) {
    const results = queryAtlasInArea(geometry);
    // Soft-clear entity selection so area scope is active until next entity pick
    setAtlasSelection({ kind: 'area', id: 'area' });
    patchAtlasSnapshot({ areaResults: results });
    const snap = getAtlasSnapshot();
    patchAtlasSnapshot({ stats: buildDashboardStats(snap, { scope: 'selection' }) });
    syncAtlasMapLayers(getAtlasSnapshot());
    const points = [
        ...(results.drops || []).filter((d) => d.lat != null).map((d) => ({ lat: d.lat, lon: d.lon })),
        ...(results.hubs || []).filter((h) => h.lat != null).map((h) => ({ lat: h.lat, lon: h.lon }))
    ];
    if (points.length) fitAtlasPoints(points);
    notify(`Area: ${results.drops.length} drops · ${results.channels.length} channels`, 'info');
    return results;
}

/** Clear area query results and restore network-scoped stats. */
export function clearAreaResults() {
    patchAtlasSnapshot({ areaResults: null });
    const snap = getAtlasSnapshot();
    if (snap.selection?.kind === 'area') {
        setAtlasSelection(null);
    }
    patchAtlasSnapshot({ stats: buildDashboardStats(getAtlasSnapshot(), { scope: 'network' }) });
    syncAtlasMapLayers(getAtlasSnapshot());
}

/**
 * Start temporary monitoring.
 * @param {{ targets: string[], interval: number|string, label?: string }} opts
 */
export function startAtlasMonitor(opts) {
    if (getAtlasSnapshot().activeSession) {
        notify('A monitor session is already running — stop it first', 'warning');
        return null;
    }
    const sessionId = crypto.randomUUID();
    const label = opts.label || 'Monitor';
    const log = [];
    const startedAt = new Date().toISOString();
    patchAtlasSnapshot({
        activeSession: { id: sessionId, label, targets: opts.targets, interval: opts.interval, log, startedAt }
    });

    // Create session row once; ticks append samples only.
    void db()?.savePingResults?.({
        sessionId,
        label,
        startedAt,
        results: []
    }).catch(() => {});

    const handle = startPingSession({
        sessionId,
        targets: opts.targets,
        interval: opts.interval,
        pingFn: async (targets) => {
            const service = ping();
            if (!service?.pingMany) throw new Error('Ping unavailable');
            return service.pingMany(targets);
        },
        onResult: (row) => {
            log.push(row);
            setPingStatuses({
                [row.ip]: {
                    status: row.status,
                    rttMs: row.rttMs,
                    error: row.error,
                    at: row.timestamp
                }
            });
            syncAtlasMapLayers(getAtlasSnapshot());
            patchAtlasSnapshot({
                activeSession: {
                    id: sessionId,
                    label,
                    targets: opts.targets,
                    interval: opts.interval,
                    log: [...log],
                    startedAt
                }
            });
            void db()?.savePingResults?.({
                sessionId,
                label,
                results: [{
                    ip: row.ip,
                    status: row.status,
                    rttMs: row.rttMs,
                    error: row.error,
                    at: row.timestamp
                }]
            }).catch(() => {});
        },
        onStop: () => {
            patchAtlasSnapshot({ activeSession: null });
        }
    });

    return handle;
}

/**
 * @param {string} [sessionId]
 * @param {{ exportCsv?: boolean }} [opts]
 */
export function stopAtlasMonitor(sessionId, opts = {}) {
    const exportCsv = opts.exportCsv !== false;
    const active = getAtlasSnapshot().activeSession;
    const id = sessionId || active?.id;
    if (id) stopPingSession(id);
    if (active?.log?.length && exportCsv) {
        exportPingSessionCsv(active.log, { label: active.label });
    }
    if (id) {
        void db()?.finalizePingSession?.({
            sessionId: id,
            stoppedAt: new Date().toISOString()
        }).then(() => {
            bus.emit('atlas:ping-sessions');
        }).catch(() => {
            bus.emit('atlas:ping-sessions');
        });
    }
    patchAtlasSnapshot({ activeSession: null });
}

/**
 * List persisted monitor sessions (excludes one-shot by default).
 * @param {{ limit?: number, includeOneShot?: boolean }} [opts]
 */
export async function listAtlasPingSessions(opts = {}) {
    if (!atlasCapabilities().available) return [];
    const service = db();
    if (!service?.listPingSessions) return [];
    try {
        const res = await service.listPingSessions(opts);
        return res?.sessions || [];
    } catch {
        return [];
    }
}

/**
 * Load samples for a past session.
 * @param {string} sessionId
 * @param {{ limit?: number, all?: boolean }} [opts]
 */
export async function loadAtlasPingSession(sessionId, opts = {}) {
    const service = db();
    if (!service?.loadPingSession) throw new Error('Ping session history unavailable');
    return service.loadPingSession({
        sessionId,
        limit: opts.limit ?? (opts.all ? 500000 : 200),
        all: opts.all === true
    });
}

/**
 * Export every sample for a session from SQLite (chronological).
 * @param {string} sessionId
 * @param {{ label?: string }} [opts]
 * @returns {Promise<number>} row count exported
 */
export async function exportAtlasPingSessionFullCsv(sessionId, opts = {}) {
    if (!sessionId) return 0;
    const detail = await loadAtlasPingSession(sessionId, { all: true });
    const results = detail?.results || [];
    exportPingSessionCsv(results, {
        label: opts.label || detail?.session?.label,
        sessionId
    });
    notify(
        `Exported ${results.length} sample${results.length === 1 ? '' : 's'}`,
        'success'
    );
    return results.length;
}

/**
 * @param {string} sessionId
 */
export async function deleteAtlasPingSession(sessionId) {
    if (!sessionId) return false;
    const activeId = getAtlasSnapshot().activeSession?.id;
    if (activeId && sessionId === activeId) {
        notify('Stop the active monitor before deleting it', 'warning');
        return false;
    }
    const service = db();
    if (!service?.deletePingSession) throw new Error('Ping session delete unavailable');
    await service.deletePingSession({ sessionId });
    bus.emit('atlas:ping-sessions');
    notify('Monitor session deleted', 'success');
    return true;
}

/**
 * Delete sessions older than N days (excludes active session).
 * @param {{ olderThanDays?: number, quiet?: boolean }} [opts]
 * @returns {Promise<number>} deleted count
 */
export async function pruneAtlasPingSessions(opts = {}) {
    const days = opts.olderThanDays
        ?? getAtlasSnapshot().prefs?.sessionsRetentionDays
        ?? 30;
    if (!days || days <= 0) return 0;
    const service = db();
    if (!service?.deletePingSessions && !service?.deletePingSession) return 0;

    const sessions = await listAtlasPingSessions({ limit: 500 });
    const stale = sessionsOlderThan(sessions, days, {
        excludeSessionId: getAtlasSnapshot().activeSession?.id
    });
    if (!stale.length) {
        if (!opts.quiet) notify('No old monitor sessions to prune', 'info');
        return 0;
    }
    const ids = stale.map((s) => s.id).filter(Boolean);
    let deleted = 0;
    if (service.deletePingSessions) {
        for (let i = 0; i < ids.length; i += 200) {
            const chunk = ids.slice(i, i + 200);
            const res = await service.deletePingSessions({ sessionIds: chunk });
            deleted += res?.deleted ?? chunk.length;
        }
    } else {
        for (const id of ids) {
            await service.deletePingSession({ sessionId: id });
            deleted += 1;
        }
    }
    bus.emit('atlas:ping-sessions');
    if (!opts.quiet) {
        notify(`Pruned ${deleted} monitor session${deleted === 1 ? '' : 's'} older than ${days}d`, 'success');
    }
    return deleted;
}

export function leaveAtlasMap() {
    stopAtlasMonitor(undefined, { exportCsv: false });
    stopAllPingSessions();
    disableAtlasHotkeys();
    disableAtlasMapInteraction();
    clearAtlasMapLayers();
}

/** Clear area query first, else clear entity selection. */
export function clearAtlasFocus() {
    const snap = getAtlasSnapshot();
    if (snap.areaResults) {
        clearAreaResults();
        return;
    }
    if (snap.selection) {
        setAtlasSelection(null);
        const next = getAtlasSnapshot();
        patchAtlasSnapshot({
            stats: buildDashboardStats(next, { scope: next.prefs?.dashScope || 'network' })
        });
        syncAtlasMapLayers(getAtlasSnapshot());
    }
}

/**
 * Refresh dashboard stats for network vs selection scope.
 * @param {'network'|'selection'} scope
 */
export function setDashboardScope(scope) {
    const snap = getAtlasSnapshot();
    patchAtlasSnapshot({ stats: buildDashboardStats(snap, { scope }) });
}

/**
 * Navigate from a finding to the related map/details entity.
 * @param {import('./types.js').AtlasFinding} finding
 */
export function selectFindingEntity(finding) {
    if (!finding) return;
    const snap = getAtlasSnapshot();
    if (finding.entityId) {
        if (finding.entityKind === 'drop' || snap.drops.some((d) => d.id === finding.entityId)) {
            selectAtlasEntity({ kind: 'drop', id: finding.entityId });
            return;
        }
        if (finding.entityKind === 'channel' || snap.channels.some((c) => c.id === finding.entityId)) {
            selectAtlasEntity({ kind: 'channel', id: finding.entityId });
            return;
        }
        if (finding.entityKind === 'hub' || snap.hubs.some((h) => h.id === finding.entityId)) {
            selectAtlasEntity({ kind: 'hub', id: finding.entityId });
            return;
        }
        if (finding.entityKind === 'device' || snap.devices.some((d) => d.id === finding.entityId)) {
            selectAtlasEntity({ kind: 'device', id: finding.entityId });
            return;
        }
        if (finding.entityKind === 'site' || snap.sites.some((s) => s.id === finding.entityId)) {
            selectAtlasEntity({ kind: 'site', id: finding.entityId });
            return;
        }
    }
    if (finding.ip) {
        const drop = snap.drops.find((d) => d.ip === finding.ip);
        if (drop) {
            selectAtlasEntity({ kind: 'drop', id: drop.id });
            return;
        }
        const device = snap.devices.find((d) => d.ip === finding.ip);
        if (device) {
            selectAtlasEntity({ kind: 'device', id: device.id });
        }
    }
}

export { applyFindingStatusPatch } from './findings-status.js';

export function updateFindingStatus(findingId, status) {
    if (!isFindingStatus(status) || !findingId) return;
    const snap = getAtlasSnapshot();
    const findings = applyFindingStatusPatch(snap.findings, [findingId], status);
    patchAtlasSnapshot({ findings, stats: buildDashboardStats({ ...snap, findings }) });
    void db()?.updateFinding?.(findingId, { status });
}

/**
 * Update many findings to the same status (memory once, persist each).
 * @param {string[]} findingIds
 * @param {string} status
 * @returns {Promise<number>}
 */
export async function bulkUpdateFindingStatus(findingIds, status) {
    const ids = [...new Set((findingIds || []).filter(Boolean))];
    if (!ids.length || !isFindingStatus(status)) return 0;
    const snap = getAtlasSnapshot();
    const findings = applyFindingStatusPatch(snap.findings, ids, status);
    patchAtlasSnapshot({ findings, stats: buildDashboardStats({ ...snap, findings }) });
    const service = db();
    if (service?.updateFinding) {
        await Promise.all(ids.map((id) => service.updateFinding(id, { status }).catch(() => {})));
    }
    notify(`Updated ${ids.length} finding${ids.length === 1 ? '' : 's'} → ${status}`, 'success');
    return ids.length;
}

/**
 * @param {string} findingId
 * @param {string} notes
 */
export function updateFindingNotes(findingId, notes) {
    const snap = getAtlasSnapshot();
    const findings = snap.findings.map((f) =>
        f.id === findingId ? { ...f, notes: notes || '' } : f);
    patchAtlasSnapshot({ findings });
    void db()?.updateFinding?.(findingId, { notes: notes || '' });
}

/**
 * Reload network snapshot from SQLite (stops active monitor without CSV if present).
 * @param {{ forceStopMonitor?: boolean }} [opts]
 */
export async function reloadAtlasFromDb(opts = {}) {
    const active = getAtlasSnapshot().activeSession;
    if (active) {
        if (!opts.forceStopMonitor) {
            throw new Error('A monitor session is active — confirm stop before reload');
        }
        stopAtlasMonitor(active.id, { exportCsv: false });
    }
    await refreshAtlasFromDb();
    notify('Reloaded Atlas from database', 'success');
    return getAtlasSnapshot();
}

export { resetAtlasSnapshot };
