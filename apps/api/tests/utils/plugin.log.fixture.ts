import { vi } from 'vitest';

import type { PluginLog } from '../../src/modules/plugins/plugin.log.js';

export interface PluginLogStub {
    scoped: { debug: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    log: PluginLog;
}

/**
 * Shared `PluginLog` test double. `.log` is what goes to a constructor;
 * `.scoped` is the handle a test asserts against for anything logged
 * through `pluginLog.for(id)`.
 */
export const stubPluginLog = (): PluginLogStub => {
    const scoped = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return {
        scoped,
        log: {
            for: vi.fn(() => scoped),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            setLevel: vi.fn(),
            levelOf: vi.fn(() => 'info'),
            tail: vi.fn(async () => []),
            readAll: vi.fn(async () => ''),
        } as unknown as PluginLog,
    };
};
