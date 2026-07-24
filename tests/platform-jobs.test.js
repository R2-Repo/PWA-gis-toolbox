import { describe, expect, it } from 'vitest';
import { createJobHandle, nextJobId } from '../js/platform/jobs/create-job-handle.js';
import { JobCanceledError, isJobCanceledError } from '../js/platform/jobs/job-errors.js';
import { isKnownNativeOperation, NATIVE_OPERATIONS } from '../js/platform/jobs/allowed-operations.js';
import { createWebJobService } from '../js/platform/web/web-job-service.js';
import { createWindowsComputeService } from '../js/platform/windows/windows-compute-service.js';

describe('platform jobs', () => {
    it('creates job ids and streams progress', async () => {
        const id = nextJobId('test');
        expect(id.startsWith('test-')).toBe(true);

        const progressEvents = [];
        const logs = [];
        const handle = createJobHandle({
            id,
            operation: 'demo',
            async run({ onProgress, onLog }) {
                onProgress({ percent: 10, stage: 'start' });
                onLog('hello');
                onProgress({ percent: 100, stage: 'done' });
                return { ok: true };
            }
        });
        handle.onProgress((p) => progressEvents.push(p));
        handle.onLog((m) => logs.push(m));

        await expect(handle.result).resolves.toEqual({ ok: true });
        expect(progressEvents).toEqual([
            { percent: 10, stage: 'start' },
            { percent: 100, stage: 'done' }
        ]);
        expect(logs).toEqual(['hello']);
    });

    it('cancels an in-flight job via AbortSignal', async () => {
        const handle = createJobHandle({
            id: 'cancel-me',
            operation: 'slow',
            async run({ signal }) {
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(resolve, 500);
                    signal.addEventListener('abort', () => {
                        clearTimeout(timer);
                        reject(new JobCanceledError());
                    }, { once: true });
                });
                return 'done';
            }
        });

        queueMicrotask(() => handle.cancel());
        await expect(handle.result).rejects.toBeInstanceOf(JobCanceledError);
        await expect(handle.result).rejects.toSatisfy(isJobCanceledError);
    });

    it('web job service supports registered local runners and rejects unknown ops', async () => {
        const jobs = createWebJobService({
            runners: {
                echo: async (input, ctx) => {
                    ctx.onProgress({ percent: 100, stage: 'done' });
                    return { echo: input };
                }
            }
        });

        const job = await jobs.start({ operation: 'echo', input: { a: 1 } });
        await expect(job.result).resolves.toEqual({ echo: { a: 1 } });
        await expect(jobs.start({ operation: 'summarize_geojson', input: {} }))
            .rejects.toThrow(/Windows desktop application/i);
    });

    it('windows compute service routes known ops through jobs', async () => {
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.SUMMARIZE_GEOJSON)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.INSPECT_VECTOR)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.SAMPLE_VECTOR)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.CONVERT_TO_GEOPARQUET)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.FILE_CHECKSUM)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.SUMMARIZE_VECTOR)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.GENERATE_PMTILES)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.CONVERT_TO_COG)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.BUFFER_VECTOR)).toBe(true);
        expect(isKnownNativeOperation(NATIVE_OPERATIONS.SPATIAL_FILTER)).toBe(true);

        const jobs = {
            async start({ operation, input }) {
                return createJobHandle({
                    id: 'mock',
                    operation,
                    async run() {
                        return { operation, input };
                    }
                });
            }
        };
        const compute = createWindowsComputeService(jobs);
        await expect(compute.run('echo', { hello: 'world' }))
            .resolves.toEqual({ operation: 'echo', input: { hello: 'world' } });
        await expect(compute.run('not-real', {}))
            .rejects.toThrow(/no handler/i);
    });
});
