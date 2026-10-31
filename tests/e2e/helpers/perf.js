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
 * @param {{ startedAtMs: number, finishedAtMs: number }} timing
 */
export function importWallMs(timing) {
    return timing.finishedAtMs - timing.startedAtMs;
}
