/**
 * Existing protect in place for UDOT Fiber operational (sheet snapshot) layers.
 * Pure helpers plus map commit. No DOM.
 */

import bus from '../../core/event-bus.js';
import { getLayers } from '../../core/state.js';
import { saveSnapshot } from '../../dataprep/transform-history.js';
import mapService from '../../map/map-service.js';
import { showToast } from '../../ui/toast.js';
import {
    isProtectInPlaceFeature,
    setProtectInPlaceFlag
} from '../../symbology/udot-fiber/protect-in-place.js';
import { getWidgetEntry } from '../widget-state-store.js';
import { WIDGET_ID } from './engine.js';
import { isSheetFiberSnapshotLayer } from './fiber-operational.js';

/**
 * Sheet Cutter dialog is open (preview + box-select PIP actions).
 * @returns {boolean}
 */
export function isSheetCuttingMode() {
    return getWidgetEntry(WIDGET_ID)?.open === true;
}

/**
 * @param {object|null|undefined} layer
 * @returns {boolean}
 */
export function isFiberOperationalLayer(layer) {
    return isSheetFiberSnapshotLayer(layer);
}

/**
 * @param {object} layer
 * @param {number[]} indices
 * @param {boolean} enabled
 * @returns {{ features: object[], changed: number }}
 */
export function setProtectInPlaceOnLayerFeatures(layer, indices, enabled) {
    const wanted = new Set((indices || []).map(Number).filter(Number.isFinite));
    let changed = 0;
    const features = (layer?.geojson?.features || []).map((feature, i) => {
        const raw = Number(feature?.properties?._featureIndex);
        const idx = Number.isFinite(raw) ? raw : i;
        if (!wanted.has(idx)) return feature;
        if (isProtectInPlaceFeature(feature) === enabled) return feature;
        changed += 1;
        return setProtectInPlaceFlag(feature, enabled);
    });
    return { features, changed };
}

/**
 * @param {object} layer
 * @param {number[]} indices
 * @param {boolean} enabled
 * @returns {number}
 */
export function commitProtectInPlace(layer, indices, enabled) {
    if (!isFiberOperationalLayer(layer)) {
        showToast('Existing protect in place is for UDOT Fiber operational layers', 'warning');
        return 0;
    }
    const { features, changed } = setProtectInPlaceOnLayerFeatures(layer, indices, enabled);
    if (!changed) {
        showToast(enabled ? 'Already existing protect in place' : 'Already original style', 'info');
        return 0;
    }
    saveSnapshot(
        layer.id,
        enabled ? 'Existing protect in place' : 'Restore original Fiber style',
        layer.geojson
    );
    layer.geojson = { type: 'FeatureCollection', features };
    bus.emit('layer:updated', layer);
    bus.emit('layers:changed', getLayers());
    mapService.refreshLayerData?.(layer);
    showToast(
        enabled
            ? `Marked ${changed} feature(s) existing protect in place`
            : `Restored original style on ${changed} feature(s)`,
        'success'
    );
    return changed;
}

/**
 * Right-click items for one operational Fiber feature (any time the copy is on the map).
 * @param {{ layer?: object, feature?: object, featureIndex?: number }} input
 * @returns {object[]}
 */
export function getProtectInPlaceContextMenuItems({ layer, feature, featureIndex } = {}) {
    if (!isFiberOperationalLayer(layer) || !feature) return [];
    const idx = Number(featureIndex);
    if (!Number.isFinite(idx)) return [];
    const pip = isProtectInPlaceFeature(feature);
    return [{
        icon: pip ? '↺' : '┅',
        label: pip ? 'Restore original style' : 'Existing protect in place',
        title: pip
            ? 'Return this Fiber feature to its class colors and CAD marks'
            : 'Dashed black outline — no fill or class color',
        action: () => commitProtectInPlace(layer, [idx], !pip)
    }];
}

/**
 * Box-select items while Sheet Cutter is open.
 * @param {{ layer?: object, count?: number, sheetCuttingOpen?: boolean }} input
 * @returns {object[]}
 */
export function getProtectInPlaceSelectionItems({
    layer,
    count = 0,
    sheetCuttingOpen = false
} = {}) {
    if (!sheetCuttingOpen || !isFiberOperationalLayer(layer) || !(count > 0)) return [];
    return [
        {
            label: 'Existing protect in place',
            icon: '┅',
            title: 'Style selected Fiber features as dashed black (no fill or class color)',
            action: () => {
                const indices = mapService.getSelectedIndices?.(layer.id) || [];
                commitProtectInPlace(layer, indices, true);
            }
        },
        {
            label: 'Restore original style',
            icon: '↺',
            title: 'Return selected Fiber features to their original CAD styling',
            action: () => {
                const indices = mapService.getSelectedIndices?.(layer.id) || [];
                commitProtectInPlace(layer, indices, false);
            }
        }
    ];
}
