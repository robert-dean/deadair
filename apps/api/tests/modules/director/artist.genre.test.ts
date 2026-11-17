// The genre walk for a show's mix flow: a band no provider gave a genre is named one by the model,
// once, at the lowest priority, with the web search the only tool. The walk's switch is off, and the
// off case is the STRING a settings row holds. A provider's genre always wins over the model's.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { ARTIST_GENRE_VERSION, artistGenrePrompt, readArtistGenre } from '../../../src/modules/director/artist.genre.judge.js';
import { ArtistGenreJob } from '../../../src/modules/director/artist.genre.job.js';
import { ArtistGenreService } from '../../../src/modules/director/artist.genre.service.js';
import { MIX_FLOW_KEYS } from '../../../src/modules/director/mix.flow.keys.js';
import { settingsConfig } from '../../utils/settings.config.js';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

describe('readArtistGenre', () => {
    it('reads one genre in lower case, "could not place", or nothing for an answer that is neither', () => {
        expect(readArtistGenre('{"genre": "Black  Metal"}')).toBe('black metal');
        expect(readArtistGenre('{"unknown": true}')).toBe('unknown');
        expect(readArtistGenre('it is black metal')).toBeUndefined();
        expect(readArtistGenre('{"genre": ""}')).toBeUndefined();
    });

    it('names the band and a few of its records, and offers the search only where there is one', () => {
        const [, user] = artistGenrePrompt({ artist: 'Mayhem', titles: ['Freezing Moon'] }, false);
        expect(user!.content).toContain('The artist is Mayhem.');
        expect(user!.content).toContain('"Freezing Moon"');
        expect(user!.content).not.toContain('search');
    });
});

function service(answers: unknown[]) {
    const queue = [...answers];
    const judgements = {
        listArtistsNeedingGenre: vi.fn(async () => [{ artistId: 'a1', artist: 'Mayhem', titles: [] }]),
        save: vi.fn(async () => {}),
        recordFailure: vi.fn(async () => {}),
    };
    const llm = {
        converse: vi.fn(async () => {
            const next = queue.shift();
            if (next instanceof Error) throw next;
            return next;
        }),
    };
    const genres = new ArtistGenreService(
        judgements as never,
        llm as never,
        { hasSearch: () => false } as never,
        settingsConfig({}).config,
        logger(),
    );
    return { genres, judgements, llm };
}

describe('ArtistGenreService', () => {
    it('keeps the genre the model names, under the current instructions', async () => {
        const { genres, judgements } = service([{ text: '{"genre":"black metal"}', finishReason: 'stop' }]);
        expect(await genres.namePending(10)).toEqual({ named: 1, unplaced: 0, failed: 0, yielded: false });
        expect(judgements.save).toHaveBeenCalledWith('a1', 'black metal', ARTIST_GENRE_VERSION);
    });

    it('keeps "could not place" so the band is not asked again, and backs off a bad answer', async () => {
        const unplaced = service([{ text: '{"unknown":true}', finishReason: 'stop' }]);
        await unplaced.genres.namePending(10);
        expect(unplaced.judgements.save).toHaveBeenCalledWith('a1', undefined, ARTIST_GENRE_VERSION);

        const bad = service([{ text: 'no idea', finishReason: 'stop' }]);
        expect((await bad.genres.namePending(10)).failed).toBe(1);
        expect(bad.judgements.recordFailure).toHaveBeenCalledWith(
            'a1',
            'the answer was not a genre',
            ARTIST_GENRE_VERSION,
            expect.any(Number),
            expect.any(Number),
        );
    });

    it('stops the pass, marking nothing, when the model is busy', async () => {
        const { genres, judgements } = service([new Error('busy')]);
        expect((await genres.namePending(10)).yielded).toBe(true);
        expect(judgements.recordFailure).not.toHaveBeenCalled();
    });
});

describe('ArtistGenreJob', () => {
    const build = (rows: Record<string, string>) => {
        const namePending = vi.fn(async () => ({ named: 1, unplaced: 0, failed: 0, yielded: false }));
        const job = new ArtistGenreJob(
            { namePending } as never,
            { read: async () => ({ trackIds: ['next'], artistIds: [], albumIds: [] }) } as never,
            settingsConfig(rows).config,
            { id: 'job-1' } as never,
            { override: vi.fn() } as never,
            logger(),
        );
        return { job, namePending };
    };

    it('asks nothing with the switch unset or stored as the string false', async () => {
        for (const rows of [{}, { [MIX_FLOW_KEYS.artistGenres]: 'false' }] as Record<string, string>[]) {
            const { job, namePending } = build(rows);
            await job.run();
            expect(namePending).not.toHaveBeenCalled();
        }
    });

    it('walks, led by what the station is about to play, when it is on', async () => {
        const { job, namePending } = build({ [MIX_FLOW_KEYS.artistGenres]: 'true' });
        await job.run();
        expect(namePending).toHaveBeenCalledWith(20, expect.any(AbortSignal), ['next']);
    });
});
