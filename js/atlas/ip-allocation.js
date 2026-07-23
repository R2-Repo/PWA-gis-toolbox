/**
 * IP allocation rules for channel/drop range scan (V2).
 */

/**
 * Parse IPv4 to 32-bit int.
 * @param {string} ip
 */
export function ipToInt(ip) {
    const parts = String(ip || '').trim().split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/**
 * @param {number} n
 */
export function intToIp(n) {
    return [
        (n >>> 24) & 255,
        (n >>> 16) & 255,
        (n >>> 8) & 255,
        n & 255
    ].join('.');
}

/**
 * Default: drop switch IP is base; chunk size 16 addresses (switch + devices).
 * @param {string} switchIp
 * @param {number} [chunkSize]
 */
export function expandDropChunk(switchIp, chunkSize = 16) {
    const base = ipToInt(switchIp);
    if (base == null) return [];
    const out = [];
    for (let i = 0; i < chunkSize; i++) {
        out.push(intToIp((base + i) >>> 0));
    }
    return out;
}

/**
 * Collect expected IPs for a channel from drops + devices.
 * @param {object} snap
 * @param {string} channelNumber
 */
export function expectedIpsForChannel(snap, channelNumber) {
    const ips = new Set();
    for (const drop of snap.drops || []) {
        if (drop.channelNumber !== channelNumber) continue;
        if (drop.ip) ips.add(drop.ip);
        if (drop.ip) {
            for (const ip of expandDropChunk(drop.ip, 8)) ips.add(ip);
        }
    }
    for (const dev of snap.devices || []) {
        const drop = (snap.drops || []).find((d) => d.id === dev.dropId);
        if (drop?.channelNumber === channelNumber && dev.ip) ips.add(dev.ip);
    }
    return ips;
}

/**
 * @param {string} ip
 * @param {Set<string>} expected
 * @param {boolean} replied
 */
export function classifyScanResult(ip, expected, replied) {
    const known = expected.has(ip);
    if (known && replied) return 'expected_up';
    if (known && !replied) return 'expected_down';
    if (!known && replied) return 'rogue';
    return 'dark';
}
