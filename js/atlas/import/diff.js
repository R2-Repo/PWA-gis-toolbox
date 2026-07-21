/**
 * Compare a preview import payload against the current Atlas snapshot.
 */

/**
 * @param {object} prev
 * @param {object} next
 * @param {object|null} prevDrop
 * @param {object|null} nextDrop
 * @returns {Array<{ field: string, from: string, to: string }>}
 */
function collectIpChanges(prev, next, prevDrop, nextDrop) {
    /** @type {Array<{ field: string, from: string, to: string }>} */
    const changes = [];
    const push = (field, from, to) => {
        const a = from == null ? '' : String(from);
        const b = to == null ? '' : String(to);
        if (a !== b) changes.push({ field, from: a, to: b });
    };
    push('inventoryName', prev.inventoryName, next.inventoryName);
    push('model', prev.model, next.model);
    push('manufacturer', prev.manufacturer, next.manufacturer);
    push('deviceType', prev.deviceType, next.deviceType);
    push('channel', prevDrop?.channelNumber, nextDrop?.channelNumber);
    push('drop', prevDrop?.dropNumber, nextDrop?.dropNumber);
    return changes;
}

/**
 * @param {object} payload from buildAtlasImportPayload
 * @param {import('../types.js').AtlasSnapshot} current
 */
export function diffAtlasImport(payload, current) {
    const nextIps = new Set((payload.devices || []).map((d) => d.ip).filter(Boolean));
    const prevIps = new Set((current.devices || []).map((d) => d.ip).filter(Boolean));
    const nextChannels = new Set((payload.channels || []).map((c) => String(c.channelNumber)));
    const prevChannels = new Set((current.channels || []).map((c) => String(c.channelNumber)));
    const nextDrops = new Set(
        (payload.drops || [])
            .filter((d) => d.channelNumber != null && d.dropNumber != null)
            .map((d) => `${d.channelNumber}|${d.dropNumber}`)
    );
    const prevDrops = new Set(
        (current.drops || [])
            .filter((d) => d.channelNumber != null && d.dropNumber != null)
            .map((d) => `${d.channelNumber}|${d.dropNumber}`)
    );

    const newIps = [...nextIps].filter((ip) => !prevIps.has(ip));
    const missingIps = [...prevIps].filter((ip) => !nextIps.has(ip));
    const newChannels = [...nextChannels].filter((c) => !prevChannels.has(c));
    const missingChannels = [...prevChannels].filter((c) => !nextChannels.has(c));
    const newDrops = [...nextDrops].filter((k) => !prevDrops.has(k));
    const missingDrops = [...prevDrops].filter((k) => !nextDrops.has(k));

    const prevByIp = new Map((current.devices || []).filter((d) => d.ip).map((d) => [d.ip, d]));
    const nextByIp = new Map((payload.devices || []).filter((d) => d.ip).map((d) => [d.ip, d]));
    /** @type {string[]} */
    const changedIps = [];
    /** @type {Array<{ ip: string, changes: Array<{ field: string, from: string, to: string }> }>} */
    const changedIpDetails = [];
    for (const [ip, next] of nextByIp) {
        const prev = prevByIp.get(ip);
        if (!prev) continue;
        const prevDrop = (current.drops || []).find((d) => d.ip === ip || d.deviceId === prev.id);
        const nextDrop = (payload.drops || []).find((d) => d.ip === ip || d.deviceId === next.id);
        const changes = collectIpChanges(prev, next, prevDrop, nextDrop);
        if (changes.length) {
            changedIps.push(ip);
            changedIpDetails.push({ ip, changes });
        }
    }

    return {
        emptyCurrent: !(current.loaded && ((current.drops?.length || 0) > 0 || (current.devices?.length || 0) > 0)),
        newIps,
        missingIps,
        changedIps,
        changedIpDetails,
        newChannels,
        missingChannels,
        newDrops,
        missingDrops,
        counts: {
            newIps: newIps.length,
            missingIps: missingIps.length,
            changedIps: changedIps.length,
            newChannels: newChannels.length,
            missingChannels: missingChannels.length,
            newDrops: newDrops.length,
            missingDrops: missingDrops.length
        }
    };
}
