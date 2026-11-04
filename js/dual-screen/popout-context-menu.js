/**
 * Pop-out map context menu.
 * Same items as the main window. Map actions run here.
 * Project actions are sent to the main window.
 */

import mapService, { formatElevationLabel } from '../map/map-service.js';
import { buildSharedMapContextMenuItems } from '../map/shared-context-menu.js';
import { MessageType } from './protocol.js';
import { applyMapToast } from './secondary-client.js';
import { getPopoutLayers } from './popout-layer-catalog.js';

/** @type {((type: string, payload: object) => void) | null} */
let post = null;

/**
 * @param {(type: string, payload: object) => void} postFn
 */
export function bindPopoutContextMenu(postFn) {
    post = postFn;
}

/**
 * @param {object} payload
 */
export function requestPopoutCommand(payload) {
    post?.(MessageType.CTX_CMD, payload);
}

function popoutHost() {
    return {
        getLayers: () => getPopoutLayers(),
        forwardProtectInPlace: (layerId, featureIndex) => {
            requestPopoutCommand({ action: 'protectInPlace', layerId, featureIndex });
        },
        viewAttributes: ({ latlng, layerId, featureIndex, feature }) => {
            const nearby = mapService.findFeaturesNearClick(latlng, layerId, featureIndex);
            const popupOptions = { forceFull: true };
            if (nearby.length > 0) mapService.showMultiPopup(nearby, latlng, popupOptions);
            else mapService.showPopup(feature, null, latlng, popupOptions);
        },
        editFeature: (layerId, featureIndex) => {
            post?.(MessageType.POPUP_ACTION, { action: 'editFeature', layerId, featureIndex });
        },
        importStationTable: (layer) => {
            requestPopoutCommand({ action: 'importStationTable', layerId: layer?.id });
        },
        invokeGisTool: (toolAction) => {
            requestPopoutCommand({ action: 'gisTool', toolAction });
        },
        deleteFeature: (layerId, featureIndex) => {
            requestPopoutCommand({ action: 'deleteFeature', layerId, featureIndex });
        },
        allowMapTools: () => true,
        startQuickDraw: () => requestPopoutCommand({ action: 'quickDraw' }),
        startMeasure: (latlng) => mapService.startMeasureFrom(latlng),
        notify: (message, type) => applyMapToast({ message, type }),
        lookupRoute: (latlng) => {
            void import('../ugrc/lookup.js').then(({ runReverseMilepostLookup }) =>
                runReverseMilepostLookup(latlng, {
                    showToast: (message, type) => applyMapToast({ message, type })
                })
            );
        },
        is3D: () => mapService.is3DEnabled(),
        queryElevation: (lat, lng) => mapService.queryElevationAt(lat, lng),
        formatElevation: (meters) => formatElevationLabel(meters),
        isOrbiting: () => mapService.isOrbiting(),
        stopOrbit: () => mapService.stopCameraOrbit(),
        startOrbit: (center) => mapService.startCameraOrbit(center),
        openStreetView: (latlng) => {
            const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latlng.lat},${latlng.lng}`;
            window.open(url, '_blank', 'noopener');
        },
        openEarth: (latlng) => {
            const url = `https://earth.google.com/web/@${latlng.lat},${latlng.lng},1200a,900d,60y,0h,35t,0r`;
            window.open(url, '_blank', 'noopener');
        },
        moveLayerUp: (layerId) => requestPopoutCommand({ action: 'moveLayerUp', layerId }),
        moveLayerDown: (layerId) => requestPopoutCommand({ action: 'moveLayerDown', layerId }),
        bringToFront: (layerId) => requestPopoutCommand({ action: 'bringToFront', layerId }),
        sendToBack: (layerId) => requestPopoutCommand({ action: 'sendToBack', layerId }),
        toggleVisibility: (layerId) => requestPopoutCommand({ action: 'toggleVisibility', layerId }),
        zoomToLayer: (layerId) => requestPopoutCommand({ action: 'zoomToLayer', layerId }),
        setActiveLayer: (layerId) => requestPopoutCommand({ action: 'setActiveLayer', layerId })
    };
}

/**
 * @param {object} payload
 * @returns {{ items: object[], layerName: string|null }}
 */
export function buildPopoutContextMenuItems(payload) {
    return buildSharedMapContextMenuItems(payload, popoutHost());
}
