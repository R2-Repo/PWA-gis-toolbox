/**
 * Connected buildings attached to a hub (V2).
 */
import { connectedBuildingIps } from './import/connected-buildings.js';

/**
 * @param {object} snap
 * @param {string} hubCode
 */
export function buildingsForHub(snap, hubCode) {
    const code = String(hubCode || '').trim();
    if (!code) return [];
    return (snap.connectedBuildings || []).filter((b) => {
        const from = String(b.fromHub || b.from_hub || '').trim();
        const to = String(b.toHub || b.to_hub || '').trim();
        return from === code || to === code;
    });
}

/**
 * @param {object} building
 */
export function buildingPingTargets(building) {
    return connectedBuildingIps(building).map((ip) => ({
        ip,
        label: building.buildingName || ip
    }));
}
