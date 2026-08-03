import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { Notification } from 'pg';

import { PLUGIN_RELOAD_CHANNEL, PluginReloadListener, PluginReloadListenerOptions } from '../../../src/modules/plugins/plugin.reload.listener.js';
import { PluginEchoTracker } from '../../../src/modules/plugins/plugin.echo.tracker.js';
import { PluginLifecycleManager } from '../../../src/modules/plugins/plugin.lifecycle.manager.js';

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

const stubLifecycleManager = (): PluginLifecycleManager =>
    ({
        reinitPlugin: vi.fn().mockResolvedValue(undefined),
    }) as unknown as PluginLifecycleManager;

/** `PluginReloadListener.handleNotification` is private; reached via the notification path directly. */
interface ListenerNotificationSeam {
    handleNotification(notification: Notification): void;
}

function makeListener(lifecycleManager: PluginLifecycleManager, tracker: PluginEchoTracker) {
    // The connection details are never used: these tests drive `handleNotification`
    // directly and never call `connect()`, so no real `pg.Client` is created.
    const options = new PluginReloadListenerOptions({});
    return new PluginReloadListener(options, lifecycleManager, tracker, stubLogger());
}

function notify(payload: string, channel: string = PLUGIN_RELOAD_CHANNEL): Notification {
    return { processId: 1, channel, payload } as Notification;
}

describe('PluginReloadListener notification handling', () => {
    it('suppresses reinit for a notification whose write this process announced, and consumes the echo', () => {
        const tracker = new PluginEchoTracker();
        tracker.expectEcho('plugin.a');
        const lifecycleManager = stubLifecycleManager();
        const listener = makeListener(lifecycleManager, tracker);

        (listener as unknown as ListenerNotificationSeam).handleNotification(notify('plugin.a'));

        expect(lifecycleManager.reinitPlugin).not.toHaveBeenCalled();
        // The echo was consumed: nothing left pending for a following genuine change.
        expect(tracker.consumeEcho('plugin.a')).toBe(false);
    });

    it('reinitializes for a notification with no pending echo', () => {
        const tracker = new PluginEchoTracker();
        const lifecycleManager = stubLifecycleManager();
        const listener = makeListener(lifecycleManager, tracker);

        (listener as unknown as ListenerNotificationSeam).handleNotification(notify('plugin.a'));

        expect(lifecycleManager.reinitPlugin).toHaveBeenCalledExactlyOnceWith('plugin.a');
    });

    it('suppresses exactly one notification: a second one for the same plugin reinitializes', () => {
        const tracker = new PluginEchoTracker();
        tracker.expectEcho('plugin.a');
        const lifecycleManager = stubLifecycleManager();
        const listener = makeListener(lifecycleManager, tracker);

        (listener as unknown as ListenerNotificationSeam).handleNotification(notify('plugin.a'));
        (listener as unknown as ListenerNotificationSeam).handleNotification(notify('plugin.a'));

        expect(lifecycleManager.reinitPlugin).toHaveBeenCalledExactlyOnceWith('plugin.a');
    });

    it('ignores a notification on a different channel', () => {
        const tracker = new PluginEchoTracker();
        const lifecycleManager = stubLifecycleManager();
        const listener = makeListener(lifecycleManager, tracker);

        (listener as unknown as ListenerNotificationSeam).handleNotification(notify('plugin.a', 'some_other_channel'));

        expect(lifecycleManager.reinitPlugin).not.toHaveBeenCalled();
    });

    it('ignores a notification with an empty payload', () => {
        const tracker = new PluginEchoTracker();
        const lifecycleManager = stubLifecycleManager();
        const listener = makeListener(lifecycleManager, tracker);

        (listener as unknown as ListenerNotificationSeam).handleNotification(notify('   '));

        expect(lifecycleManager.reinitPlugin).not.toHaveBeenCalled();
    });
});
