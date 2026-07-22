/**
 * Region → Hub → Channel → Drop → Device (+ Sites) tree builders.
 * Labels: short primary + optional secondary (inventory/AKA) for narrow panels.
 */
import { getAtlasSnapshot } from './store.js';
import { displayPingStatus, getPingEntry } from './ping-format.js';
import { channelPingRollup, hubPingRollup, ipsPingRollup } from './triage.js';
import {
    formatChannelPrimary,
    formatDropPrimary,
    formatHubTreeLabel
} from './display-label.js';

export { formatHubTreeLabel } from './display-label.js';

/**
 * @param {string|null|undefined} regionId
 * @returns {string}
 */
function regionKey(regionId) {
    if (regionId == null || String(regionId).trim() === '') return '_none';
    return String(regionId).trim();
}

/**
 * @param {string} a
 * @param {string} b
 */
function compareRegionKeys(a, b) {
    if (a === '_none') return 1;
    if (b === '_none') return -1;
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === a && String(nb) === b) {
        return na - nb;
    }
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * @param {{ hubCode?: string, name?: string, aka?: string }} a
 * @param {{ hubCode?: string, name?: string, aka?: string }} b
 */
function compareHubs(a, b) {
    return String(a.hubCode || a.name || '').localeCompare(
        String(b.hubCode || b.name || ''),
        undefined,
        { numeric: true, sensitivity: 'base' }
    );
}

/**
 * @param {object} hub
 * @param {Map<string, object[]>} channelsByHub
 * @param {ReturnType<typeof getAtlasSnapshot>} snap
 */
function buildHubNode(hub, channelsByHub, snap) {
    const hubChannels = channelsByHub.get(hub.hubCode) || [];
    const seen = new Set();
    const uniqueChannels = hubChannels.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
    });

    return {
        id: hub.id,
        label: formatHubTreeLabel(hub.hubCode),
        kind: 'hub',
        secondary: hub.aka || null,
        pingStatus: hubPingRollup(hub.id, snap),
        children: uniqueChannels.map((ch) => {
            const drops = snap.drops
                .filter((d) => d.channelId === ch.id)
                .sort((a, b) => (a.dropNumber ?? 9999) - (b.dropNumber ?? 9999));
            return {
                id: ch.id,
                label: formatChannelPrimary(ch.channelNumber),
                kind: 'channel',
                secondary: `${drops.length} drops`,
                pingStatus: channelPingRollup(ch.id, snap),
                children: drops.map((d) => {
                    const device = snap.devices.find((dev) => dev.id === d.deviceId || (d.ip && dev.ip === d.ip));
                    const pingStatus = d.ip
                        ? displayPingStatus(getPingEntry(snap.pingResults, d.ip), { hasIp: true })
                        : null;
                    return {
                        id: d.id,
                        label: formatDropPrimary(d.dropNumber),
                        kind: 'drop',
                        secondary: d.inventoryName || d.ip || null,
                        title: [formatDropPrimary(d.dropNumber), d.inventoryName, d.ip]
                            .filter(Boolean)
                            .join(' · '),
                        pingStatus,
                        children: device
                            ? [{
                                id: device.id,
                                label: device.ip || device.model || 'device',
                                kind: 'device',
                                secondary: device.model || device.deviceType || null,
                                pingStatus: device.ip
                                    ? displayPingStatus(getPingEntry(snap.pingResults, device.ip), { hasIp: true })
                                    : null,
                                children: []
                            }]
                            : []
                    };
                })
            };
        })
    };
}

/**
 * @returns {Array<{ id: string, label: string, kind: string, children: object[] }>}
 */
