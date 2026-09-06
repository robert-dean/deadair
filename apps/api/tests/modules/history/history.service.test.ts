// The page boundary, which is the only decision this service makes. The extra row the repository
// answers with is proof there is more and is never itself sent: the cursor comes from the last row
// of THIS page, so the next request starts exactly where this one stopped. Getting that wrong is
// how a list either loses a record at every page boundary or repeats one.

import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { HistoryService } from '../../../src/modules/history/history.service.js';
import type { HistoryRepository } from '../../../src/modules/history/history.repository.js';
import type { HistoryRow } from '../../../src/modules/history/history.page.js';
import type { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const BASE = DateTime.fromISO('2026-09-06T21:00:00.000Z');

const rows = (count: number): HistoryRow[] =>
    Array.from({ length: count }, (_unused, index) => ({
        id: `row-${index}`,
        // Descending, as the query orders them: the last row of a page is the oldest on it.
        airedAt: BASE.minus({ minutes: index }),
        title: `Record ${index}`,
        artists: 'Somebody',
        album: null,
        artworkUrl: null,
        durationMs: null,
        trackId: null,
    }));

function serviceOver(answer: HistoryRow[], seen: { query?: unknown } = {}) {
    const repository = {
        page: async (query: unknown) => {
            seen.query = query;
            return answer;
        },
    } as unknown as HistoryRepository;

    return new HistoryService(repository, { stationKey: 'main' } as StationIdentity);
}

describe('HistoryService.readHistory', () => {
    it('reads a screenful when the client does not say', async () => {
        const seen: { query?: unknown } = {};
        await serviceOver(rows(0), seen).readHistory({});

        expect(seen.query).toMatchObject({ stationKey: 'main', limit: 50 });
    });

    it('scopes the read to this station', async () => {
        const seen: { query?: unknown } = {};
        await serviceOver(rows(0), seen).readHistory({ limit: 10 });

        expect(seen.query).toMatchObject({ stationKey: 'main', limit: 10 });
    });

    it('passes a cursor through untouched, and sends none when there is none', async () => {
        const withCursor: { query?: unknown } = {};
        await serviceOver(rows(0), withCursor).readHistory({ before: 'a-cursor' });
        expect(withCursor.query).toMatchObject({ before: 'a-cursor' });

        const without: { query?: unknown } = {};
        await serviceOver(rows(0), without).readHistory({});
        expect(without.query).not.toHaveProperty('before');
    });

    it('answers a full page with the cursor the next one starts at', async () => {
        // Ten asked for, eleven answered: the eleventh is proof and not content.
        const page = await serviceOver(rows(11)).readHistory({ limit: 10 });

        expect(page.entries).toHaveLength(10);
        expect(page.entries.at(-1)?.id).toBe('row-9');
        expect(page.nextBefore).toBe(`${BASE.minus({ minutes: 9 }).toISO()}|row-9`);
    });

    it('answers the end of the history without a cursor', async () => {
        const page = await serviceOver(rows(4)).readHistory({ limit: 10 });

        expect(page.entries).toHaveLength(4);
        expect(page.nextBefore).toBeUndefined();
    });

    it('answers an empty history without a cursor', async () => {
        const page = await serviceOver(rows(0)).readHistory({ limit: 10 });

        expect(page.entries).toEqual([]);
        expect(page.nextBefore).toBeUndefined();
    });

    it('answers a page that is exactly full without a cursor, there being nothing behind it', async () => {
        const page = await serviceOver(rows(10)).readHistory({ limit: 10 });

        expect(page.entries).toHaveLength(10);
        expect(page.nextBefore).toBeUndefined();
    });
});
