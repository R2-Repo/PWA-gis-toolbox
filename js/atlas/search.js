/**
 * Universal Atlas search over in-memory snapshot.
 */
import { getAtlasSnapshot } from './store.js';
import { displayPingStatus, getPingEntry } from './ping-format.js';
import { channelPingRollup, hubPingRollup, ipsPingRollup } from './triage.js';
import {
    formatAtlasEntityLines,
    formatChannelPrimary,
    formatDropPrimary,
    formatHubTreeLabel
} from './display-label.js';
import { connectedBuildingIps } from './import/connected-buildings.js';

/**
 * @typedef {{
 *   kind: string,
 *   id: string,
 *   label: string,
 *   secondary?: string|null,
 *   meta?: string,
 *   title?: string,
 *   pingStatus?: string|null
 * }} AtlasSearchHit
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
            const lines = formatAtlasEntityLines('channel', {
                channelNumber: ch.channelNumber,
                primaryHubCode: ch.primaryHubCode,
                secondaryHubCode: ch.secondaryHubCode
            });
            if (push({
                kind: 'channel',
                id: ch.id,
                label: lines.primary,
                secondary: lines.secondary,
                title: lines.title,
                pingStatus: channelPingRollup(ch.id, snap)
            })) break;
        }
    }

    if (hits.length < maxScan) {
        for (const hub of snap.hubs || []) {
            const hay = `${hub.hubCode} ${hub.name || ''} ${hub.aka || ''}`.toLowerCase();
            if (hay.includes(q)) {
                const lines = formatAtlasEntityLines('hub', hub);
                if (push({
                    kind: 'hub',
                    id: hub.id,
                    label: lines.primary || formatHubTreeLabel(hub.hubCode),
                    secondary: lines.secondary,
                    title: lines.title,
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
                const ping = drop.ip ? getPingEntry(snap.pingResults, drop.ip) : null;
                const lines = formatAtlasEntityLines('drop', drop);
                const metaBits = [
                    drop.channelNumber != null ? formatChannelPrimary(drop.channelNumber) : null,
                    drop.ip || null
                ].filter(Boolean);
                if (push({
                    kind: 'drop',
                    id: drop.id,
                    label: lines.primary || formatDropPrimary(drop.dropNumber),
                    secondary: drop.inventoryName || metaBits.join(' · ') || null,
                    title: lines.title || [formatDropPrimary(drop.dropNumber), drop.inventoryName, ...metaBits]
                        .filter(Boolean)
                        .join(' · '),
                    pingStatus: drop.ip ? displayPingStatus(ping, { hasIp: true }) : null
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
                const lines = formatAtlasEntityLines('site', site);
                if (push({
                    kind: 'site',
                    id: site.id,
                    label: lines.primary,
                    secondary: lines.secondary,
                    title: lines.title,
                    pingStatus: ips.length ? ipsPingRollup(ips, snap) : null
                })) break;
            }
        }
    }

    if (hits.length < maxScan) {
        for (const dev of snap.devices || []) {
            const hay = `${dev.ip || ''} ${dev.inventoryName || ''} ${dev.model || ''}`.toLowerCase();
            if (hay.includes(q)) {
                const ping = dev.ip ? getPingEntry(snap.pingResults, dev.ip) : null;
                const lines = formatAtlasEntityLines('device', { ...dev, inventoryName: dev.inventoryName });
                if (push({
                    kind: 'device',
                    id: dev.id,
                    label: lines.primary,
                    secondary: lines.secondary || dev.inventoryName || null,
                    title: lines.title,
                    pingStatus: dev.ip ? displayPingStatus(ping, { hasIp: true }) : null
                })) break;
            }
        }
    }

    if (hits.length < maxScan) {
        for (const building of snap.connectedBuildings || []) {
            const ips = connectedBuildingIps(building);
            const hay = [
                building.buildingName,
                building.buildingType,
                building.provider,
                building.status,
                building.address,
                building.fromHub,
                building.toHub,
                building.regionId,
                ...ips
            ].join(' ').toLowerCase();
            if (hay.includes(q)) {
                const lines = formatAtlasEntityLines('building', building);
                if (push({
                    kind: 'building',
                    id: building.id,
                    label: lines.primary,
                    secondary: lines.secondary,
                    title: lines.title,
                    pingStatus: null
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
