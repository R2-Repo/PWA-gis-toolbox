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
import { buildDashboardStats, exportPingSessionCsv } from './export.js';
import { startPingSession, stopPingSession } from './monitor.js';
import { queryAtlasInArea } from './area-query.js';
import bus from '../core/event-bus.js';

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
        areaResults: getAtlasSnapshot().areaResults
    };
    patchAtlasSnapshot({
        ...base,
        stats: buildDashboardStats(base)
    });
    syncAtlasMapLayers(getAtlasSnapshot());
    enableAtlasMapInteraction((sel) => selectAtlasEntity(sel));
    bus.emit('atlas:opened', getAtlasSnapshot());
    return getAtlasSnapshot();
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
    if (!payload) {
        const preview = await previewAtlasImport(input || {});
        payload = preview.payload;
    }

    await service.applyImport(payload);
    await refreshAtlasFromDb();
    return payload.summary;
}

/**
 * @param {import('./types.js').AtlasSelection} selection
 */
export function selectAtlasEntity(selection) {
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
        throw new Error('ICMP ping requires the Windows desktop app');
    }
    const unique = [...new Set(ips.filter(Boolean))];
    const pending = Object.fromEntries(unique.map((ip) => [ip, { status: 'pending', at: new Date().toISOString() }]));
    setPingStatuses(pending);
    syncAtlasMapLayers(getAtlasSnapshot());

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

    return results;
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
 * @param {object} geometry
 */
export function runAreaQuery(geometry) {
    const results = queryAtlasInArea(geometry);
    patchAtlasSnapshot({ areaResults: results });
    const snap = getAtlasSnapshot();
    patchAtlasSnapshot({ stats: buildDashboardStats(snap, { scope: 'selection' }) });
    return results;
}

/**
 * Start temporary monitoring.
 * @param {{ targets: string[], interval: number|string, label?: string }} opts
 */
export function startAtlasMonitor(opts) {
    const sessionId = crypto.randomUUID();
    const log = [];
    patchAtlasSnapshot({
        activeSession: { id: sessionId, label: opts.label || 'Monitor', targets: opts.targets, interval: opts.interval, log }
    });

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
                activeSession: { id: sessionId, label: opts.label || 'Monitor', targets: opts.targets, interval: opts.interval, log: [...log] }
            });
        },
        onStop: () => {
            patchAtlasSnapshot({ activeSession: null });
        }
    });

    return handle;
}

export function stopAtlasMonitor(sessionId) {
    const active = getAtlasSnapshot().activeSession;
    const id = sessionId || active?.id;
    if (id) stopPingSession(id);
    if (active?.log?.length) {
        exportPingSessionCsv(active.log);
    }
    patchAtlasSnapshot({ activeSession: null });
}

export function leaveAtlasMap() {
    disableAtlasMapInteraction();
    clearAtlasMapLayers();
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
            const device = snap.devices.find((d) => d.id === finding.entityId);
            const drop = snap.drops.find((d) => d.deviceId === device?.id || (device?.ip && d.ip === device.ip));
            if (drop) {
                selectAtlasEntity({ kind: 'drop', id: drop.id });
                return;
            }
        }
    }
    if (finding.ip) {
        const drop = snap.drops.find((d) => d.ip === finding.ip);
        if (drop) {
            selectAtlasEntity({ kind: 'drop', id: drop.id });
            return;
        }
    }
}

export function updateFindingStatus(findingId, status) {
    const snap = getAtlasSnapshot();
    const findings = snap.findings.map((f) =>
        f.id === findingId
            ? { ...f, status, resolvedAt: status === 'Resolved' ? new Date().toISOString() : f.resolvedAt }
            : f);
    patchAtlasSnapshot({ findings, stats: buildDashboardStats({ ...snap, findings }) });
    void db()?.updateFinding?.(findingId, { status });
}

export { resetAtlasSnapshot };
