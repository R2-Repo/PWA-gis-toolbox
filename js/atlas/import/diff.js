/**
 * Compare a preview import payload against the current Atlas snapshot.
 */

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

    // Changed: same IP, different channel/drop/inventory
    const prevByIp = new Map((current.devices || []).filter((d) => d.ip).map((d) => [d.ip, d]));
    const nextByIp = new Map((payload.devices || []).filter((d) => d.ip).map((d) => [d.ip, d]));
    const changedIps = [];
    for (const [ip, next] of nextByIp) {
        const prev = prevByIp.get(ip);
        if (!prev) continue;
        const prevDrop = (current.drops || []).find((d) => d.ip === ip || d.deviceId === prev.id);
        const nextDrop = (payload.drops || []).find((d) => d.ip === ip || d.deviceId === next.id);
        const changed =
            (prev.inventoryName || '') !== (next.inventoryName || '')
            || (prev.model || '') !== (next.model || '')
            || (prevDrop?.channelNumber || '') !== (nextDrop?.channelNumber || '')
            || (prevDrop?.dropNumber ?? null) !== (nextDrop?.dropNumber ?? null);
        if (changed) changedIps.push(ip);
    }

    return {
        emptyCurrent: !(current.loaded && ((current.drops?.length || 0) > 0 || (current.devices?.length || 0) > 0)),
        newIps,
        missingIps,
        changedIps,
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
