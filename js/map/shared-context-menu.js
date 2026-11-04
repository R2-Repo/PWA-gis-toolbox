/**
 * Map right-click menu shared by the main window and the dual-screen pop-out.
 * Host callbacks perform the action in the window that owns that work.
 */

import { getContextMenuGisTools, isLayerFeatureDeletable } from '../tools/context-menu-gis-tools.js';
import { isProjectStationingCenterline } from '../widgets/project-stationing/route-profile.js';
import { getPlanSetCalloutMenuItems } from '../widgets/plan-set-callouts/context-menu-bridge.js';
import { getProtectInPlaceContextMenuItems } from '../widgets/sheet-cutting/protect-in-place.js';

function writeText(text, onOk, onFail) {
    const pending = navigator.clipboard?.writeText?.(text);
    if (pending?.then) pending.then(onOk).catch(onFail);
    else onFail();
}

/**
 * @param {object} payload
 * @param {object} host
 * @returns {{ items: object[], layerName: string|null }}
 */
export function buildSharedMapContextMenuItems(payload, host) {
    const { latlng, layerId, featureIndex, feature } = payload || {};
    const layers = host.getLayers?.() || [];
    const layer = layerId ? layers.find((entry) => entry.id === layerId) : null;
    const layerIdx = layer ? layers.indexOf(layer) : -1;
    const items = [];

    const calloutItems = getPlanSetCalloutMenuItems(payload) || [];
    const pipItems = (getProtectInPlaceContextMenuItems({ layer, feature, featureIndex }) || []).map((item) => {
        if (typeof host.forwardProtectInPlace !== 'function') return item;
        return {
            ...item,
            action: () => host.forwardProtectInPlace(layer?.id, featureIndex)
        };
    });
    if (calloutItems.length) items.push(...calloutItems);
    if (pipItems.length) items.push(...pipItems);
    if (calloutItems.length || pipItems.length) items.push({ sep: true });

    if (feature && layer) {
        items.push({
            icon: '👁',
            label: 'View attributes',
            action: () => host.viewAttributes?.({ latlng, layerId, featureIndex, feature })
        });
        items.push({
            icon: '✏',
            label: 'Edit feature',
            action: () => host.editFeature?.(layerId, featureIndex)
        });
        if (isProjectStationingCenterline(layer)) {
            items.push({
                icon: '📍',
                label: 'Import Station Table',
                action: () => host.importStationTable?.(layer)
            });
        }

        const gisTools = getContextMenuGisTools(layer, feature);
        if (gisTools.length > 0) {
            items.push({
                icon: '🛠',
                label: 'Tools',
                children: gisTools.map((tool) => ({
                    label: tool.label,
                    action: () => host.invokeGisTool?.(tool.action)
                }))
            });
        }

        if (isLayerFeatureDeletable(layer)) {
            items.push({
                icon: '🗑',
                label: 'Delete feature',
                action: () => host.deleteFeature?.(layerId, featureIndex)
            });
        }
    }

    if (host.allowMapTools?.() !== false) {
        items.push({
            icon: '✏️',
            label: 'Quick Draw',
            action: () => host.startQuickDraw?.()
        });
        items.push({
            icon: '📐',
            label: 'Measure from here',
            action: () => host.startMeasure?.(latlng)
        });
    }

    items.push({
        icon: '📋',
        label: 'Copy coordinates',
        action: () => {
            const text = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
            writeText(
                text,
                () => {},
                () => host.notify?.(text, 'info')
            );
        }
    });

    items.push({
        icon: '🛤️',
        label: 'Get route & milepost',
        title: 'UDOT state routes and interstates only — not city streets.',
        action: () => host.lookupRoute?.(latlng)
    });

    if (host.is3D?.()) {
        items.push({
            icon: '⛰️',
            label: 'Get elevation',
            action: () => {
                const meters = host.queryElevation?.(latlng.lat, latlng.lng);
                if (meters == null) {
                    host.notify?.('Elevation unavailable — terrain tiles may still be loading', 'warning');
                    return;
                }
                const text = host.formatElevation?.(meters) ?? String(meters);
                const message = `Elevation: ${text}`;
                writeText(
                    text,
                    () => host.notify?.(message, 'success'),
                    () => host.notify?.(message, 'info')
                );
            }
        });
    }

    if (host.isOrbiting?.()) {
        items.push({
            icon: '⏹',
            label: 'Stop camera orbit',
            action: () => host.stopOrbit?.()
        });
    } else {
        items.push({
            icon: '🔄',
            label: 'Orbit camera around point',
            action: () => host.startOrbit?.({ lat: latlng.lat, lng: latlng.lng })
        });
    }

    items.push({
        icon: '🚶',
        label: 'Open location in Google Street View',
        action: () => host.openStreetView?.(latlng)
    });

    items.push({
        icon: '🌍',
        label: 'Open location in Google Earth',
        action: () => host.openEarth?.(latlng)
    });

    if (layer) {
        items.push({ sep: true });
        if (layerIdx > 0) {
            items.push({ icon: '⬆', label: 'Move layer up', action: () => host.moveLayerUp?.(layerId) });
        }
        if (layerIdx >= 0 && layerIdx < layers.length - 1) {
            items.push({ icon: '⬇', label: 'Move layer down', action: () => host.moveLayerDown?.(layerId) });
        }
        if (layers.length > 1 && layerIdx !== 0) {
            items.push({
                icon: '⏫',
                label: 'Bring to front',
                action: () => host.bringToFront?.(layerId)
            });
        }
        if (layers.length > 1 && layerIdx !== layers.length - 1) {
            items.push({
                icon: '⏬',
                label: 'Send to back',
                action: () => host.sendToBack?.(layerId)
            });
        }
        items.push({ sep: true });
        items.push({
            icon: layer.visible !== false ? '👁️‍🗨️' : '👁️',
            label: layer.visible !== false ? 'Hide layer' : 'Show layer',
            action: () => host.toggleVisibility?.(layerId)
        });
        items.push({
            icon: '🔍',
            label: 'Zoom to layer',
            action: () => host.zoomToLayer?.(layerId)
        });
        items.push({
            icon: '★',
            label: 'Set as active layer',
            action: () => host.setActiveLayer?.(layerId)
        });
    }

    return { items, layerName: layer?.name || null };
}
