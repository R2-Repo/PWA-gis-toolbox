/**
 * Plan-set callout rows for the pop-out map menu.
 * The session is synced from the main window. Actions are sent back.
 */
import mapService from '../map/map-service.js';
import { restoreCalloutSession } from '../widgets/plan-set-callouts/engine.js';
import { setPlanSetCalloutMenuContext } from '../widgets/plan-set-callouts/context-menu-bridge.js';
import { showCalloutPreview } from '../widgets/plan-set-callouts/preview.js';
import { getPopoutLayers } from './popout-layer-catalog.js';
import { requestPopoutCommand } from './popout-context-menu.js';

function postCallout(op, extra = {}) {
    requestPopoutCommand({ action: 'callout', op, ...extra });
}

/**
 * @param {object | null} session
 * @param {object[]} [insetViews]
 */
export function installPopoutCalloutMenu(session, insetViews = []) {
    if (!session) {
        setPlanSetCalloutMenuContext(null);
        return;
    }
    if (mapService.getMap?.()) {
        try {
            showCalloutPreview(mapService, session, { insetViews });
        } catch {
            // Menu rows still work if the preview layers cannot be drawn.
        }
    }
    setPlanSetCalloutMenuContext({
        isActive: () => true,
        isOpen: () => true,
        getSession: () => session,
        mapService: {
            findFeaturesNearClick: (latlng, layerId, featureIndex) => {
                if (!mapService.getMap?.()) return [];
                return mapService.findFeaturesNearClick(latlng, layerId, featureIndex) || [];
            },
            getSelectedIndices: (layerId) => mapService.getSelectedIndices?.(layerId) || []
        },
        getLayers: () => getPopoutLayers(),
        onRemoveLeader: (leaderKey) => postCallout('removeLeader', { leaderKey }),
        onAddNote: (leaderKey) => {
            const text = window.prompt('Additional key note text');
            if (!text) return;
            postCallout('addNote', { leaderKey, text });
        },
        onAddLeader: (input) => postCallout('addLeader', { input }),
        onSetLeadersEnabled: (features, enabled, options = {}) => {
            postCallout('setLeaders', { features, enabled, options });
            return 0;
        }
    });
}

export function clearPopoutCalloutMenu() {
    setPlanSetCalloutMenuContext(null);
}

/**
 * @param {{ live?: boolean, bundle?: object, insetViews?: object[] }} payload
 */
export function applyPopoutCalloutSession(payload) {
    if (!payload?.live || !payload.bundle) {
        clearPopoutCalloutMenu();
        return;
    }
    try {
        const session = restoreCalloutSession(payload.bundle);
        installPopoutCalloutMenu(session, payload.insetViews || []);
    } catch {
        clearPopoutCalloutMenu();
    }
}
