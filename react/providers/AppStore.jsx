import { createContext, useContext, useEffect, useRef } from 'react';
import { createStore, useStore } from 'zustand';
import bus from '../../js/core/event-bus.js';
import {
    getState,
    getLayers,
    getActiveLayer,
    setActiveLayer,
    toggleAGOLCompat
} from '../../js/core/state.js';
import { getLayerGroups } from '../../js/core/layer-groups.js';
import { getHistoryState } from '../../js/dataprep/transform-history.js';

function buildToolbarState() {
    const layers = getLayers();
    const hs = getHistoryState();
    return {
        showMerge: layers.length >= 2,
        canUndo: hs.canUndo,
        canRedo: hs.canRedo
    };
}

function buildSnapshot() {
    return {
        layers: getLayers(),
        layerGroups: getLayerGroups(),
        activeLayer: getActiveLayer(),
        agolCompatMode: !!getState().agolCompatMode,
        toolbar: buildToolbarState(),
        refreshTick: 0
    };
}

export function createAppStore() {
    return createStore((set) => ({
        ...buildSnapshot(),
        bumpRefresh: () => set((s) => ({ ...buildSnapshot(), refreshTick: s.refreshTick + 1 })),
        setActiveLayerId: (id) => {
            setActiveLayer(id);
        },
        toggleAgolCompat: () => {
            toggleAGOLCompat();
            set(buildSnapshot());
        }
    }));
}

const AppStoreContext = createContext(null);

export function AppStoreProvider({ store, children }) {
    const storeRef = useRef(store);

    useEffect(() => {
        const s = storeRef.current;
        const refresh = () => s.getState().bumpRefresh();
        const events = [
            'layers:changed',
            'layer-groups:changed',
            'layer:active',
            'layer:updated',
            'agol:toggled',
            'ui:refresh',
            'history:changed'
        ];
        for (const event of events) {
            bus.on(event, refresh);
        }
        refresh();
        return () => {
            for (const event of events) {
                bus.off(event, refresh);
            }
        };
    }, []);

    return (
        <AppStoreContext.Provider value={storeRef.current}>
            {children}
        </AppStoreContext.Provider>
    );
}

export function useAppStore(selector) {
    const store = useContext(AppStoreContext);
    if (!store) throw new Error('useAppStore must be used within AppStoreProvider');
    return useStore(store, selector);
}

export function useAppStoreApi() {
    const store = useContext(AppStoreContext);
    if (!store) throw new Error('useAppStoreApi must be used within AppStoreProvider');
    return store;
}
