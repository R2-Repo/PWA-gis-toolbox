/**
 * Dual Screen Mode — keep map feature selection in sync between windows.
 */
import bus from '../core/event-bus.js';

/**
 * @param {'primary' | 'secondary'} source
 * @param {object} mapApi
 * @param {{ layerId?: string | null, totalCount?: number }} detail
 */
export function buildSelectionPayload(source, mapApi, detail = {}) {
    const layerId = detail.layerId ?? null;
    const totalCount = detail.totalCount ?? mapApi.getTotalSelectionCount?.() ?? 0;
    return {
        source,
        layerId,
        indices: layerId ? (mapApi.getSelectedIndices?.(layerId) ?? []) : [],
        totalCount,
        activeLayerId: mapApi.getActiveLayerId?.() ?? null
    };
}

/**
 * Apply a remote selection payload without re-broadcasting.
 * @param {object} mapApi
 * @param {object} payload
 * @param {{ setInbound?: (v: boolean) => void }} [opts]
 */
export function applySelectionPayload(mapApi, payload, opts = {}) {
    if (!payload || payload.source == null) return;

    opts.setInbound?.(true);
    try {
        if (payload.activeLayerId !== undefined) {
            mapApi.setActiveLayerId?.(payload.activeLayerId);
        }

        if (payload.syncSelection === false) return;

        const totalCount = payload.totalCount ?? 0;
        if (totalCount === 0) {
            mapApi.clearSelection?.();
            return;
        }

        if (payload.layerId) {
            mapApi.selectFeatures?.(payload.layerId, payload.indices ?? []);
        }
    } finally {
        opts.setInbound?.(false);
    }
}

/**
 * @param {object} incoming
 * @param {'primary' | 'secondary'} localRole
 */
export function shouldApplySelection(incoming, localRole) {
    return incoming?.payload?.source !== localRole;
}

/**
 * Popup box-select UI events. Selection indices are applied separately.
 * @param {object} payload
 */
export function emitRemoteSelectionUi(payload) {
    if (!payload?.event) return;
    if (payload.event === 'boxComplete') {
        bus.emit('selection:boxComplete', {
            layerId: payload.layerId ?? null,
            count: payload.count ?? 0,
            bbox: Array.isArray(payload.bbox) ? payload.bbox : null,
            screenBbox: payload.screenBbox ?? null,
            clientX: payload.clientX ?? 0,
            clientY: payload.clientY ?? 0
        });
        return;
    }
    if (payload.event === 'boxCleared') {
        bus.emit('selection:boxCleared');
    }
}

/**
 * Relay primary-window selection / active-layer changes to the map window.
 * @param {object} mapApi
 * @param {(payload: object) => void} broadcastSelection
 * @param {() => boolean} isActive
 * @param {() => boolean} isInbound
 */
export function installPrimarySelectionSync(mapApi, broadcastSelection, isActive, isInbound) {
    const unsubSelection = bus.on('selection:changed', (detail) => {
        if (!isActive() || isInbound()) return;
        broadcastSelection(buildSelectionPayload('primary', mapApi, detail));
    });
    const unsubLayer = bus.on('layer:active', (layer) => {
        if (!isActive()) return;
        broadcastSelection({
            source: 'primary',
            activeLayerId: layer?.id ?? null,
            syncSelection: false
        });
    });
    return () => {
        unsubSelection();
        unsubLayer();
    };
}
