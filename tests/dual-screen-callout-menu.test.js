/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { pointTargetKey } from '../js/widgets/plan-set-callouts/fiber-notes.js';
import { setPlanSetCalloutMenuContext } from '../js/widgets/plan-set-callouts/context-menu-bridge.js';
import {
    bindPopoutContextMenu,
    buildPopoutContextMenuItems
} from '../js/dual-screen/popout-context-menu.js';
import {
    clearPopoutCalloutMenu,
    installPopoutCalloutMenu
} from '../js/dual-screen/popout-callout-menu.js';
import { replacePopoutLayers, resetPopoutLayers } from '../js/dual-screen/popout-layer-catalog.js';
import { installDualScreenPrimaryHandlers } from '../js/dual-screen/primary-handlers.js';
import dualScreenCoordinator from '../js/dual-screen/coordinator.js';
import { MessageType } from '../js/dual-screen/protocol.js';

const frame = {
    type: 'Polygon',
    coordinates: [[
        [-111.91, 40.74],
        [-111.87, 40.74],
        [-111.87, 40.76],
        [-111.91, 40.76],
        [-111.91, 40.74]
    ]]
};

const boxFeature = {
    type: 'Feature',
    properties: { OBJECTID: 10, _udotFiberKey: 'boxes', BOXLABELS: 'JB-A' },
    geometry: { type: 'Point', coordinates: [-111.9, 40.75] }
};

function calloutSession() {
    return {
        selectedSheetId: 's1',
        sheets: [{ sheetId: 's1', sheetNumber: 1, frameGeometry: frame }],
        notes: [{ noteId: 'note-2', number: 2, text: 'JB-A' }],
        leaders: [{
            leaderKey: 's1::boxes:10',
            leaderId: 's1::boxes:10',
            sheetId: 's1',
            targetKey: pointTargetKey('boxes', '10'),
            targetKind: 'boxes',
            memberIds: ['10'],
            noteIds: ['note-2'],
            suppressed: true,
            enabled: false
        }]
    };
}

describe('pop-out plan-set callout menu', () => {
    afterEach(() => {
        clearPopoutCalloutMenu();
        setPlanSetCalloutMenuContext(null);
        resetPopoutLayers();
        bindPopoutContextMenu(null);
    });

    it('shows callout rows from the synced session and sends the action to the main window', () => {
        const posts = [];
        bindPopoutContextMenu((type, payload) => posts.push({ type, payload }));
        replacePopoutLayers([{
            id: 'snap-boxes',
            name: 'Boxes',
            type: 'spatial',
            source: { fiberKey: 'boxes' },
            geojson: { type: 'FeatureCollection', features: [boxFeature] }
        }]);
        installPopoutCalloutMenu(calloutSession());

        const built = buildPopoutContextMenuItems({
            latlng: { lng: -111.9, lat: 40.75 },
            layerId: 'snap-boxes',
            featureIndex: 0,
            feature: boxFeature
        });
        const item = built.items.find((entry) => String(entry.label).startsWith('Turn on callout'));
        expect(item).toBeTruthy();
        item.action();
        expect(posts).toHaveLength(1);
        expect(posts[0].type).toBe(MessageType.CTX_CMD);
        expect(posts[0].payload.action).toBe('callout');
        expect(posts[0].payload.op).toBe('addLeader');
        expect(posts[0].payload.input.targetKind).toBe('boxes');

        clearPopoutCalloutMenu();
        const cleared = buildPopoutContextMenuItems({
            latlng: { lng: -111.9, lat: 40.75 },
            layerId: 'snap-boxes',
            featureIndex: 0,
            feature: boxFeature
        });
        expect(cleared.items.some((entry) => String(entry.label).includes('callout'))).toBe(false);
    });

    it('delivers a pop-out callout command to the main window', () => {
        const received = [];
        installDualScreenPrimaryHandlers({
            onCalloutCommand: (payload) => received.push(payload)
        });
        dualScreenCoordinator._handleMessage({
            type: MessageType.CTX_CMD,
            payload: { action: 'callout', op: 'removeLeader', leaderKey: 's1::boxes:10' }
        });
        expect(received).toEqual([
            { action: 'callout', op: 'removeLeader', leaderKey: 's1::boxes:10' }
        ]);
    });
});
