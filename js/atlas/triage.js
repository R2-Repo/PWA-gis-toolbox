/**
 * Operator triage helpers (unreachable switches in current scope).
 */
import { formatPingAge, isPingStale } from './ping-format.js';

/**
 * Drops in current dash scope that are unreachable (or optional: untested).
 * @param {import('./types.js').AtlasSnapshot} snap
 * @param {{ scope?: 'network'|'selection', includeUntested?: boolean }} [opts]
 */
export function listScopedDropsByPing(snap, opts = {}) {
    const scope = opts.scope || 'network';
    let drops = snap.drops || [];

    if (scope === 'selection' && snap.areaResults) {
        drops = snap.areaResults.drops || [];
    } else if (scope === 'selection' && snap.selection) {
        const sel = snap.selection;
        if (sel.kind === 'hub') {
            const hub = (snap.hubs || []).find((h) => h.id === sel.id);
            const channels = (snap.channels || []).filter(
                (c) => c.primaryHubId === sel.id || c.secondaryHubId === sel.id
                    || (hub && (c.primaryHubCode === hub.hubCode || c.secondaryHubCode === hub.hubCode))
            );
            const chIds = new Set(channels.map((c) => c.id));
            drops = drops.filter((d) => chIds.has(d.channelId));
        } else if (sel.kind === 'channel') {
            drops = drops.filter((d) => d.channelId === sel.id);
        } else if (sel.kind === 'drop') {
            drops = drops.filter((d) => d.id === sel.id);
        }
    }

    return drops
        .filter((d) => d.ip)
        .map((d) => {
            const ping = snap.pingResults?.[d.ip] || { status: 'untested' };
            return {
                drop: d,
                ip: d.ip,
                status: ping.status || 'untested',
                rttMs: ping.rttMs ?? null,
                at: ping.at || null,
                age: formatPingAge(ping.at),
                stale: isPingStale(ping.at)
            };
        })
        .filter((row) => {
            if (row.status === 'unreachable') return true;
            if (opts.includeUntested && (row.status === 'untested' || !row.status)) return true;
            return false;
        })
        .sort((a, b) => String(a.drop.channelNumber || '').localeCompare(String(b.drop.channelNumber || ''))
            || (a.drop.dropNumber ?? 0) - (b.drop.dropNumber ?? 0));
}
