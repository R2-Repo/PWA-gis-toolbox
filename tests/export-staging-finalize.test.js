import { beforeAll, describe, expect, it } from 'vitest';

const files = new Map();
let removeCount = 0;

function installOpfsMock() {
    class FileSystemFileHandle {
        constructor(name) {
            this.name = name;
            this.kind = 'file';
        }

        async createWritable() {
            const rec = files.get(this.name);
            const chunks = [];
            return {
                async write(chunk) {
                    if (chunk) chunks.push(String(chunk));
                },
                async close() {
                    rec.text = chunks.join('');
                    rec.removed = false;
                    rec.lastModified = Date.now();
                },
                async abort() {}
            };
        }

        async getFile() {
            const rec = files.get(this.name);
            const read = () => {
                if (!rec || rec.removed) {
                    const err = new Error('file deleted');
                    err.name = 'NotFoundError';
                    throw err;
                }
                return rec.text;
            };
            return {
                type: 'application/geo+json',
                lastModified: rec?.lastModified || Date.now(),
                get size() {
                    return read().length;
                },
                async arrayBuffer() {
                    return new TextEncoder().encode(read()).buffer;
                },
                slice() {
                    return {
                        async text() {
                            return read();
                        },
                        async arrayBuffer() {
                            return new TextEncoder().encode(read()).buffer;
                        }
                    };
                }
            };
        }
    }

    const dir = {
        async getFileHandle(name, opts = {}) {
            if (!files.has(name)) {
                if (!opts.create) throw new Error(`missing ${name}`);
                files.set(name, { text: '', removed: false, lastModified: Date.now() });
            }
            return new FileSystemFileHandle(name);
        },
        async removeEntry(name) {
            removeCount += 1;
            const rec = files.get(name);
            if (rec) rec.removed = true;
        },
        async *entries() {
            for (const [name, rec] of files) {
                if (rec.removed) continue;
                yield [name, {
                    kind: 'file',
                    async getFile() {
                        return { lastModified: rec.lastModified || 0 };
                    }
                }];
            }
        }
    };

    globalThis.FileSystemFileHandle = FileSystemFileHandle;
    const nav = {
        storage: {
            async getDirectory() {
                return { getDirectoryHandle: async () => dir };
            },
            async estimate() {
                return { usage: 0, quota: 8 * 1024 * 1024 * 1024 };
            }
        }
    };
    try {
        Object.defineProperty(globalThis, 'navigator', {
            value: nav,
            configurable: true,
            writable: true
        });
    } catch {
        globalThis.navigator.storage = nav.storage;
    }
}

describe('OPFS export staging outlives the download read', () => {
    let createExportStagingSession;
    let sweepExportStagingFiles;
    let DOWNLOAD_BLOB_REVOKE_MS;

    beforeAll(async () => {
        installOpfsMock();
        ({ createExportStagingSession, sweepExportStagingFiles } = await import('../js/workspace/export-staging-store.js'));
        ({ DOWNLOAD_BLOB_REVOKE_MS } = await import('../js/export/exporter.js'));
    });

    it('copies the staged file into memory before removing it', async () => {
        removeCount = 0;
        const session = await createExportStagingSession('mileposts.geojson');
        expect(session.supported).toBe(true);
        const payload = '{"type":"FeatureCollection","features":[{"properties":{"route":"0015P"}}]}';
        await session.appendText(payload);
        const { blob, fileName } = await session.finalize();
        expect(fileName).toBe('mileposts.geojson');
        expect(removeCount).toBeGreaterThan(0);
        await expect(blob.text()).resolves.toBe(payload);
    });

    it('sweeps stale staging files and keeps the download URL alive longer than 100ms', async () => {
        files.set('exp_old__stale.geojson', {
            text: 'stale',
            removed: false,
            lastModified: Date.now() - 10_000
        });
        const removed = await sweepExportStagingFiles(1000);
        expect(removed).toBeGreaterThanOrEqual(1);
        expect(files.get('exp_old__stale.geojson').removed).toBe(true);
        expect(DOWNLOAD_BLOB_REVOKE_MS).toBeGreaterThan(100);
    });
});
