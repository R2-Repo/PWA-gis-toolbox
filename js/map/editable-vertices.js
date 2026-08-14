/**
 * Collect and move editable vertices for draw / reshape.
 * Paths address coordinates inside GeoJSON geometry arrays.
 */

function ringsClosed(ring) {
    if (!ring || ring.length < 2) return false;
    const first = ring[0];
    const last = ring[ring.length - 1];
    return first[0] === last[0] && first[1] === last[1];
}

function addRingVertices(ring, pathPrefix, items) {
    if (!Array.isArray(ring) || ring.length === 0) return;
    const closed = ringsClosed(ring);
    const count = closed ? ring.length - 1 : ring.length;
    for (let i = 0; i < count; i++) {
        items.push({ coord: ring[i], path: [...pathPrefix, i], closed });
    }
}

/**
 * @param {object|null|undefined} geometry
 * @returns {{ coord: number[], path: number[], closed?: boolean }[]}
 */
export function collectEditableVertices(geometry) {
    const items = [];
    if (!geometry?.type) return items;
    switch (geometry.type) {
        case 'Point':
            items.push({ coord: geometry.coordinates, path: [] });
            break;
        case 'LineString':
            (geometry.coordinates || []).forEach((coord, i) => {
                items.push({ coord, path: [i] });
            });
            break;
        case 'MultiLineString':
            (geometry.coordinates || []).forEach((line, li) => {
                (line || []).forEach((coord, i) => {
                    items.push({ coord, path: [li, i] });
                });
            });
            break;
        case 'Polygon':
            (geometry.coordinates || []).forEach((ring, ri) => addRingVertices(ring, [ri], items));
            break;
        case 'MultiPolygon':
            (geometry.coordinates || []).forEach((poly, pi) => {
                (poly || []).forEach((ring, ri) => addRingVertices(ring, [pi, ri], items));
            });
            break;
        case 'MultiPoint':
            (geometry.coordinates || []).forEach((coord, i) => {
                items.push({ coord, path: [i] });
            });
            break;
        default:
            break;
    }
    return items;
}

/**
 * Mutate geometry in place by path from {@link collectEditableVertices}.
 * @param {object} geometry
 * @param {number[]} path
 * @param {number[]} newCoord
 */
export function applyVertexMove(geometry, path, newCoord) {
    if (!geometry?.type || !Array.isArray(newCoord)) return;
    const copy = [...newCoord];
    switch (geometry.type) {
        case 'Point':
            geometry.coordinates = copy;
            break;
        case 'LineString':
            if (path.length >= 1) geometry.coordinates[path[0]] = copy;
            break;
        case 'MultiLineString':
            if (path.length >= 2) geometry.coordinates[path[0]][path[1]] = copy;
            break;
        case 'Polygon': {
            if (path.length < 2) break;
            const [ri, vi] = path;
            const ring = geometry.coordinates[ri];
            if (!ring) break;
            const closed = ringsClosed(ring);
            ring[vi] = copy;
            if (vi === 0 && closed) {
                ring[ring.length - 1] = [...copy];
            }
            break;
        }
        case 'MultiPolygon': {
            if (path.length < 3) break;
            const [pi, ri, vi] = path;
            const ring = geometry.coordinates[pi]?.[ri];
            if (!ring) break;
            const closed = ringsClosed(ring);
            ring[vi] = copy;
            if (vi === 0 && closed) {
                ring[ring.length - 1] = [...copy];
            }
            break;
        }
        case 'MultiPoint':
            if (path.length >= 1) geometry.coordinates[path[0]] = copy;
            break;
        default:
            break;
    }
}
