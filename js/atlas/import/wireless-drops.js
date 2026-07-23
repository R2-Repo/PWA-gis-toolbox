/**
 * Wireless drop linking (V2): parent fiber drop association for ATMS radios.
 */
import { inferWireless, pickField, normalizeDropNumber, normalizeChannel } from './normalize.js';

/**
 * @param {object[]} drops
 * @param {object[]} atmsMatches
 * @param {object[]} findings
 */
export function linkWirelessDrops(drops, atmsMatches, findings) {
    const fiberByChannelDrop = new Map();
    for (const drop of drops) {
        if (!drop.wireless && drop.channelNumber && drop.dropNumber != null) {
            fiberByChannelDrop.set(`${drop.channelNumber}|${drop.dropNumber}`, drop);
        }
    }

    for (const m of atmsMatches) {
        if (!m.atms || !inferWireless(m.atms)) continue;
        const parentChannel = normalizeChannel(
            pickField(m.atms.raw || {}, ['Parent Channel', 'Fiber Channel', 'ParentChannel'])
        ) || m.atms.channel;
        const parentDrop = normalizeDropNumber(
            pickField(m.atms.raw || {}, ['Parent Drop', 'ParentDrop'])
        ) ?? m.atms.drop;

        let parent = parentChannel && parentDrop != null
            ? fiberByChannelDrop.get(`${parentChannel}|${parentDrop}`)
            : null;

        if (!parent && m.atms.channel && m.atms.drop != null) {
            parent = fiberByChannelDrop.get(`${m.atms.channel}|${m.atms.drop}`);
        }

        const existingDrop = drops.find((d) => d.ip && d.ip === m.atms.ip);
        if (existingDrop) {
            existingDrop.wireless = true;
            if (parent) {
                existingDrop.parentDropId = parent.id;
                existingDrop.wirelessHopType = inferHopType(m.atms);
            } else if (!existingDrop.channelNumber) {
                findings.push({
                    findingType: 'wireless_missing_parent',
                    severity: 'warning',
                    description: `Wireless device ${m.atms.ip || ''} has no parent fiber drop`,
                    suggestedAction: 'Set parent channel/drop in ATMS or map edit',
                    entityKind: 'drop',
                    ip: m.atms.ip || null
                });
            }
            continue;
        }

        if (!m.atms.ip) continue;
        const wirelessDrop = {
            id: crypto.randomUUID(),
            channelId: parent?.channelId || null,
            channelNumber: parent?.channelNumber || m.atms.channel || null,
            dropNumber: null,
            siteId: parent?.siteId || null,
            inventoryName: m.atms.deviceType || `Wireless ${m.atms.ip}`,
            lat: parent?.lat ?? null,
            lon: parent?.lon ?? null,
            deviceId: null,
            ip: m.atms.ip,
            model: null,
            manufacturer: null,
            wireless: true,
            parentDropId: parent?.id || null,
            wirelessHopType: inferHopType(m.atms)
        };
        drops.push(wirelessDrop);

        if (!parent) {
            findings.push({
                findingType: 'wireless_missing_parent',
                severity: 'warning',
                description: `Wireless drop ${m.atms.ip} added without parent fiber drop`,
                suggestedAction: 'Link parent in import review or map edit',
                entityKind: 'drop',
                ip: m.atms.ip
            });
        }
    }

    return drops;
}

/**
 * @param {object} atms
 */
function inferHopType(atms) {
    const text = `${atms.deviceType || ''} ${JSON.stringify(atms.raw || {})}`.toUpperCase();
    if (text.includes('PTMP') || text.includes('MULTIPOINT')) return 'PTMP';
    if (text.includes('PTP') || text.includes('POINT')) return 'PTP';
    return 'PTP';
}
