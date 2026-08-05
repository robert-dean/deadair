// The resolver's SQL is exercised end to end against a real database; what is
// worth testing in isolation is the two places it makes a decision rather than
// a query.
//
// `chooseTrackCandidate` is the judgement call in the whole ingest path: same
// artist, same normalized title, several rows, and only a duration to go on.
// Getting it wrong attaches one recording's provider bindings to another, and
// getting it *unstably* wrong is worse — the same item would drift between
// duplicates run to run, scattering the bindings that make a track playable.
//
// `markMissingTrackSources` is tested for the one input that is catastrophic
// rather than merely wrong: an empty seen-set, where `<> all('{}')` would sweep
// a plugin's entire catalog.

import { describe, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import type { Logger } from '@maroonedsoftware/logger';

import { CatalogResolverRepository, chooseTrackCandidate } from '../../../src/modules/music/catalog.resolver.repository.js';
import type { DB } from '../../../src/modules/data/db.js';

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

/** A `Kysely` that fails the test if the repository touches it at all. */
const untouchableDb = (): Kysely<DB> =>
    new Proxy(
        {},
        {
            get(_target, property) {
                throw new Error(`the database was queried (.${String(property)}) when it should not have been`);
            },
        },
    ) as Kysely<DB>;

describe('chooseTrackCandidate', () => {
    it('returns nothing when there is nothing to choose from', () => {
        expect(chooseTrackCandidate([], 180_000)).toBeUndefined();
    });

    it('takes the only candidate without consulting duration', () => {
        // Reported as `only` rather than `duration`, so the caller can stay
        // quiet about a resolution that involved no judgement.
        expect(chooseTrackCandidate([{ id: 'a', durationMs: 999 }], 180_000)).toEqual({ id: 'a', by: 'only' });
    });

    it('prefers the closest duration within tolerance', () => {
        const candidates = [
            { id: 'album-version', durationMs: 245_000 },
            { id: 'radio-edit', durationMs: 180_000 },
        ];
        expect(chooseTrackCandidate(candidates, 181_000)).toEqual({ id: 'radio-edit', by: 'duration' });
    });

    it('ignores candidates outside the 3s tolerance and falls back to the oldest', () => {
        // A radio edit is not its album version, however alone it is in the list.
        const candidates = [
            { id: 'oldest', durationMs: 245_000 },
            { id: 'newer', durationMs: 300_000 },
        ];
        expect(chooseTrackCandidate(candidates, 180_000)).toEqual({ id: 'oldest', by: 'age' });
    });

    it('accepts a difference exactly at the tolerance boundary', () => {
        const candidates = [
            { id: 'oldest', durationMs: 300_000 },
            { id: 'trimmed-fade', durationMs: 183_000 },
        ];
        expect(chooseTrackCandidate(candidates, 180_000)).toEqual({ id: 'trimmed-fade', by: 'duration' });
    });

    it('keeps the older row when two candidates are equally close', () => {
        // Stability is the point: an arbitrary-but-consistent answer beats one
        // that depends on sort order, because the next run must reach the same row.
        const candidates = [
            { id: 'older', durationMs: 179_000 },
            { id: 'newer', durationMs: 181_000 },
        ];
        expect(chooseTrackCandidate(candidates, 180_000)).toEqual({ id: 'older', by: 'duration' });
    });

    it('falls back to the oldest when the provider gave no duration', () => {
        const candidates = [
            { id: 'older', durationMs: 180_000 },
            { id: 'newer', durationMs: 245_000 },
        ];
        expect(chooseTrackCandidate(candidates, undefined)).toEqual({ id: 'older', by: 'age' });
    });

    it('skips candidates with no recorded duration rather than treating them as zero', () => {
        const candidates = [
            { id: 'unknown-length', durationMs: null },
            { id: 'known-length', durationMs: 180_500 },
        ];
        expect(chooseTrackCandidate(candidates, 180_000)).toEqual({ id: 'known-length', by: 'duration' });
    });

    it('falls back to the oldest when every candidate has no duration', () => {
        const candidates = [
            { id: 'older', durationMs: null },
            { id: 'newer', durationMs: null },
        ];
        expect(chooseTrackCandidate(candidates, 180_000)).toEqual({ id: 'older', by: 'age' });
    });
});

describe('markMissingTrackSources', () => {
    it('refuses an empty seen-set instead of sweeping the whole plugin', async () => {
        const logger = stubLogger();
        const repository = new CatalogResolverRepository(untouchableDb(), logger);

        await expect(repository.markMissingTrackSources('deadair.spotify', [])).resolves.toBe(0);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no tracks'), { plugin: 'deadair.spotify' });
    });
});
