/**
 * Universal Atlas search over in-memory snapshot.
 */
import { getAtlasSnapshot } from './store.js';

/**
 * @param {string} query
 * @param {number} [limit=50]
 * @returns {Array<{ kind: string, id: string, label: string, meta?: string }>}
 */
export function searchAtlas(query, limit = 50) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const snap = getAtlasSnapshot();
    /** @type {Array<{ kind: string, id: string, label: string, meta?: string }>} */
    const hits = [];

    for (const ch of snap.channels) {
        if (String(ch.channelNumber).toLowerCase().includes(q)) {
            hits.push({
                kind: 'channel',
                id: ch.id,
                label: `Channel ${ch.channelNumber}`,
                meta: [ch.primaryHubCode, ch.secondaryHubCode].filter(Boolean).join(' → ')
            });
        }
        if (hits.length >= limit) return hits;
    }

    for (const hub of snap.hubs) {
        const hay = `${hub.hubCode} ${hub.name || ''}`.toLowerCase();
        if (hay.includes(q)) {
            hits.push({ kind: 'hub', id: hub.id, label: hub.name || `Hub ${hub.hubCode}`, meta: hub.hubCode });
        }
        if (hits.length >= limit) return hits;
    }

    for (const drop of snap.drops) {
        const hay = [
            drop.inventoryName,
            drop.channelNumber,
            drop.dropNumber != null ? `d${drop.dropNumber}` : '',
            drop.ip,
            drop.siteId
        ].join(' ').toLowerCase();
        if (hay.includes(q)) {
            hits.push({
                kind: 'drop',
                id: drop.id,
                label: drop.inventoryName || `Drop ${drop.dropNumber ?? '?'}`,
                meta: `Ch ${drop.channelNumber || '?'} · D${drop.dropNumber ?? '?'} · ${drop.ip || 'no IP'}`
            });
        }
        if (hits.length >= limit) return hits;
    }

    for (const site of snap.sites) {
        const hay = `${site.inventoryName || ''} ${site.siteId || ''}`.toLowerCase();
        if (hay.includes(q)) {
            hits.push({
                kind: 'site',
                id: site.id,
                label: site.inventoryName || site.siteId || site.id,
                meta: site.siteId || ''
            });
        }
        if (hits.length >= limit) return hits;
    }

    for (const dev of snap.devices) {
        const hay = `${dev.ip || ''} ${dev.inventoryName || ''} ${dev.model || ''}`.toLowerCase();
        if (hay.includes(q)) {
            hits.push({
                kind: 'device',
                id: dev.id,
                label: dev.ip || dev.inventoryName || dev.id,
                meta: [dev.model, dev.deviceType].filter(Boolean).join(' · ')
            });
        }
        if (hits.length >= limit) return hits;
    }

    return hits;
}
