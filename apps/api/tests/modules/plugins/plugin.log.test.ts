import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { PluginLog, PluginLogOptions } from '../../../src/modules/plugins/plugin.log.js';
import type { LogEntry, RotatingLogStore } from '../../../src/logging/rotating.log.store.js';

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

/** Faithful in-memory stand-in for {@link RotatingLogStore}'s public surface. */
class FakeLogStore {
    append = vi.fn<RotatingLogStore['append']>();
    tail = vi.fn<RotatingLogStore['tail']>(async () => []);
    readAll = vi.fn<RotatingLogStore['readAll']>(async () => '');
}

describe('PluginLog', () => {
    describe('for(pluginId)', () => {
        it('tees a line to both the app logger and the store when it clears the default level', () => {
            const logger = stubLogger();
            const store = new FakeLogStore();
            const log = new PluginLog(logger, store as unknown as RotatingLogStore, new PluginLogOptions('info'));

            log.for('plugin.a').warn('careful', { code: 7 });

            expect(logger.warn).toHaveBeenCalledWith('careful', { code: 7, plugin: 'plugin.a' });
            expect(store.append).toHaveBeenCalledWith('plugin.a', 'warn', 'careful', { code: 7 });
        });

        it('still reaches the app logger when the line is below the file verbosity gate', () => {
            const logger = stubLogger();
            const store = new FakeLogStore();
            const log = new PluginLog(logger, store as unknown as RotatingLogStore, new PluginLogOptions('warn'));

            log.for('plugin.a').info('routine');

            expect(logger.info).toHaveBeenCalledWith('routine', { plugin: 'plugin.a' });
            expect(store.append).not.toHaveBeenCalled();
        });

        it('gates the store write at exactly the plugin default level, inclusive', () => {
            const logger = stubLogger();
            const store = new FakeLogStore();
            const log = new PluginLog(logger, store as unknown as RotatingLogStore, new PluginLogOptions('warn'));

            log.for('plugin.a').warn('right at the line');

            expect(store.append).toHaveBeenCalledWith('plugin.a', 'warn', 'right at the line', undefined);
        });

        it('omits the plugin tag from the store copy but keeps it on the app logger copy', () => {
            const logger = stubLogger();
            const store = new FakeLogStore();
            const log = new PluginLog(logger, store as unknown as RotatingLogStore, new PluginLogOptions('debug'));

            log.for('plugin.a').error('boom');

            expect(logger.error).toHaveBeenCalledWith('boom', { plugin: 'plugin.a' });
            expect(store.append).toHaveBeenCalledWith('plugin.a', 'error', 'boom', undefined);
        });

        it('scopes independent PluginLoggers to their own plugin id', () => {
            const logger = stubLogger();
            const store = new FakeLogStore();
            const log = new PluginLog(logger, store as unknown as RotatingLogStore, new PluginLogOptions('debug'));

            log.for('plugin.a').debug('from a');
            log.for('plugin.b').debug('from b');

            expect(store.append).toHaveBeenNthCalledWith(1, 'plugin.a', 'debug', 'from a', undefined);
            expect(store.append).toHaveBeenNthCalledWith(2, 'plugin.b', 'debug', 'from b', undefined);
        });

        it('honors a per-plugin level set via setLevel over the injected default', () => {
            const logger = stubLogger();
            const store = new FakeLogStore();
            const log = new PluginLog(logger, store as unknown as RotatingLogStore, new PluginLogOptions('error'));

            log.setLevel('plugin.a', 'debug');
            log.for('plugin.a').debug('now visible');

            expect(store.append).toHaveBeenCalledWith('plugin.a', 'debug', 'now visible', undefined);
        });
    });

    describe('unscoped passthroughs', () => {
        it.each(['debug', 'info', 'warn', 'error'] as const)('%s reaches only the app logger, never the store', level => {
            const logger = stubLogger();
            const store = new FakeLogStore();
            const log = new PluginLog(logger, store as unknown as RotatingLogStore, new PluginLogOptions());

            log[level]('module-wide line', { extra: true });

            expect(logger[level]).toHaveBeenCalledWith('module-wide line', { extra: true });
            expect(store.append).not.toHaveBeenCalled();
        });
    });

    describe('setLevel / levelOf', () => {
        it('defaults an unconfigured plugin to the injected default level', () => {
            const log = new PluginLog(stubLogger(), new FakeLogStore() as unknown as RotatingLogStore, new PluginLogOptions('warn'));

            expect(log.levelOf('plugin.new')).toBe('warn');
        });

        it('falls back to "info" when PluginLogOptions is constructed with no argument', () => {
            const log = new PluginLog(stubLogger(), new FakeLogStore() as unknown as RotatingLogStore, new PluginLogOptions());

            expect(log.levelOf('plugin.new')).toBe('info');
        });

        it('reflects a level set via setLevel', () => {
            const log = new PluginLog(stubLogger(), new FakeLogStore() as unknown as RotatingLogStore, new PluginLogOptions('info'));

            log.setLevel('plugin.a', 'error');

            expect(log.levelOf('plugin.a')).toBe('error');
        });

        it('clears back to the default when set with undefined', () => {
            const log = new PluginLog(stubLogger(), new FakeLogStore() as unknown as RotatingLogStore, new PluginLogOptions('info'));

            log.setLevel('plugin.a', 'error');
            log.setLevel('plugin.a', undefined);

            expect(log.levelOf('plugin.a')).toBe('info');
        });

        it('tracks levels independently per plugin id', () => {
            const log = new PluginLog(stubLogger(), new FakeLogStore() as unknown as RotatingLogStore, new PluginLogOptions('info'));

            log.setLevel('plugin.a', 'debug');

            expect(log.levelOf('plugin.a')).toBe('debug');
            expect(log.levelOf('plugin.b')).toBe('info');
        });
    });

    describe('tail / readAll delegation', () => {
        it('delegates tail to the store with the same arguments and returns its result', async () => {
            const store = new FakeLogStore();
            const entries: LogEntry[] = [{ ts: '2026-01-01T00:00:00.000Z', level: 'INFO', text: 'hi' }];
            store.tail.mockResolvedValueOnce(entries);
            const log = new PluginLog(stubLogger(), store as unknown as RotatingLogStore, new PluginLogOptions());

            const result = await log.tail('plugin.a', { limit: 5, level: 'warn' });

            expect(store.tail).toHaveBeenCalledWith('plugin.a', { limit: 5, level: 'warn' });
            expect(result).toBe(entries);
        });

        it('delegates tail with no options through unchanged', async () => {
            const store = new FakeLogStore();
            const log = new PluginLog(stubLogger(), store as unknown as RotatingLogStore, new PluginLogOptions());

            await log.tail('plugin.a');

            expect(store.tail).toHaveBeenCalledWith('plugin.a', undefined);
        });

        it('delegates readAll to the store and returns its result', async () => {
            const store = new FakeLogStore();
            store.readAll.mockResolvedValueOnce('log contents');
            const log = new PluginLog(stubLogger(), store as unknown as RotatingLogStore, new PluginLogOptions());

            const result = await log.readAll('plugin.a');

            expect(store.readAll).toHaveBeenCalledWith('plugin.a');
            expect(result).toBe('log contents');
        });
    });
});
