/**
 * Read-only storage snapshot for e2e assertions (IndexedDB + OPFS).
 * @param {import('@playwright/test').Page} page
 */
export async function readImportStorageSnapshot(page) {
    return page.evaluate(async () => {
        const layerDom = document.querySelectorAll('.layer-list-items .layer-item').length;

        async function idbCounts(name) {
            try {
                const db = await new Promise((resolve, reject) => {
                    const req = indexedDB.open(name);
                    req.onerror = () => reject(req.error);
                    req.onsuccess = () => resolve(req.result);
                });
                const counts = {};
                for (const store of db.objectStoreNames) {
                    counts[store] = await new Promise((resolve, reject) => {
                        const tx = db.transaction(store, 'readonly');
                        const os = tx.objectStore(store);
                        const req = os.count();
                        req.onsuccess = () => resolve(req.result || 0);
                        req.onerror = () => reject(req.error);
                    });
                }
                db.close();
                return counts;
            } catch {
                return null;
            }
        }

        let opfsFiles = 0;
        try {
            if (navigator.storage?.getDirectory) {
                const root = await navigator.storage.getDirectory();
                const dir = await root.getDirectoryHandle('import-sources', { create: false });
                for await (const _ of dir.values()) {
                    opfsFiles += 1;
                }
            }
        } catch {
            opfsFiles = 0;
        }

        return {
            layerDom,
            workspace: await idbCounts('gis-toolbox-workspace'),
            importJobs: await idbCounts('gis-toolbox-import-jobs'),
            opfsSourceFiles: opfsFiles
        };
    });
}

/** @param {Awaited<ReturnType<typeof readImportStorageSnapshot>>} snap */
export function storageLooksEmpty(snap) {
    if (snap.layerDom > 0) return false;
    if (snap.opfsSourceFiles > 0) return false;
    const jobs = snap.importJobs;
    if (jobs && Object.values(jobs).some((n) => n > 0)) return false;
    const ws = snap.workspace;
    if (ws) {
        const layers = ws.layers ?? 0;
        const chunks = ws.chunks ?? 0;
        if (layers > 0 || chunks > 0) return false;
    }
    return true;
}
