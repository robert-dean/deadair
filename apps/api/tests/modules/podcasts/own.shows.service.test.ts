// A show the station makes is a saved recipe, and what is worth pinning is that an episode is asked for
// through the same path the Productions page uses, with the show's defaults applied and the episode
// filed under it; that its own topic beats the show's standing one; and that an episode with nothing to
// be about is refused rather than made about nothing in particular.

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';

import { episodeTitle, OwnShowsService } from '../../../src/modules/podcasts/own.shows.service.js';
import type { OwnShowRecord } from '../../../src/modules/podcasts/own.show.js';

const WIND_DOWN: OwnShowRecord = {
    id: 'show-1',
    title: 'Wind-down',
    subject: 'something calm and interesting to fall asleep to',
    personaId: 'persona-1',
    targetMs: 40 * 60_000,
    writingMode: 'outlined',
    createdAt: 0,
};

/** `none` for a station with no such show, since an absent argument is the default one. */
function build(given: OwnShowRecord | 'none' = WIND_DOWN) {
    const show = given === 'none' ? undefined : given;
    const shows = {
        find: vi.fn(async () => show),
        list: vi.fn(async () => (show === undefined ? [] : [show])),
        create: vi.fn(async (write: Omit<OwnShowRecord, 'id' | 'createdAt'>) => ({ ...write, id: 'show-2', createdAt: 0 })),
        update: vi.fn(async () => show),
        remove: vi.fn(async () => show !== undefined),
    };
    const commission = vi.fn(async () => ({ id: 'prod-1' }));
    const listForShow = vi.fn(async () => ({ productions: [] }));
    const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;

    const service = new OwnShowsService(shows as never, { commission, listForShow } as never, config);
    return { service, shows, commission, listForShow };
}

describe('OwnShowsService.requestEpisode', () => {
    it("asks for a production with the show's defaults, filed under the show", async () => {
        const { service, commission } = build();
        const airAt = DateTime.fromISO('2026-10-12T23:00:00Z');

        await service.requestEpisode('show-1', { airAt });

        expect(commission).toHaveBeenCalledWith(
            {
                kind: 'podcast',
                title: expect.stringMatching(/^Wind-down, /),
                brief: 'something calm and interesting to fall asleep to',
                personaId: 'persona-1',
                targetMs: 40 * 60_000,
                writingMode: 'outlined',
                scheduledFor: airAt,
            },
            { showId: 'show-1' },
        );
    });

    it("makes the episode's own topic its subject, and its title", async () => {
        const { service, commission } = build();

        await service.requestEpisode('show-1', { topic: 'lighthouses and the people who kept them' });

        expect(commission).toHaveBeenCalledWith(
            expect.objectContaining({
                brief: 'lighthouses and the people who kept them',
                title: 'Wind-down: lighthouses and the people who kept them',
            }),
            { showId: 'show-1' },
        );
    });

    it('hands pasted text over as a source to read, named if it was named', async () => {
        const { service, commission } = build();

        await service.requestEpisode('show-1', { text: '  The keeper lit the lamp at dusk.  ', sourceTitle: "A keeper's log" });
        await service.requestEpisode('show-1', { text: 'The keeper lit the lamp at dusk.' });

        expect(commission).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ sources: [{ title: "A keeper's log", text: 'The keeper lit the lamp at dusk.' }] }),
            { showId: 'show-1' },
        );
        expect(commission).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ sources: [{ title: 'Pasted text', text: 'The keeper lit the lamp at dusk.' }] }),
            {
                showId: 'show-1',
            },
        );
    });

    it('refuses an episode of a show with no subject when it is given nothing to be about', async () => {
        const { service, commission } = build({ id: 'show-3', title: 'Anything', createdAt: 0 });

        await expect(service.requestEpisode('show-3', {})).rejects.toMatchObject({ statusCode: 400 });
        expect(commission).not.toHaveBeenCalled();
    });

    it('says a show that does not exist does not', async () => {
        const { service } = build('none');

        await expect(service.requestEpisode('nope', { topic: 'anything' })).rejects.toMatchObject({ statusCode: 404 });
        await expect(service.episodes('nope')).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('OwnShowsService.create', () => {
    it('stores an empty box as nothing rather than as an empty string', async () => {
        const { service, shows } = build();

        await service.create({ title: '  News in depth ', description: '  ', subject: 'the day in depth' });

        expect(shows.create).toHaveBeenCalledWith({ title: 'News in depth', subject: 'the day in depth' });
    });
});

describe('episodeTitle', () => {
    it('names an episode with no topic after its show and the day', () => {
        expect(episodeTitle({ title: 'Wind-down' }, '', Date.UTC(2026, 9, 12, 22, 0), 'Europe/London')).toBe('Wind-down, Mon 12 Oct');
    });

    it('cuts a long topic short in the title', () => {
        const title = episodeTitle({ title: 'Wind-down' }, 'a'.repeat(400), 0, 'UTC');

        expect(title.length).toBeLessThan(140);
        expect(title.endsWith('…')).toBe(true);
    });
});
