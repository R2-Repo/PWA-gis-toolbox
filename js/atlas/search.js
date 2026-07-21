/**
 * Universal Atlas search over in-memory snapshot.
 */
import { getAtlasSnapshot } from './store.js';
import { displayPingStatus } from './ping-format.js';
import { channelPingRollup, hubPingRollup, ipsPingRollup } from './triage.js';

/**
 * @typedef {{ kind: string, id: string, label: string, meta?: string, pingStatus?: string|null }} AtlasSearchHit
 */

/**
 * @param {string} query
 * @param {number} [limit=50]
 * @returns {{ hits: AtlasSearchHit[], truncated: boolean, limit: number }}
 */
export function searchAtlasDetailed(query, limit = 50) {
    const q = String(query || '').trim().toLowerCase();
    const cap = Math.max(1, Number(limit) || 50);
    if (!q) return { hits: [], truncated: false, limit: cap };

    const snap = getAtlasSnapshot();
    /** @type {AtlasSearchHit[]} */
    const hits = [];
    const maxScan = cap + 1;

    const push = (hit) => {
        hits.push(hit);
        return hits.length >= maxScan;
    };

    for (const ch of snap.channels || []) {
        if (String(ch.channelNumber).toLowerCase().includes(q)) {
            if (push({
                kind: 'channel',
                id: ch.id,
                label: `Channel ${ch.channelNumber}`,
                meta: [ch.primaryHubCode, ch.secondaryHubCode].filter(Boolean).join(' → '),
                pingStatus: channelPingRollup(ch.id, snap)
            })) break;
        }
    }

    if (hits.length < maxScan) {
        for (const hub of snap.hubs || []) {
            const hay = `${hub.hubCode} ${hub.name || ''}`.toLowerCase();
            if (hay.includes(q)) {
                if (push({
                    kind: 'hub',
                    id: hub.id,
                    label: hub.name || `Hub ${hub.hubCode}`,
                    meta: hub.hubCode,
                    pingStatus: hubPingRollup(hub.id, snap)
                })) break;
            }
        }
    }

    if (hits.length < maxScan) {
        for (const drop of snap.drops || []) {
            const hay = [
                drop.inventoryName,
                drop.channelNumber,
                drop.dropNumber != null ? `d${drop.dropNumber}` : '',
                drop.ip,
                drop.siteId
            ].join(' ').toLowerCase();
            if (hay.includes(q)) {
                const ping = drop.ip ? snap.pingResults?.[drop.ip] : null;
                if (push({
                    kind: 'drop',
                    id: drop.id,
                    label: drop.inventoryName || `Drop ${drop.dropNumber ?? '?'}`,
                    meta: `Ch ${drop.channelNumber || '?'} · D${drop.dropNumber ?? '?'} · ${drop.ip || 'no IP'}`,
                    pingStatus: drop.ip ? displayPingStatus(ping) : null
                })) break;
            }
        }
    }

    if (hits.length < maxScan) {
        for (const site of snap.sites || []) {
            const hay = `${site.inventoryName || ''} ${site.siteId || ''}`.toLowerCase();
            if (hay.includes(q)) {
                const ips = (snap.drops || [])
                    .filter((d) => d.siteId === site.id && d.ip)
                    .map((d) => d.ip);
                if (push({
                    kind: 'site',
                    id: site.id,
                    label: site.inventoryName || site.siteId || site.id,
                    meta: site.siteId || '',
                    pingStatus: ips.length ? ipsPingRollup(ips, snap) : null
                })) break;
            }
        }
    }

    if (hits.length < maxScan) {
        for (const dev of snap.devices || []) {
            const hay = `${dev.ip || ''} ${dev.inventoryName || ''} ${dev.model || ''}`.toLowerCase();
            if (hay.includes(q)) {
                const ping = dev.ip ? snap.pingResults?.[dev.ip] : null;
                if (push({
                    kind: 'device',
                    id: dev.id,
                    label: dev.ip || dev.inventoryName || dev.id,
                    meta: [dev.model, dev.deviceType].filter(Boolean).join(' · '),
                    pingStatus: dev.ip ? displayPingStatus(ping) : null
                })) break;
            }
        }
    }

    const truncated = hits.length > cap;
    return {
        hits: truncated ? hits.slice(0, cap) : hits,
        truncated,
        limit: cap
    };
}

/**
 * @param {string} query
 * @param {number} [limit=50]
 * @returns {AtlasSearchHit[]}
 */
export function searchAtlas(query, limit = 50) {
    return searchAtlasDetailed(query, limit).hits;
}
