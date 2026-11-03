/**
 * Dual Screen Mode — primary window message handlers (draw, fence, drop, popups, context)
 */
import dualScreenCoordinator from './coordinator.js';
import { MessageType } from './protocol.js';

/**
 * Wire coordinator callbacks to app-level handlers.
 * @param {object} deps — functions from tool-handlers.js
 */
export function installDualScreenPrimaryHandlers(deps) {
    dualScreenCoordinator.setHandlers({
        onDrawEvent: (payload) => handleDrawEvent(payload, deps),
        onPopupAction: (payload) => handlePopupAction(payload, deps),
        onFileDrop: (payload) => handleFileDrop(payload, deps),
        onFenceSet: (payload) => handleFenceSet(payload, deps),
        onFenceClear: () => handleFenceClear(deps),
        onCtxCmd: (payload) => handleCtxCmd(payload, deps)
    });
}

function handleDrawEvent(payload, deps) {
    const { event, layerId, feature, featureIndex } = payload || {};
    if (!layerId) return;

    if (event === 'featureCreated' && feature) {
        deps.onDrawFeatureCreated(layerId, feature);
    } else if (event === 'featureEdited' && featureIndex != null) {
        deps.onDrawFeatureEdited(layerId, featureIndex);
    } else if (event === 'featureDeleted' && featureIndex != null) {
        deps.onDrawFeatureDeleted(layerId, featureIndex);
    }
}

function handlePopupAction(payload, deps) {
    if (payload?.action === 'editFeature' && payload.layerId != null && payload.featureIndex != null) {
        deps.openFeatureEditor(payload.layerId, payload.featureIndex);
        return;
    }
    if (payload?.action === 'coordSearchAddNew' && payload.searchInfo) {
        deps.onCoordSearchAddNew?.(payload.searchInfo);
        return;
    }
    if (payload?.action === 'coordSearchAddExisting' && payload.searchInfo) {
        deps.onCoordSearchAddToExisting?.(payload.searchInfo);
    }
}

async function handleFileDrop(payload, deps) {
    const files = payload?.files;
    if (!files?.length) return;

    const fileObjects = files.map(f => new File([f.buffer], f.name, {
        type: f.type || '',
        lastModified: f.lastModified || Date.now()
    }));

    const imageFiles = fileObjects.filter(f =>
        f.type.startsWith('image/') ||
        /\.(jpe?g|png|heic|heif|tiff?|webp)$/i.test(f.name)
    );
    const dataFiles = fileObjects.filter(f => !imageFiles.includes(f));

    if (dataFiles.length) await deps.handleFileImport(dataFiles);
    if (imageFiles.length && deps.handlePhotoImport) {
        await deps.handlePhotoImport(imageFiles);
    }
}

function handleFenceSet(payload, deps) {
    const bbox = payload?.bbox;
    if (!bbox) return;
    dualScreenCoordinator.setFenceBbox(bbox);
    deps.setFenceBbox(bbox);
}

function handleFenceClear(deps) {
    dualScreenCoordinator.setFenceBbox(null);
    deps.clearFence();
}

function handleCtxCmd(payload, deps) {
    const { action, layerId } = payload || {};
    if (action === 'selectionShortcut') {
        deps.onSelectionShortcut?.(payload?.shortcut);
        return;
    }
    if (!layerId) return;

    switch (action) {
        case 'toggleVisibility':
            deps.toggleLayerVisibility(layerId);
            break;
        case 'zoomToLayer':
            deps.zoomToLayer(layerId);
            break;
        case 'setActiveLayer':
            deps.setActiveLayer(layerId);
            break;
        default:
            break;
    }
}

export { MessageType };
