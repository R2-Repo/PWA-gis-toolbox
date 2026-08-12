import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    beginActivity,
    endActivity,
    getAppActivityState,
    subscribeAppActivity,
    withActivity
} from '../js/ui/app-activity.js';
import bus from '../js/core/event-bus.js';
import { showProgressModal } from '../js/ui/modals.js';

describe('app-activity', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('stays hidden until the 1s delay, then shows label', () => {
        const states = [];
        const unsub = subscribeAppActivity((s) => states.push({ ...s }));
        const token = beginActivity('Buffer…');
        expect(getAppActivityState().visible).toBe(false);

        vi.advanceTimersByTime(999);
        expect(getAppActivityState().visible).toBe(false);

        vi.advanceTimersByTime(1);
        expect(getAppActivityState().visible).toBe(true);
        expect(getAppActivityState().label).toBe('Buffer…');

        endActivity(token);
        vi.advanceTimersByTime(300);
        expect(getAppActivityState().busy).toBe(false);
        expect(getAppActivityState().visible).toBe(false);
        unsub();
    });

    it('suppresses header visibility while a progress modal is open', () => {
        const token = beginActivity('Import…');
        vi.advanceTimersByTime(1000);
        expect(getAppActivityState().visible).toBe(true);

        const progress = showProgressModal('Importing');
        expect(getAppActivityState().suppressed).toBe(true);
        expect(getAppActivityState().visible).toBe(false);

        progress.close();
        expect(getAppActivityState().suppressed).toBe(false);
        expect(getAppActivityState().visible).toBe(true);

        endActivity(token);
        vi.advanceTimersByTime(300);
    });

    it('tracks TaskRunner bus events', () => {
        bus.emit('task:start', { id: 9001, name: 'Union' });
        expect(getAppActivityState().busy).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(getAppActivityState().visible).toBe(true);
        expect(getAppActivityState().label).toBe('Union');

        bus.emit('task:end', { id: 9001, name: 'Union', state: 'completed' });
        vi.advanceTimersByTime(300);
        expect(getAppActivityState().busy).toBe(false);
    });

    it('withActivity yields then clears on settle', async () => {
        const promise = withActivity('Join…', async () => 42);
        expect(getAppActivityState().busy).toBe(true);
        // withActivity awaits yieldToUI() (setTimeout 0) before running fn
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toBe(42);
        expect(getAppActivityState().busy).toBe(false);
    });
});
