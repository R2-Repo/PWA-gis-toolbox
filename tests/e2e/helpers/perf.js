/** @param {import('@playwright/test').BrowserContext} context */
export function installLongTaskObserver(context) {
    context.addInitScript(() => {
        /**
         * longTasks keep every long task since this document started.
         * importStart/importDone are performance.now() marks for the import window.
         * @type {{ longTasks: { duration: number, startTime: number }[], totalBlockingTime: number, importStart: number | null, importDone: number | null }}
         */
        const perf = { longTasks: [], totalBlockingTime: 0, importStart: null, importDone: null };
        Object.defineProperty(window, '__GIS_E2E_PERF__', {
            value: perf,
            configurable: true
        });
        try {
            const obs = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    perf.longTasks.push({
                        duration: entry.duration,
                        startTime: entry.startTime
                    });
                    perf.totalBlockingTime += entry.duration;
                }
            });
            obs.observe({ type: 'longtask', buffered: true });
        } catch {
            // Long Task API unavailable
        }
    });
}

/**
 * Long-task metrics scoped to the import window.
 * A task counts when its startTime is inside [importStart, importDone], including
 * a task that starts inside the window and continues past importDone.
 * Tasks that start before the window are reported as bootLongest and are not gated.
 *
 * @param {{ startTime: number, duration: number }[] | null | undefined} longTasks
 * @param {number | null | undefined} importStart
 * @param {number | null | undefined} importDone
 */
export function metricsFromLongTasks(longTasks, importStart, importDone) {
    const tasks = Array.isArray(longTasks) ? longTasks : [];
    const hasStart = Number.isFinite(importStart);
    const hasWindow = hasStart && Number.isFinite(importDone);
    const scoped = hasWindow
        ? tasks.filter((t) => t.startTime >= importStart && t.startTime <= importDone)
        : [];
    const boot = hasStart ? tasks.filter((t) => t.startTime < importStart) : [];
    const sum = (list) => list.reduce((total, task) => total + task.duration, 0);
    const max = (list) => list.reduce((longest, task) => Math.max(longest, task.duration), 0);
    return {
        totalBlockingTime: sum(scoped),
        longestTask: max(scoped),
        longTaskCount: scoped.length,
        bootLongest: max(boot)
    };
}

/** @param {import('@playwright/test').Page} page */
export async function markImportStart(page) {
    await page.evaluate(() => {
        const perf = window.__GIS_E2E_PERF__;
        if (perf && perf.importStart == null) perf.importStart = performance.now();
    });
}

/** @param {import('@playwright/test').Page} page */
export async function markImportDone(page) {
    await page.evaluate(() => {
        const perf = window.__GIS_E2E_PERF__;
        if (perf) perf.importDone = performance.now();
    });
}

/** @param {import('@playwright/test').Page} page */
export async function readLongTaskMetrics(page) {
    const raw = await page.evaluate(() => {
        const perf = window.__GIS_E2E_PERF__;
        if (!perf) return { longTasks: [], importStart: null, importDone: null };
        return {
            longTasks: perf.longTasks.map((task) => ({
                duration: task.duration,
                startTime: task.startTime
            })),
            importStart: perf.importStart,
            importDone: perf.importDone
        };
    });
    return metricsFromLongTasks(raw.longTasks, raw.importStart, raw.importDone);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ jsHeapUsed?: number, jsHeapTotal?: number }>}
 */
export async function readCdpHeapMetrics(page) {
    const session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    const { metrics } = await session.send('Performance.getMetrics');
    await session.detach().catch(() => {});
    const byName = Object.fromEntries(metrics.map((m) => [m.name, m.value]));
    return {
        jsHeapUsed: byName.JSHeapUsedSize,
        jsHeapTotal: byName.JSHeapTotalSize
    };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ importMs: number, fixtureId: string }} row
 */
export async function buildPerfRow(page, row) {
    const longTasks = await readLongTaskMetrics(page);
    const heap = await readCdpHeapMetrics(page);
    const ttiMs = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        return nav ? nav.domInteractive : performance.timing?.domInteractive || 0;
    });
    return {
        id: row.fixtureId,
        importMs: row.importMs,
        ttiMs,
        tbt: Math.round(longTasks.totalBlockingTime),
        longest: Math.round(longTasks.longestTask),
        bootLongest: Math.round(longTasks.bootLongest ?? 0),
        heapUsed: heap.jsHeapUsed != null ? Math.round(heap.jsHeapUsed) : null,
        heapTotal: heap.jsHeapTotal != null ? Math.round(heap.jsHeapTotal) : null
    };
}

/**
 * @param {{ startedAtMs: number, finishedAtMs: number }} timing
 */
export function importWallMs(timing) {
    return timing.finishedAtMs - timing.startedAtMs;
}
