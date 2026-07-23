/**
 * Subnet / drop IP range scan (V2).
 */
import { expectedIpsForChannel, expandDropChunk, classifyScanResult } from './ip-allocation.js';

/**
 * Build scan targets for a channel or single drop.
 * @param {object} snap
 * @param {{ channelNumber?: string, dropId?: string }} scope
 */
export function buildScanTargets(snap, scope) {
    /** @type {Set<string>} */
    const targets = new Set();
    /** @type {Set<string>} */
    const expected = new Set();

    if (scope.dropId) {
        const drop = (snap.drops || []).find((d) => d.id === scope.dropId);
        if (drop?.ip) {
            for (const ip of expandDropChunk(drop.ip)) {
                targets.add(ip);
                expected.add(ip);
            }
        }
        return { targets: [...targets], expected };
    }

    if (scope.channelNumber) {
        const exp = expectedIpsForChannel(snap, scope.channelNumber);
        for (const ip of exp) {
            targets.add(ip);
            expected.add(ip);
        }
        return { targets: [...targets], expected };
    }

    return { targets: [], expected: new Set() };
}

/**
 * Classify ping results from scan.
 * @param {string[]} targets
 * @param {Set<string>} expected
 * @param {Record<string, { reachable?: boolean }>} pingResults
 */
export function classifyScan(targets, expected, pingResults) {
    return targets.map((ip) => {
        const replied = Boolean(pingResults[ip]?.reachable);
        return {
            ip,
            status: classifyScanResult(ip, expected, replied),
            replied
        };
    });
}
