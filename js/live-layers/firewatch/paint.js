/**
 * MapLibre paint helpers for Firewatch parts.
 */
import {
    WILDFIRE_INCIDENT_ICON_ID,
    WILDFIRE_INCIDENT_ICON_URL,
    isHotspotPart
} from './constants.js';
import {
    buildHotspotFallbackSpecs,
    buildHotspotLayerSpecs,
    buildIncidentLayerSpecs,
    buildPerimeterLayerSpecs
} from './styles.js';
import logger from '../../core/logger.js';

/**
 * Load the flame sprite once per map.
 * @param {import('maplibre-gl').Map} map
 */
export async function ensureWildfireIncidentIcon(map) {
    if (!map || map.hasImage?.(WILDFIRE_INCIDENT_ICON_ID)) return WILDFIRE_INCIDENT_ICON_ID;

    try {
        const image = await map.loadImage(WILDFIRE_INCIDENT_ICON_URL);
        if (!map.hasImage(WILDFIRE_INCIDENT_ICON_ID)) {
            map.addImage(WILDFIRE_INCIDENT_ICON_ID, image.data || image, { sdf: false });
        }
        return WILDFIRE_INCIDENT_ICON_ID;
    } catch (error) {
        logger.warn('Firewatch', 'Incident icon failed to load', { error: error?.message || String(error) });
        return null;
    }
}

/**
 * Add MapLibre layers; skip any that reject so one bad paint expr cannot wipe the part.
 * @param {import('maplibre-gl').Map} map
 * @param {object[]} specs
 * @returns {string[]}
 */
function addSpecsSafely(map, specs) {
    const ids = [];
    for (const spec of specs) {
        try {
            if (map.getLayer(spec.id)) map.removeLayer(spec.id);
            map.addLayer(spec);
            ids.push(spec.id);
        } catch (error) {
            logger.warn('Firewatch', 'addLayer rejected', {
                id: spec.id,
                type: spec.type,
                error: error?.message || String(error)
            });
        }
    }
    return ids;
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {string} datasetId
 * @param {string} sourceId
 * @param {import('./constants.js').FirewatchPart} part
 * @param {number} opacity
 * @returns {Promise<string[]>}
 */
export async function addFirewatchPartLayers(map, datasetId, sourceId, part, opacity = 1) {
    if (part === 'incidents') {
        const iconId = await ensureWildfireIncidentIcon(map);
        const specs = buildIncidentLayerSpecs(datasetId, sourceId, opacity);
        const usable = iconId
            ? specs
            : specs.filter((spec) => spec.id.endsWith('-label'));
        return addSpecsSafely(map, usable);
    }

    if (isHotspotPart(part)) {
        let ids = addSpecsSafely(map, buildHotspotLayerSpecs(datasetId, sourceId, opacity, part));
        if (!ids.length) {
            logger.warn('Firewatch', 'Hotspot stack failed; using fallback circles', { part, datasetId });
            ids = addSpecsSafely(map, buildHotspotFallbackSpecs(datasetId, sourceId, opacity, part));
        }
        if (!ids.length) {
            throw new Error(`Firewatch hotspot layers failed to add (${part})`);
        }
        return ids;
    }

    return addSpecsSafely(map, buildPerimeterLayerSpecs(datasetId, sourceId, opacity));
}

/**
 * Draw order bottom → top: perimeters → hotspots → incidents (incidents always on top).
 * @param {import('maplibre-gl').Map} map
 * @param {Map<string, { mapLayerIds: string[], part: string }>} partsByDatasetId
 */
export function orderFirewatchLayers(map, partsByDatasetId) {
    if (!map || !partsByDatasetId?.size) return;

    /** @type {string[]} */
    const ordered = [];
    const byPart = {
        perimeters: [],
        viirs: [],
        modis: [],
        noaa: [],
        incidents: []
    };

    for (const entry of partsByDatasetId.values()) {
        if (byPart[entry.part]) byPart[entry.part].push(...entry.mapLayerIds);
    }

    ordered.push(
        ...byPart.perimeters,
        ...byPart.viirs,
        ...byPart.modis,
        ...byPart.noaa,
        ...byPart.incidents
    );

    for (let i = 0; i < ordered.length; i++) {
        const id = ordered[i];
        if (!map.getLayer(id)) continue;
        const beforeId = ordered.slice(i + 1).find((candidate) => map.getLayer(candidate));
        try {
            if (beforeId) map.moveLayer(id, beforeId);
            else map.moveLayer(id);
        } catch {
            /* ignore move errors during teardown */
        }
    }

    // Hard guarantee: incident icon + label sit above every hotspot stack.
    for (const id of byPart.incidents) {
        if (!map.getLayer(id)) continue;
        try {
            map.moveLayer(id);
        } catch {
            /* ignore */
        }
    }
}

/**
 * Interactive MapLibre layer ids (named incidents only).
 * @param {string} datasetId
 * @param {import('./constants.js').FirewatchPart} part
 */
export function interactiveLayerIdsForPart(datasetId, part) {
    if (part !== 'incidents') return [];
    return [`svc-lyr-${datasetId}-icon`];
}
