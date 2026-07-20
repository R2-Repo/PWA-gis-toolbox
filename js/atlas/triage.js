/**
 * Operator triage helpers (unreachable / stale / untested in current scope).
 */
import { formatPingAge, isPingStale } from './ping-format.js';

/**
 * @param {import('./types.js').AtlasSnapshot} snap
 * @param {'network'|'selection'} [scope]
 * @returns {import('./types.js').AtlasDrop[]}
 */
export function dropsInScope(snap, scope = 'network') {
    let drops = snap.drops || [];

    if (scope === 'selection' && snap.areaResults) {
        return snap.areaResults.drops || [];
    }
    if (scope === 'selection' && snap.selection) {
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
    return drops;
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
            const ping = snap.pingResults?.[d.ip] || { status: 'untested' };
            const status = ping.status || 'untested';
            return {
                drop: d,
                ip: d.ip,
                status,
                rttMs: ping.rttMs ?? null,
                at: ping.at || null,
                age: formatPingAge(ping.at),
                stale: isPingStale(ping.at),
                untested: status === 'untested' || !status
            };
        })
        .filter((row) => {
            if (mode === 'unreachable') return row.status === 'unreachable';
            if (mode === 'stale') return row.stale && row.status !== 'untested';
            if (mode === 'untested' || includeUntested) return row.untested;
            if (mode === 'attention') {
                return row.status === 'unreachable' || row.untested || row.stale;
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
