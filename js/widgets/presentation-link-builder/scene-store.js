/** @type {object|null} */
let currentBundle = null;
/** @type {Set<() => void>} */
const listeners = new Set();

export function getPresentationLinkSceneBundle() {
    return currentBundle;
}

export function subscribePresentationLinkSceneBundle(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function setPresentationLinkSceneBundle(bundle) {
    currentBundle = bundle;
    for (const listener of listeners) {
        listener();
    }
}

export function clearPresentationLinkSceneBundle() {
    currentBundle = null;
    for (const listener of listeners) {
        listener();
    }
}
