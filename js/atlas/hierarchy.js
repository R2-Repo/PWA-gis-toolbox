/**
 * Region → Hub → Channel → Drop → Device tree builders.
 */
import { getAtlasSnapshot } from './store.js';

/**
 * @returns {Array<{ id: string, label: string, kind: string, children: object[] }>}
 */
export function buildHierarchyTree() {
    const snap = getAtlasSnapshot();
    const region = {
        id: 'region-default',
        label: 'ITS Network',
        kind: 'region',
        children: []
    };

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
        ? snap.hubs
        : [...channelsByHub.keys()].filter((k) => k !== '_unassigned').map((code) => ({
            id: `hub-${code}`,
            hubCode: code,
            name: `Hub ${code}`
        }));

    for (const hub of hubs) {
        const hubChannels = channelsByHub.get(hub.hubCode) || [];
        const seen = new Set();
        const uniqueChannels = hubChannels.filter((c) => {
            if (seen.has(c.id)) return false;
            seen.add(c.id);
            return true;
        });

        region.children.push({
            id: hub.id,
            label: hub.name || `Hub ${hub.hubCode}`,
            kind: 'hub',
            meta: hub.hubCode,
            children: uniqueChannels.map((ch) => {
                const drops = snap.drops
                    .filter((d) => d.channelId === ch.id)
                    .sort((a, b) => (a.dropNumber ?? 9999) - (b.dropNumber ?? 9999));
                return {
                    id: ch.id,
                    label: `Channel ${ch.channelNumber}`,
                    kind: 'channel',
                    meta: `${drops.length} drops`,
                    children: drops.map((d) => {
                        const device = snap.devices.find((dev) => dev.id === d.deviceId || (d.ip && dev.ip === d.ip));
                        const pingStatus = d.ip
                            ? (snap.pingResults?.[d.ip]?.status || 'untested')
                            : null;
                        return {
                            id: d.id,
                            label: `D${d.dropNumber ?? '?'} · ${d.inventoryName || d.ip || 'drop'}`,
                            kind: 'drop',
                            meta: d.ip || '',
                            pingStatus,
                            children: device
                                ? [{
                                    id: device.id,
                                    label: device.ip || device.model || 'device',
                                    kind: 'device',
                                    meta: device.model || device.deviceType || '',
                                    pingStatus: device.ip
                                        ? (snap.pingResults?.[device.ip]?.status || 'untested')
                                        : null,
                                    children: []
                                }]
                                : []
                        };
                    })
                };
            })
        });
    }

    const orphan = channelsByHub.get('_unassigned') || [];
    if (orphan.length) {
        region.children.push({
            id: 'hub-unassigned',
            label: 'Unassigned channels',
            kind: 'hub',
            children: orphan.map((ch) => ({
                id: ch.id,
                label: `Channel ${ch.channelNumber}`,
                kind: 'channel',
                children: []
            }))
        });
    }

    return [region];
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
