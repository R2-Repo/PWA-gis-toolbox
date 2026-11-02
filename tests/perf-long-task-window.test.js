import { describe, expect, it } from 'vitest';
import { metricsFromLongTasks } from './e2e/helpers/perf.js';

describe('metricsFromLongTasks', () => {
    const tasks = [
        { startTime: 100, duration: 220 },
        { startTime: 1000, duration: 80 },
        { startTime: 1500, duration: 400 },
        { startTime: 2000, duration: 999 }
    ];

    it('counts only tasks whose start falls inside the import window', () => {
        const metrics = metricsFromLongTasks(tasks, 1000, 1500);
        expect(metrics.longestTask).toBe(400);
        expect(metrics.totalBlockingTime).toBe(480);
        expect(metrics.longTaskCount).toBe(2);
        expect(metrics.bootLongest).toBe(220);
    });

    it('includes a task that starts inside the window and runs past import done', () => {
        const metrics = metricsFromLongTasks(
            [{ startTime: 1490, duration: 350 }],
            1000,
            1500
        );
        expect(metrics.longestTask).toBe(350);
        expect(metrics.totalBlockingTime).toBe(350);
        expect(metrics.bootLongest).toBe(0);
    });

    it('keeps a boundary task that starts exactly at import start or import done', () => {
        const metrics = metricsFromLongTasks(
            [
                { startTime: 1000, duration: 60 },
                { startTime: 1500, duration: 70 }
            ],
            1000,
            1500
        );
        expect(metrics.longestTask).toBe(70);
        expect(metrics.longTaskCount).toBe(2);
        expect(metrics.bootLongest).toBe(0);
    });

    it('does not gate boot or post-import tasks', () => {
        const metrics = metricsFromLongTasks(tasks, 1000, 1500);
        expect(metrics.longestTask).toBe(400);
        expect(metrics.bootLongest).toBe(220);
        expect(metrics.longestTask).not.toBe(999);
    });

    it('reports zeros when the import window was not marked', () => {
        const metrics = metricsFromLongTasks(tasks, null, null);
        expect(metrics).toEqual({
            totalBlockingTime: 0,
            longestTask: 0,
            longTaskCount: 0,
            bootLongest: 0
        });
    });
});
