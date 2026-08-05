import type { Logger } from '@maroonedsoftware/logger';
import { beforeEach, describe, expect, it } from 'vitest';

import { DeadairLogger } from '../../src/logging/deadair.logger.js';
import type { RotatingLogStore } from '../../src/logging/rotating.log.store.js';

interface RecordedInnerCall {
    method: 'error' | 'warn' | 'info' | 'debug' | 'trace';
    message: unknown;
    optionalParams: unknown[];
}

interface RecordedAppendCall {
    channel: string | undefined;
    level: string;
    message: string;
    meta?: Record<string, unknown>;
}

function makeFakeInner(): { inner: Logger; calls: RecordedInnerCall[] } {
    const calls: RecordedInnerCall[] = [];
    const record =
        (method: RecordedInnerCall['method']) =>
        (message: unknown, ...optionalParams: unknown[]): void => {
            calls.push({ method, message, optionalParams });
        };

    const inner: Logger = {
        error: record('error'),
        warn: record('warn'),
        info: record('info'),
        debug: record('debug'),
        trace: record('trace'),
    };

    return { inner, calls };
}

function makeFakeStore(): { store: RotatingLogStore; calls: RecordedAppendCall[] } {
    const calls: RecordedAppendCall[] = [];
    const store = {
        append(channel: string | undefined, level: string, message: string, meta?: Record<string, unknown>): void {
            calls.push({ channel, level, message, meta });
        },
    } as unknown as RotatingLogStore;

    return { store, calls };
}

describe('DeadairLogger', () => {
    let inner: Logger;
    let innerCalls: RecordedInnerCall[];
    let store: RotatingLogStore;
    let storeCalls: RecordedAppendCall[];
    let logger: DeadairLogger;

    beforeEach(() => {
        ({ inner, calls: innerCalls } = makeFakeInner());
        ({ store, calls: storeCalls } = makeFakeStore());
        logger = new DeadairLogger(inner, store);
    });

    it.each(['error', 'warn', 'info', 'debug', 'trace'] as const)(
        'tees %s to both the inner logger and the store, with the API channel (undefined)',
        method => {
            logger[method]('hello world');

            expect(innerCalls).toEqual([{ method, message: 'hello world', optionalParams: [] }]);
            expect(storeCalls).toEqual([{ channel: undefined, level: method, message: 'hello world', meta: undefined }]);
        },
    );

    it('forwards every optional param to the inner logger unchanged', () => {
        logger.info('multi', { a: 1 }, 'extra', 42);

        expect(innerCalls).toEqual([{ method: 'info', message: 'multi', optionalParams: [{ a: 1 }, 'extra', 42] }]);
    });

    it('passes the first optional param to the store as meta when it is a plain object', () => {
        logger.warn('careful', { requestId: 'abc-123' });

        expect(storeCalls).toEqual([{ channel: undefined, level: 'warn', message: 'careful', meta: { requestId: 'abc-123' } }]);
    });

    it('omits meta when there are no optional params', () => {
        logger.error('boom');

        expect(storeCalls[0]?.meta).toBeUndefined();
    });

    it('omits meta when the first optional param is an array', () => {
        logger.debug('array param', [1, 2, 3]);

        expect(storeCalls[0]?.meta).toBeUndefined();
    });

    it('omits meta when the first optional param is a primitive', () => {
        logger.trace('primitive param', 'not-an-object');

        expect(storeCalls[0]?.meta).toBeUndefined();
    });

    it('omits meta when the first optional param is null', () => {
        logger.info('null param', null);

        expect(storeCalls[0]?.meta).toBeUndefined();
    });

    it('stringifies a non-string message with String() before appending to the store', () => {
        logger.info(404);

        expect(storeCalls).toEqual([{ channel: undefined, level: 'info', message: '404', meta: undefined }]);
        // The inner logger still gets the original, unconverted value.
        expect(innerCalls).toEqual([{ method: 'info', message: 404, optionalParams: [] }]);
    });

    it('stringifies an object message with String() rather than JSON.stringify', () => {
        const messageObject = { toString: () => 'custom-string' };
        logger.warn(messageObject);

        expect(storeCalls).toEqual([{ channel: undefined, level: 'warn', message: 'custom-string', meta: undefined }]);
    });

    it('stringifies an Error message via its default toString', () => {
        const error = new Error('kaboom');
        logger.error(error);

        expect(storeCalls[0]?.message).toBe(String(error));
    });

    it('still tees to the inner logger even when the store append call is what is under test, keeping both sinks independent', () => {
        logger.debug('one');
        logger.debug('two');

        expect(innerCalls).toHaveLength(2);
        expect(storeCalls).toHaveLength(2);
        expect(storeCalls.map(c => c.message)).toEqual(['one', 'two']);
    });
});