export function buildHierarchyTree() {
    const snap = getAtlasSnapshot();
    /** @type {Array<{ id: string, label: string, kind: string, meta?: string|null, children: object[] }>} */
    const roots = [];

    const channelsByHub = new Map();
    for (const ch of snap.channels) {
        const codes = [ch.primaryHubCode, ch.secondaryHubCode].filter(Boolean);
        if (!codes.length) {
            const key = '_unassigned';
            if (!channelsByHub.has(key)) channelsByHub.set(key, []);
            channelsByHub.get(key).push(ch);
            continue;
        }
        for (const code of codes) {
            if (!channelsByHub.has(code)) channelsByHub.set(code, []);
            channelsByHub.get(code).push(ch);
        }
    }

    const hubs = snap.hubs.length
        ? [...snap.hubs]
        : [...channelsByHub.keys()].filter((k) => k !== '_unassigned').map((code) => ({
            id: `hub-${code}`,
            hubCode: code,
            name: `Hub ${code}`,
            aka: null,
            regionId: null
        }));

    hubs.sort(compareHubs);

    /** @type {Map<string, typeof hubs>} */
    const hubsByRegion = new Map();
    for (const hub of hubs) {
        const key = regionKey(hub.regionId);
        if (!hubsByRegion.has(key)) hubsByRegion.set(key, []);
        hubsByRegion.get(key).push(hub);
    }

    const regionKeys = [...hubsByRegion.keys()].sort(compareRegionKeys);
    for (const key of regionKeys) {
        const regionHubs = hubsByRegion.get(key) || [];
        roots.push({
            id: key === '_none' ? 'region-none' : `region-${key}`,
            label: key === '_none' ? 'Unassigned region' : `Region ${key}`,
            kind: 'region',
            children: regionHubs.map((hub) => buildHubNode(hub, channelsByHub, snap))
        });
    }

    const orphan = channelsByHub.get('_unassigned') || [];
    if (orphan.length) {
        let target = roots.find((r) => r.id === 'region-none');
        if (!target) {
            target = {
                id: 'region-none',
                label: 'Unassigned region',
                kind: 'region',
                children: []
            };
            roots.push(target);
        }
        target.children.push({
            id: 'hub-unassigned',
            label: 'Unassigned channels',
            kind: 'hub',
            children: orphan.map((ch) => ({
                id: ch.id,
                label: formatChannelPrimary(ch.channelNumber),
                kind: 'channel',
                pingStatus: channelPingRollup(ch.id, snap),
                children: []
            }))
        });
    }

    const sites = [...(snap.sites || [])].sort((a, b) =>
        String(a.inventoryName || a.siteId || a.id)
            .localeCompare(String(b.inventoryName || b.siteId || b.id)));
    if (sites.length) {
        roots.push({
            id: 'sites-root',
            label: `Sites (${sites.length})`,
            kind: 'region',
            secondary: 'by inventory',
            children: sites.map((site) => {
                const siteDrops = (snap.drops || []).filter((d) => d.siteId === site.id);
                const ips = siteDrops.map((d) => d.ip).filter(Boolean);
                const primary = site.siteId || site.id;
                return {
                    id: site.id,
                    label: primary,
                    kind: 'site',
                    secondary: site.inventoryName || `${siteDrops.length} drops`,
                    title: [site.inventoryName, site.siteId].filter(Boolean).join(' · ') || String(primary),
                    pingStatus: ips.length ? ipsPingRollup(ips, snap) : null,
                    children: siteDrops.map((d) => ({
                        id: d.id,
                        label: formatDropPrimary(d.dropNumber),
                        kind: 'drop',
                        secondary: d.inventoryName || d.ip || null,
                        title: [
                            formatDropPrimary(d.dropNumber),
                            d.channelNumber != null ? formatChannelPrimary(d.channelNumber) : null,
                            d.inventoryName,
                            d.ip
                        ].filter(Boolean).join(' · '),
                        pingStatus: d.ip
                            ? displayPingStatus(getPingEntry(snap.pingResults, d.ip), { hasIp: true })
                            : null,
                        children: []
                    }))
                };
            })
        });
    }

    return roots;
}

/**
 * @param {string} hubId
 */
export function getHubChannelSummary(hubId) {
    const snap = getAtlasSnapshot();
    const hub = snap.hubs.find((h) => h.id === hubId);
    if (!hub) return null;
    const primary = snap.channels.filter((c) => c.primaryHubId === hubId || c.primaryHubCode === hub.hubCode);
    const secondary = snap.channels.filter((c) => c.secondaryHubId === hubId || c.secondaryHubCode === hub.hubCode);
    const summarize = (ch) => {
        const drops = snap.drops
            .filter((d) => d.channelId === ch.id)
            .sort((a, b) => (a.dropNumber ?? 9999) - (b.dropNumber ?? 9999));
        return {
            channel: ch,
            dropCount: drops.length,
            firstDrop: drops[0] || null,
            lastDrop: drops[drops.length - 1] || null
        };
    };
    return {
        hub,
        primary: primary.map(summarize),
        secondary: secondary.map(summarize)
    };
}
