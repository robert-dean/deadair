import type { Logger } from '@maroonedsoftware/logger';
import { beforeEach, describe, expect, it } from 'vitest';

import { DeadairLogger } from '../../src/logging/deadair.logger.js';
import { runInTrace } from '../../src/modules/shared/trace.context.js';
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

    it('renders an object message rather than writing [object Object]', () => {
        // `String({})` is `[object Object]`, which is what five pino-style
        // `logger.warn({ err }, 'message')` calls wrote to the log for days: both
        // the error and the sentence gone. The call sites are fixed; this is the
        // store refusing to lose one again.
        logger.warn({ err: 'boom', attempt: 2 });

        expect(storeCalls[0]?.message).toBe('{"err":"boom","attempt":2}');
        expect(storeCalls[0]?.message).not.toContain('[object Object]');
    });

    it('falls back to String() for an object JSON cannot take', () => {
        const circular: Record<string, unknown> = { tag: 'loop' };
        circular.self = circular;

        logger.warn(circular);

        // Imperfect beats absent: a line that says `[object Object]` is still
        // better than a throw from the logger.
        expect(storeCalls[0]?.message).toBe(String(circular));
    });

    it('keeps an Error message as its sentence and puts the stack in meta', () => {
        const error = new Error('kaboom');
        logger.error(error);

        // `String(error)` loses the stack entirely, which is why
        // "Transaction is already committed" sat in the log for days with nothing
        // to attribute it to.
        expect(storeCalls[0]?.message).toBe('kaboom');
        expect(storeCalls[0]?.meta?.errorName).toBe('Error');
        expect(String(storeCalls[0]?.meta?.stack)).toContain('deadair.logger.test');
    });

    it('keeps only the app frames of a stack, since a truncated vendor stack names nothing', () => {
        const error = new Error('kaboom');
        error.stack = [
            'Error: kaboom',
            '    at assertNotCommitted (/repo/node_modules/.pnpm/kysely/dist/kysely.js:972:15)',
            '    at Executor.executeQuery (/repo/node_modules/.pnpm/kysely/dist/kysely.js:1010:9)',
            '    at StationAirRepository.get (/repo/apps/api/src/modules/director/station.air.repository.ts:48:14)',
            '    at DirectorService.readAir (/repo/apps/api/src/modules/director/director.service.ts:664:43)',
        ].join('\n');

        logger.error(error);

        const stack = String(storeCalls[0]?.meta?.stack);
        expect(stack).toContain('StationAirRepository.get');
        expect(stack).toContain('DirectorService.readAir');
        expect(stack).not.toContain('node_modules');
    });

    it('keeps vendor frames when a stack has no app frames at all, rather than reporting nothing', () => {
        const error = new Error('kaboom');
        error.stack = ['Error: kaboom', '    at driver (/repo/node_modules/pg/lib/client.js:1:1)'].join('\n');

        logger.error(error);

        expect(String(storeCalls[0]?.meta?.stack)).toContain('node_modules/pg');
    });

    it('still tees to the inner logger even when the store append call is what is under test, keeping both sinks independent', () => {
        logger.debug('one');
        logger.debug('two');

        expect(innerCalls).toHaveLength(2);
        expect(storeCalls).toHaveLength(2);
        expect(storeCalls.map(c => c.message)).toEqual(['one', 'two']);
    });

    // The stored half carries the decision a line belongs to; the stdout half deliberately does not.
    // A file interleaves four concurrent decisions and the id is the only way to pull one out, which
    // is the whole of "nothing correlates one decision's calls"; a terminal somebody is watching is
    // already showing one thing at a time and an id on every line of it is noise.
    describe('the trace a line belongs to', () => {
        it('stamps the stored line and leaves stdout alone', async () => {
            await runInTrace({ id: 'job-7', kind: 'director.refill_lineup' }, async () => {
                logger.info('programming an hour', { brief: 'rap hits' });
            });

            expect(storeCalls[0]?.meta).toEqual({ brief: 'rap hits', trace: 'job-7' });
            expect(innerCalls[0]?.optionalParams).toEqual([{ brief: 'rap hits' }]);
        });

        it('stamps a line that carried no meta of its own', async () => {
            await runInTrace({ id: 'job-7', kind: 'k' }, async () => {
                logger.warn('the model chose nothing');
            });

            expect(storeCalls[0]?.meta).toEqual({ trace: 'job-7' });
        });

        it('stamps an Error alongside the fields the store adds for one', async () => {
            const error = new Error('kaboom');
            error.stack = ['Error: kaboom', '    at run (/repo/apps/api/src/thing.ts:1:1)'].join('\n');

            await runInTrace({ id: 'job-7', kind: 'k' }, async () => {
                logger.error(error);
            });

            expect(storeCalls[0]?.meta).toMatchObject({ trace: 'job-7', errorName: 'Error' });
        });

        it('adds nothing outside a trace, rather than an empty field', () => {
            // Startup, shutdown and anything a plugin does on a timer of its own. A blank `trace`
            // would read as a decision nobody could find rather than as no decision.
            logger.info('Setting up Analysis');

            expect(storeCalls[0]?.meta).toBeUndefined();
        });

        it('never overwrites a trace the caller chose', async () => {
            // Nothing passes one today. It costs nothing to be sure this can only ever add.
            await runInTrace({ id: 'job-7', kind: 'k' }, async () => {
                logger.info('replaying', { trace: 'job-1' });
            });

            expect(storeCalls[0]?.meta).toEqual({ trace: 'job-1' });
        });
    });
});
