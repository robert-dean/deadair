import { describe, expect, it } from 'vitest';

import { PLUGIN_ERROR_CODES, PluginError, isPluginError, toPluginError } from '../src/plugin.error.js';

/** A plugin bundled with its own copy of the SDK: same contract, different class identity. */
function foreignCopy(overrides: Record<string, unknown> = {}): unknown {
    return {
        deadairPluginError: 'deadair.plugin-error/v1',
        name: 'PluginError',
        message: 'from another copy',
        code: 'auth',
        retryable: false,
        ...overrides,
    };
}

describe('PluginError', () => {
    it('defaults retryable from the code', () => {
        expect(new PluginError('auth', 'expired').retryable).toBe(false);
        expect(new PluginError('config', 'no client id').retryable).toBe(false);
        expect(new PluginError('rate_limited', 'slow down').retryable).toBe(true);
        expect(new PluginError('upstream', 'bad gateway').retryable).toBe(true);
    });

    it('lets an explicit retryable override the default for the code', () => {
        expect(new PluginError('auth', 'expired', { retryable: true }).retryable).toBe(true);
        expect(new PluginError('upstream', 'permanently broken', { retryable: false }).retryable).toBe(false);
    });

    it('is a real Error, so an unaware catch still behaves', () => {
        const error = new PluginError('timeout', 'took too long');
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('took too long');
        expect(String(error)).toContain('took too long');
    });

    it('keeps the cause for logging', () => {
        const cause = new Error('socket hang up');
        expect(new PluginError('upstream', 'failed', { cause }).cause).toBe(cause);
    });

    it('leaves unset optional detail as undefined rather than null', () => {
        const error = new PluginError('internal', 'boom');
        expect(error.retryAfterMs).toBeUndefined();
        expect(error.upstreamStatus).toBeUndefined();
    });

    it('has a retryable default for every declared code', () => {
        for (const code of PLUGIN_ERROR_CODES) {
            expect(typeof new PluginError(code, 'x').retryable).toBe('boolean');
        }
    });
});

describe('isPluginError', () => {
    it('recognizes one made here', () => {
        expect(isPluginError(new PluginError('auth', 'expired'))).toBe(true);
    });

    it('recognizes one from a different copy of this module, which instanceof would miss', () => {
        const foreign = foreignCopy();
        expect(isPluginError(foreign)).toBe(true);
        expect(foreign instanceof PluginError).toBe(false);
    });

    it('rejects a plain Error, a look-alike without the brand, and non-objects', () => {
        expect(isPluginError(new Error('plain'))).toBe(false);
        expect(isPluginError({ code: 'auth', retryable: false, message: 'not branded' })).toBe(false);
        expect(isPluginError(undefined)).toBe(false);
        expect(isPluginError(null)).toBe(false);
        expect(isPluginError('auth')).toBe(false);
    });
});

describe('toPluginError', () => {
    it('passes ours straight through, preserving the subclass', () => {
        class Subclass extends PluginError {}
        const original = new Subclass('rate_limited', 'slow down', { retryAfterMs: 5_000 });
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
        expect(toPluginError(new Error('nope'), 'upstream').code).toBe('upstream');
    });

    it('adopts a foreign copy, carrying its classification over', () => {
        const converted = toPluginError(foreignCopy({ retryAfterMs: 2_000, upstreamStatus: 401 }));

        expect(converted).toBeInstanceOf(PluginError);
        expect(converted.code).toBe('auth');
        expect(converted.retryable).toBe(false);
        expect(converted.retryAfterMs).toBe(2_000);
        expect(converted.upstreamStatus).toBe(401);
    });

    it('degrades a code this copy does not know to the fallback instead of passing it on', () => {
        const converted = toPluginError(foreignCopy({ code: 'invented_by_a_plugin' }), 'upstream');

        expect(converted.code).toBe('upstream');
        expect(converted.message).toBe('from another copy');
    });

    it('re-derives retryable when a foreign copy did not supply one', () => {
        const converted = toPluginError(foreignCopy({ code: 'rate_limited', retryable: undefined }));

        expect(converted.code).toBe('rate_limited');
        expect(converted.retryable).toBe(true);
    });
});
