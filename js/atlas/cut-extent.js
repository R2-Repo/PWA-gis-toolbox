/**
 * Cut extent assistant (V2): probable fiber hit zone from multi-channel down footprints.
 */

/**
 * @param {{ lat: number, lon: number }[]} points
 */
function convexHull(points) {
    if (points.length < 3) return points;
    const sorted = [...points].sort((a, b) => a.lat - b.lat || a.lon - b.lon);
    const cross = (o, a, b) => (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
    const lower = [];
    for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

/**
 * @param {object} snap
 * @param {object} pingResults
 * @param {{ dropIds?: string[], channelNumbers?: string[] }} scope
 */
export function computeCutExtent(snap, pingResults, scope) {
    const dropIds = new Set(scope.dropIds || []);
    const channels = new Set(scope.channelNumbers || []);

    /** @type {Map<string, { lat: number, lon: number }[]>} */
    const downsByChannel = new Map();

    for (const drop of snap.drops || []) {
        if (dropIds.size && !dropIds.has(drop.id)) continue;
        if (channels.size && !channels.has(drop.channelNumber)) continue;
        if (drop.lat == null || drop.lon == null) continue;
        const ping = pingResults[drop.ip];
        const down = ping && ping.reachable === false;
        if (!down) continue;
        const ch = drop.channelNumber || 'unknown';
        if (!downsByChannel.has(ch)) downsByChannel.set(ch, []);
        downsByChannel.get(ch).push({ lat: drop.lat, lon: drop.lon, dropId: drop.id });
    }

    const channelFootprints = [...downsByChannel.entries()].map(([channelNumber, pts]) => ({
        channelNumber,
        hull: convexHull(pts),
        count: pts.length
    }));

    /** Simple overlap: centroid average of channels with downs */
    const allDown = channelFootprints.flatMap((f) => f.hull);
    if (allDown.length < 2) {
        return {
            probableZone: null,
            channelFootprints,
            implicatedChannels: channelFootprints.map((f) => f.channelNumber),
            confidence: 'low',
            message: 'Need downs on at least two points to suggest a zone'
        };
    }

    const implicated = channelFootprints.filter((f) => f.count >= 1).map((f) => f.channelNumber);
    const confidence = implicated.length >= 2 ? 'medium' : 'low';
    const avgLat = allDown.reduce((s, p) => s + p.lat, 0) / allDown.length;
    const avgLon = allDown.reduce((s, p) => s + p.lon, 0) / allDown.length;
    const radius = 0.002;
    const probableZone = {
        type: 'Polygon',
        coordinates: [[
            [avgLon - radius, avgLat - radius],
            [avgLon + radius, avgLat - radius],
            [avgLon + radius, avgLat + radius],
            [avgLon - radius, avgLat + radius],
            [avgLon - radius, avgLat - radius]
        ]]
    };

    return {
        probableZone,
        channelFootprints,
        implicatedChannels: implicated,
        confidence: implicated.length >= 2 ? 'high' : confidence,
        center: { lat: avgLat, lon: avgLon }
    };
}
