/**
 * Application state management
 * Reactive state with change notifications
 */
import bus from './event-bus.js';
import { analyzeSchema } from './data-model.js';

const state = {
    layers: [],           // Array of canonical datasets
    activeLayerId: null,
    filters: [],
    agolCompatMode: false,
    ui: {
        isMobile: window.innerWidth < 768,
        activeTab: 'map',      // mobile tabs: map | data | prep | tools | export
        leftPanelOpen: true,
        rightPanelOpen: true,
        logsOpen: false,
        photoMapperOpen: false,
        arcgisImporterOpen: false,
        coordinatesOpen: false
    }
};

export function getState() { return state; }

export function getLayers() { return state.layers; }

export function getActiveLayer() {
    return state.layers.find(l => l.id === state.activeLayerId) || state.layers[0] || null;
}

export function addLayer(dataset, { activate = false } = {}) {
    state.layers.push(dataset);
    if (activate || !state.activeLayerId) {
        state.activeLayerId = dataset.id;
        if (activate) {
            bus.emit('layer:active', getActiveLayer());
        }
    }
    bus.emit('layers:changed', state.layers);
    bus.emit('layer:added', dataset);
}

export function removeLayer(id) {
    state.layers = state.layers.filter(l => l.id !== id);
    if (state.activeLayerId === id) {
        state.activeLayerId = state.layers[0]?.id || null;
    }
    bus.emit('layers:changed', state.layers);
    bus.emit('layer:removed', { id });
}

export function setActiveLayer(id) {
    state.activeLayerId = id;
    bus.emit('layer:active', getActiveLayer());
}

export function updateLayer(id, updates) {
    const layer = state.layers.find(l => l.id === id);
    if (layer) {
        Object.assign(layer, updates);
        if (updates.geojson) {
            layer.schema = analyzeSchema(layer.geojson);
            bus.emit('layer:updated', layer);
            bus.emit('layers:changed', state.layers);
            return;
        }
        bus.emit('layer:updated', layer);
        bus.emit('layers:changed', state.layers);
    }
}

export function updateLayerData(id, geojson) {
    const layer = state.layers.find(l => l.id === id);
    if (!layer) return;
    layer.geojson = geojson;
    layer.schema = analyzeSchema(geojson);
    bus.emit('layer:updated', layer);
    bus.emit('layers:changed', state.layers);
}

export function toggleLayerVisibility(id) {
    const layer = state.layers.find(l => l.id === id);
    if (layer) {
        layer.visible = !layer.visible;
        bus.emit('layer:visibility', layer);
    }
}

export function reorderLayer(id, direction) {
    const idx = state.layers.findIndex(l => l.id === id);
    if (idx === -1) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= state.layers.length) return;
    const [item] = state.layers.splice(idx, 1);
    state.layers.splice(newIdx, 0, item);
    bus.emit('layers:changed', state.layers);
    bus.emit('layers:reordered', state.layers);
}

export function reorderLayerToIndex(id, toIndex) {
    const idx = state.layers.findIndex(l => l.id === id);
    if (idx === -1) return;
    const clamped = Math.max(0, Math.min(toIndex, state.layers.length - 1));
    if (idx === clamped) return;
    const [item] = state.layers.splice(idx, 1);
    state.layers.splice(clamped, 0, item);
    bus.emit('layers:changed', state.layers);
    bus.emit('layers:reordered', state.layers);
}

// UI state
export function setUIState(key, value) {
    state.ui[key] = value;
    bus.emit('ui:changed', { key, value });
}

export function toggleAGOLCompat() {
    state.agolCompatMode = !state.agolCompatMode;
    bus.emit('agol:toggled', state.agolCompatMode);
}

// Detect mobile
function checkMobile() {
    const wasMobile = state.ui.isMobile;
    state.ui.isMobile = window.innerWidth < 768;
    if (wasMobile !== state.ui.isMobile) {
        bus.emit('ui:responsive', state.ui.isMobile);
    }
}
window.addEventListener('resize', checkMobile);

export default {
    getState, getLayers, getActiveLayer, addLayer, removeLayer, setActiveLayer,
    updateLayer, updateLayerData, toggleLayerVisibility, reorderLayer, reorderLayerToIndex,
    setUIState, toggleAGOLCompat
};
