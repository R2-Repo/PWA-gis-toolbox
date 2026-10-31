/** @param {import('@playwright/test').BrowserContext} context */
export function installLongTaskObserver(context) {
    context.addInitScript(() => {
        /** @type {{ longTasks: { duration: number, startTime: number }[], totalBlockingTime: number }} */
        const perf = { longTasks: [], totalBlockingTime: 0 };
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

/** @param {import('@playwright/test').Page} page */
export async function readLongTaskMetrics(page) {
    return page.evaluate(() => {
        const perf = window.__GIS_E2E_PERF__;
        if (!perf) {
            return { totalBlockingTime: 0, longestTask: 0, longTaskCount: 0 };
        }
        const longest = perf.longTasks.reduce((m, t) => Math.max(m, t.duration), 0);
        return {
            totalBlockingTime: perf.totalBlockingTime,
            longestTask: longest,
            longTaskCount: perf.longTasks.length
        };
    });
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
