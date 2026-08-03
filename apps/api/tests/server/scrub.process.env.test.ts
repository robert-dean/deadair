import { describe, expect, it } from 'vitest';

import { PRESERVED_ENV_KEYS, SCRUBBED_ENV_KEYS, scrubProcessEnv } from '../../src/server/scrub.process.env.js';

describe('scrubProcessEnv', () => {
    it('deletes a scrubbed key present in the input env and returns it', () => {
        const env = { DATABASE_PASSWORD: 'hunter2' } as unknown as NodeJS.ProcessEnv;

        const removed = scrubProcessEnv(env);

        expect(env.DATABASE_PASSWORD).toBeUndefined();
        expect(removed).toContain('DATABASE_PASSWORD');
    });

    it('lets the preserve list win even when NODE_ENV is added to the scrub list', () => {
        // Mutate the real SCRUBBED_ENV_KEYS array for the duration of this test, so the assertion
        // exercises the actual preserve-beats-scrub precedence in scrubProcessEnv rather than a
        // reimplementation of it. Restored in `finally` so no other test sees the mutation.
        const mutableScrubList = SCRUBBED_ENV_KEYS as string[];
        mutableScrubList.push('NODE_ENV');

        try {
            const env = { NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv;

            const removed = scrubProcessEnv(env);

            expect(env.NODE_ENV).toBe('production');
            expect(removed).not.toContain('NODE_ENV');
        } finally {
            mutableScrubList.pop();
        }
    });

    it('leaves a key untouched when it is in neither list', () => {
        const env = { SOME_OTHER_SETTING: 'keep-me' } as unknown as NodeJS.ProcessEnv;

        const removed = scrubProcessEnv(env);

        expect(env.SOME_OTHER_SETTING).toBe('keep-me');
        expect(removed).not.toContain('SOME_OTHER_SETTING');
    });

    it('produces no entry and throws nothing for a scrubbed key that is absent', () => {
        const env = {} as unknown as NodeJS.ProcessEnv;

        expect(() => {
            const removed = scrubProcessEnv(env);
            expect(removed).toEqual([]);
        }).not.toThrow();
    });

    it('never lets a preserved key be listed as scrubbed', () => {
        const preserved = new Set(PRESERVED_ENV_KEYS);
        const intersection = SCRUBBED_ENV_KEYS.filter(key => preserved.has(key));

        expect(intersection).toEqual([]);
    });
});
