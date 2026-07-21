/**
 * Operator triage helpers (unreachable / stale / untested in current scope).
 */
import { displayPingStatus, formatPingAge, getPingEntry, isPingStale } from './ping-format.js';

/** @type {Record<string, number>} higher = worse (tie-break for majority fill) */
const FILL_RANK = {
    unreachable: 5,
    intermittent: 4,
    stale_unreachable: 3,
    no_ip: 2,
    stale_reachable: 2,
    reachable: 1,
    pending: 0,
    untested: 0,
    mixed: 0
};

const PROBLEM_STATUSES = new Set(['unreachable', 'intermittent', 'stale_unreachable']);
const UP_STATUSES = new Set(['reachable', 'stale_reachable']);

/**
 * @param {import('./types.js').AtlasSnapshot} snap
 * @param {'network'|'selection'} [scope]
 * @returns {import('./types.js').AtlasDrop[]}
 */
export function dropsInScope(snap, scope = 'network') {
    let drops = snap.drops || [];

    // Explicit entity selection wins over a stale area query
    if (scope === 'selection' && snap.selection && snap.selection.kind !== 'area') {
        const sel = snap.selection;
        if (sel.kind === 'hub') {
            const hub = (snap.hubs || []).find((h) => h.id === sel.id);
            const channels = (snap.channels || []).filter(
                (c) => c.primaryHubId === sel.id || c.secondaryHubId === sel.id
                    || (hub && (c.primaryHubCode === hub.hubCode || c.secondaryHubCode === hub.hubCode))
            );
            const chIds = new Set(channels.map((c) => c.id));
            return drops.filter((d) => chIds.has(d.channelId));
        }
        if (sel.kind === 'channel') {
            return drops.filter((d) => d.channelId === sel.id);
        }
        if (sel.kind === 'drop') {
            return drops.filter((d) => d.id === sel.id);
        }
        if (sel.kind === 'device') {
            const device = (snap.devices || []).find((d) => d.id === sel.id);
            if (!device) return [];
            return drops.filter((d) => d.deviceId === device.id || (device.ip && d.ip === device.ip));
        }
        if (sel.kind === 'site') {
            return drops.filter((d) => d.siteId === sel.id);
        }
    }
    if (scope === 'selection' && snap.areaResults) {
        return snap.areaResults.drops || [];
    }
    return drops;
}

/**
 * Findings linked to drops/entities in the current scope.
 * @param {import('./types.js').AtlasSnapshot} snap
 * @param {'network'|'selection'} [scope]
 */
export function findingsInScope(snap, scope = 'network') {
    const findings = snap.findings || [];
    if (scope !== 'selection') return findings;

    if (snap.selection && snap.selection.kind !== 'area') {
        const sel = snap.selection;
        const drops = dropsInScope(snap, 'selection');
        const dropIds = new Set(drops.map((d) => d.id));
        const dropIps = new Set(drops.map((d) => d.ip).filter(Boolean));
        const chIds = new Set(drops.map((d) => d.channelId).filter(Boolean));
        return findings.filter((f) => {
            if (f.entityId === sel.id) return true;
            if (f.entityId && dropIds.has(f.entityId)) return true;
            if (f.entityKind === 'channel' && f.entityId && chIds.has(f.entityId)) return true;
            if (f.ip && dropIps.has(f.ip)) return true;
            return false;
        });
    }

    if (snap.areaResults) {
        const dropIds = new Set((snap.areaResults.drops || []).map((d) => d.id));
        const dropIps = new Set((snap.areaResults.drops || []).map((d) => d.ip).filter(Boolean));
        return findings.filter((f) =>
            (f.entityId && dropIds.has(f.entityId))
            || (f.ip && dropIps.has(f.ip))
            || (snap.areaResults.warnings || []).some((w) => w.id === f.id)
        );
    }

    return findings;
}

/**
 * @param {import('./types.js').AtlasSnapshot} snap
 * @param {{
 *   scope?: 'network'|'selection',
 *   mode?: 'unreachable'|'stale'|'untested'|'attention'
 * }} [opts]
 * mode attention = unreachable OR stale OR untested
 */
export function listScopedDropsByPing(snap, opts = {}) {
    const scope = opts.scope || 'network';
    const mode = opts.mode || 'unreachable';
    // backward compat
    const includeUntested = opts.includeUntested === true;

    const drops = dropsInScope(snap, scope);

    return drops
        .filter((d) => d.ip)
        .map((d) => {
            const ping = getPingEntry(snap.pingResults, d.ip) || { status: 'untested' };
            const raw = ping.status || 'untested';
            const display = displayPingStatus(ping, { hasIp: true });
            return {
                drop: d,
                ip: d.ip,
                status: raw,
                displayStatus: display,
                rttMs: ping.rttMs ?? null,
                at: ping.at || null,
                age: formatPingAge(ping.at),
                stale: isPingStale(ping.at),
                untested: raw === 'untested' || !raw
            };
        })
        .filter((row) => {
            if (mode === 'unreachable') {
                return row.displayStatus === 'unreachable' || row.displayStatus === 'stale_unreachable';
            }
            if (mode === 'stale') {
                return row.displayStatus === 'stale_reachable' || row.displayStatus === 'stale_unreachable';
            }
            if (mode === 'untested' || includeUntested) return row.untested;
            if (mode === 'attention') {
                return row.displayStatus === 'unreachable'
                    || row.displayStatus === 'stale_unreachable'
                    || row.displayStatus === 'stale_reachable'
                    || row.displayStatus === 'intermittent'
                    || row.untested
                    || row.stale;
            }
            return false;
        })
        .sort((a, b) => String(a.drop.channelNumber || '').localeCompare(String(b.drop.channelNumber || ''))
            || (a.drop.dropNumber ?? 0) - (b.drop.dropNumber ?? 0));
}

