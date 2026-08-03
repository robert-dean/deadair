import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginEchoTracker } from '../../../src/modules/plugins/plugin.echo.tracker.js';

const ECHO_WINDOW_MS = 10_000;

afterEach(() => {
    vi.useRealTimers();
});

describe('PluginEchoTracker', () => {
    it('consumes a single announced echo exactly once', () => {
        const tracker = new PluginEchoTracker();
        tracker.expectEcho('plugin.a');

        expect(tracker.consumeEcho('plugin.a')).toBe(true);
        expect(tracker.consumeEcho('plugin.a')).toBe(false);
    });

    it('reports no echo pending for a plugin that never announced one', () => {
        const tracker = new PluginEchoTracker();

        expect(tracker.consumeEcho('plugin.unannounced')).toBe(false);
    });

    it('tracks each plugin independently', () => {
        const tracker = new PluginEchoTracker();
        tracker.expectEcho('plugin.a');

        expect(tracker.consumeEcho('plugin.b')).toBe(false);
        expect(tracker.consumeEcho('plugin.a')).toBe(true);
    });

    it('consumes two pending expectations independently, oldest first', () => {
        const tracker = new PluginEchoTracker();
        tracker.expectEcho('plugin.a');
        tracker.expectEcho('plugin.a');

        expect(tracker.consumeEcho('plugin.a')).toBe(true);
        expect(tracker.consumeEcho('plugin.a')).toBe(true);
        expect(tracker.consumeEcho('plugin.a')).toBe(false);
    });

    it('announces multiple expectations in one call via count', () => {
        const tracker = new PluginEchoTracker();
        tracker.expectEcho('plugin.a', 2);

        expect(tracker.consumeEcho('plugin.a')).toBe(true);
        expect(tracker.consumeEcho('plugin.a')).toBe(true);
        expect(tracker.consumeEcho('plugin.a')).toBe(false);
    });

    it('ignores a non-positive count and announces nothing', () => {
        const tracker = new PluginEchoTracker();
        tracker.expectEcho('plugin.a', 0);
        tracker.expectEcho('plugin.a', -1);

        expect(tracker.consumeEcho('plugin.a')).toBe(false);
    });

    it('expires an expectation older than the echo window', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const tracker = new PluginEchoTracker();
        tracker.expectEcho('plugin.a');

        vi.setSystemTime(ECHO_WINDOW_MS + 1);

        expect(tracker.consumeEcho('plugin.a')).toBe(false);
    });

    it('still consumes an expectation one tick under the window boundary', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const tracker = new PluginEchoTracker();
        tracker.expectEcho('plugin.a');

        vi.setSystemTime(ECHO_WINDOW_MS - 1);

        expect(tracker.consumeEcho('plugin.a')).toBe(true);
    });

    it('retract removes a pending expectation so the next consume is false', () => {
        const tracker = new PluginEchoTracker();
        tracker.expectEcho('plugin.a');

        tracker.retractEcho('plugin.a');

        expect(tracker.consumeEcho('plugin.a')).toBe(false);
    });

    it('retract on a plugin with nothing pending is a no-op', () => {
        const tracker = new PluginEchoTracker();

        expect(() => tracker.retractEcho('plugin.a')).not.toThrow();
        expect(tracker.consumeEcho('plugin.a')).toBe(false);
    });

    it('retract removes only the most recently announced expectations, leaving the rest consumable', () => {
        const tracker = new PluginEchoTracker();
        tracker.expectEcho('plugin.a', 3);

        tracker.retractEcho('plugin.a', 2);

        expect(tracker.consumeEcho('plugin.a')).toBe(true);
        expect(tracker.consumeEcho('plugin.a')).toBe(false);
    });

    it('retract with a count larger than pending clears everything without throwing', () => {
        const tracker = new PluginEchoTracker();
        tracker.expectEcho('plugin.a', 1);

        expect(() => tracker.retractEcho('plugin.a', 5)).not.toThrow();
        expect(tracker.consumeEcho('plugin.a')).toBe(false);
    });
});
