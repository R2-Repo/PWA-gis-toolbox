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
    // #region agent log
    fetch('http://127.0.0.1:7928/ingest/d3c9e78b-c7ff-4f7c-bb94-4a8dca6fee71',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c8639f'},body:JSON.stringify({sessionId:'c8639f',runId:'post-fix',hypothesisId:'H-C',location:'scene-store.js:setPresentationLinkSceneBundle',message:'scene bundle stored',data:{limitsFeatureCount:bundle?.limits?.featureCount,validationOk:bundle?.validation?.ok,sourceSummaryFeatureCount:bundle?.sourceSummary?.featureCount,listenerCount:listeners.size},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