/**
 * Collect switch IPs for a hub (primary, secondary, or all related channels).
 * @param {string} hubId
 * @param {'all'|'primary'|'secondary'} [role]
 * @param {import('./types.js').AtlasSnapshot} snap
 */
export function collectHubIps(hubId, role = 'all', snap) {
    const hub = (snap.hubs || []).find((h) => h.id === hubId);
    if (!hub) return [];
    let channels = snap.channels || [];
    if (role === 'primary') {
        channels = channels.filter((c) => c.primaryHubId === hubId || c.primaryHubCode === hub.hubCode);
    } else if (role === 'secondary') {
        channels = channels.filter((c) => c.secondaryHubId === hubId || c.secondaryHubCode === hub.hubCode);
    } else {
        channels = channels.filter(
            (c) => c.primaryHubId === hubId || c.secondaryHubId === hubId
                || c.primaryHubCode === hub.hubCode || c.secondaryHubCode === hub.hubCode
        );
    }
    const chIds = new Set(channels.map((c) => c.id));
    return [...new Set(
        (snap.drops || [])
            .filter((d) => chIds.has(d.channelId) && d.ip)
            .map((d) => d.ip)
    )];
}

/**
 * Majority + issue rollup across switch IPs (hubs / channels).
 * @param {string[]} ips
 * @param {import('./types.js').AtlasSnapshot} snap
 * @returns {{ status: string, fillStatus: string, issue: 0|1 }}
 */
export function describeIpsPingRollup(ips, snap) {
    const list = [...new Set((ips || []).filter(Boolean))];
    if (!list.length) {
        return { status: 'untested', fillStatus: 'untested', issue: 0 };
    }

    /** @type {string[]} */
    const statuses = [];
    for (const ip of list) {
        const ping = getPingEntry(snap.pingResults, ip);
        statuses.push(displayPingStatus(ping || { status: 'untested' }, { hasIp: true }));
    }

    const forMajority = statuses.filter((s) => s !== 'pending');
    if (!forMajority.length) {
        return { status: 'pending', fillStatus: 'pending', issue: 0 };
    }

    /** @type {Record<string, number>} */
    const counts = {};
    for (const s of forMajority) {
        counts[s] = (counts[s] || 0) + 1;
    }

    let fillStatus = 'untested';
    let bestCount = -1;
    let bestRank = -1;
    for (const [s, c] of Object.entries(counts)) {
        const rank = FILL_RANK[s] ?? 0;
        if (c > bestCount || (c === bestCount && rank > bestRank)) {
            bestCount = c;
            bestRank = rank;
            fillStatus = s;
        }
    }

    const hasProblem = forMajority.some((s) => PROBLEM_STATUSES.has(s));
    const hasUp = forMajority.some((s) => UP_STATUSES.has(s));
    const mixed = hasProblem && hasUp;
    const issue = /** @type {0|1} */ (hasProblem ? 1 : 0);

    return {
        status: mixed ? 'mixed' : fillStatus,
        fillStatus,
        issue
    };
}

/**
 * @param {string[]} ips
 * @param {import('./types.js').AtlasSnapshot} snap
 * @returns {string}
 */
export function ipsPingRollup(ips, snap) {
    return describeIpsPingRollup(ips, snap).status;
}

/**
 * Hub device ping (official Hub List IP) — same display rules as a drop.
 * Child switch problems are exposed only via `issue` (map red center).
 * @param {string} hubId
 * @param {import('./types.js').AtlasSnapshot} snap
 * @returns {{ status: string, fillStatus: string, issue: 0|1, childStatus: string }}
 */
export function describeHubPing(hubId, snap) {
    const hub = (snap.hubs || []).find((h) => h.id === hubId);
    const hubIp = hub?.hubIp != null ? String(hub.hubIp).trim() : '';
    const hasIp = Boolean(hubIp);
    const ping = hasIp ? getPingEntry(snap.pingResults, hubIp) : null;
    const status = displayPingStatus(ping, { hasIp });
    const children = describeIpsPingRollup(collectHubIps(hubId, 'all', snap), snap);
    return {
        status,
        fillStatus: status,
        issue: children.issue,
        childStatus: children.status
    };
}

/**
 * Hub map / tree color from the hub's own IP ping (not channel-switch rollup).
 * @param {string} hubId
 * @param {import('./types.js').AtlasSnapshot} snap
 */
export function hubPingRollup(hubId, snap) {
    return describeHubPing(hubId, snap).status;
}

/**
 * @param {string} channelId
 * @param {import('./types.js').AtlasSnapshot} snap
 */
export function channelPingRollup(channelId, snap) {
    const ips = (snap.drops || [])
        .filter((d) => d.channelId === channelId && d.ip)
        .map((d) => d.ip);
    return ipsPingRollup(ips, snap);
}
