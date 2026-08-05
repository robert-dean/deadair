import { describe, expect, it } from 'vitest';

import { PLUGIN_ERROR_CODES, PluginError, isPluginError, toPluginError } from '../src/plugin.error.js';

/**
 * A plugin bundled with its own copy of the SDK: same contract, different class
 * identity, and a brand computed independently through the global symbol
 * registry. Built by hand rather than by importing a second copy, so the test
 * fails if the brand's spelling ever changes without a deliberate version bump.
 */
function foreignCopy(overrides: Record<string, unknown> = {}): unknown {
    return {
        [Symbol.for('deadair.plugin-error/v1')]: true,
        name: 'PluginError',
        message: 'from another copy',
        code: 'auth',
        retryable: false,
        ...overrides,
    };
}

describe('PluginError', () => {
    it('is internal until it is told otherwise', () => {
        const error = new PluginError('boom');

        expect(error.code).toBe('internal');
        expect(error.retryable).toBe(true);
    });

    it('derives retryable from the code', () => {
        expect(new PluginError('expired').withCode('auth').retryable).toBe(false);
        expect(new PluginError('no client id').withCode('config').retryable).toBe(false);
        expect(new PluginError('slow down').withCode('rate_limited').retryable).toBe(true);
        expect(new PluginError('bad gateway').withCode('upstream').retryable).toBe(true);
    });

    it('lets retry advice override the default for the code, since being told to wait implies a retry is worth making', () => {
        expect(new PluginError('expired').withCode('auth').withRetry(5_000).retryable).toBe(true);
    });

    it('resets retryable when the code is set, so withCode belongs first in the chain', () => {
        expect(new PluginError('expired').withRetry(5_000).withCode('auth').retryable).toBe(false);
    });

    it('chains the classification onto the same instance', () => {
        const error = new PluginError('slow down').withCode('rate_limited').withUpstreamStatus(429).withRetry(30_000);

        expect(error.code).toBe('rate_limited');
        expect(error.upstreamStatus).toBe(429);
        expect(error.retryAfterMs).toBe(30_000);
    });

    it('is a real Error, so an unaware catch still behaves', () => {
        const error = new PluginError('took too long').withCode('timeout');
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('took too long');
        expect(String(error)).toContain('took too long');
    });

    it('keeps the cause for logging', () => {
        const cause = new Error('socket hang up');
        expect(new PluginError('failed', { cause }).withCode('upstream').cause).toBe(cause);
    });

    it('leaves unset optional detail as undefined rather than null', () => {
        const error = new PluginError('boom').withCode('internal');
        expect(error.retryAfterMs).toBeUndefined();
        expect(error.upstreamStatus).toBeUndefined();
    });

    it('has a retryable default for every declared code', () => {
        for (const code of PLUGIN_ERROR_CODES) {
            expect(typeof new PluginError('x').withCode(code).retryable).toBe('boolean');
        }
    });
});

describe('isPluginError', () => {
    it('recognizes one made here', () => {
        expect(isPluginError(new PluginError('expired').withCode('auth'))).toBe(true);
    });

    it('recognizes a subclass, which is what the constructor prototype fix-up buys', () => {
        class Subclass extends PluginError {}
        const error = new Subclass('slow down').withCode('rate_limited');

        expect(isPluginError(error)).toBe(true);
        expect(error).toBeInstanceOf(Subclass);
        expect(error).toBeInstanceOf(PluginError);
    });

    it('rejects a plain Error, a look-alike, and non-objects', () => {
        expect(isPluginError(new Error('plain'))).toBe(false);
        expect(isPluginError({ code: 'auth', retryable: false, message: 'look-alike' })).toBe(false);
        expect(isPluginError(undefined)).toBe(false);
        expect(isPluginError(null)).toBe(false);
        expect(isPluginError('auth')).toBe(false);
    });

    it('answers no for a foreign copy, which is toPluginError’s question and not this one', () => {
        // Host code downstream of the invoker is asking "did we build this",
        // and past that boundary the honest answer for a foreign object is no.
        expect(isPluginError(foreignCopy())).toBe(false);
    });
});

describe('toPluginError', () => {
    it('passes ours straight through, preserving the subclass', () => {
        class Subclass extends PluginError {}
        const original = new Subclass('slow down').withCode('rate_limited').withRetry(5_000);
        expect(toPluginError(original)).toBe(original);
    });

    it('classifies a bare Error as internal and keeps it as the cause', () => {
        const bare = new Error('boom');
        const converted = toPluginError(bare);

        expect(converted.code).toBe('internal');
        expect(converted.retryable).toBe(true);
        expect(converted.message).toBe('boom');
        expect(converted.cause).toBe(bare);
    });

    it('stringifies a non-Error throw', () => {
        expect(toPluginError('just a string').message).toBe('just a string');
        expect(toPluginError(42).code).toBe('internal');
    });

    it('honours the fallback code for an unclassified throw', () => {
        const converted = toPluginError(new Error('nope'), 'upstream');

        expect(converted.code).toBe('upstream');
        expect(converted.retryable).toBe(true);
    });

    it('adopts a foreign copy, which is the case instanceof cannot see', () => {
        const converted = toPluginError(foreignCopy({ retryAfterMs: 2_000, upstreamStatus: 401 }));

        expect(converted).toBeInstanceOf(PluginError);
        expect(converted.code).toBe('auth');
        expect(converted.message).toBe('from another copy');
        expect(converted.retryAfterMs).toBe(2_000);
        expect(converted.upstreamStatus).toBe(401);
    });

    it('rebuilds rather than adopts, so the foreign object is kept only as the cause', () => {
        const foreign = foreignCopy();
        const converted = toPluginError(foreign);

        expect(converted).not.toBe(foreign);
        expect(converted.cause).toBe(foreign);
    });

    it('degrades a code this copy does not know to the fallback instead of passing it on', () => {
        // The brand proves the shape, not that the other copy's vocabulary
        // matches ours. An invented code would otherwise reach the host's HTTP
        // mapping table and index it to undefined.
        const converted = toPluginError(foreignCopy({ code: 'invented_by_a_plugin' }), 'upstream');

        expect(converted.code).toBe('upstream');
        expect(converted.message).toBe('from another copy');
    });

    it('re-derives retryable from the code rather than trusting the one it was handed', () => {
        const converted = toPluginError(foreignCopy({ code: 'rate_limited', retryable: undefined }));

        expect(converted.code).toBe('rate_limited');
        expect(converted.retryable).toBe(true);
    });

    it('drops retry advice that is not a usable number, rather than emitting Retry-After: NaN', () => {
        const converted = toPluginError(foreignCopy({ code: 'rate_limited', retryAfterMs: 'soon', upstreamStatus: Number.NaN }));

        expect(converted.retryAfterMs).toBeUndefined();
        expect(converted.upstreamStatus).toBeUndefined();
    });

    it('is not fooled by an unbranded look-alike', () => {
        const converted = toPluginError({ code: 'auth', retryable: false, message: 'not branded' });

        expect(converted.code).toBe('internal');
    });
});
