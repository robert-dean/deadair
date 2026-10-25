// Who a brief reaches past the library, and how much asking that costs. Pinned: an act the library
// lacks is found among a library act's neighbours only when the brief names it and does not rule it
// out; the neighbours kept are the closest few that are not acts; the store is filled acts first and
// never past the cap; and every failure answers with the library's acts as before.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { Logger } from '@maroonedsoftware/logger';

import { BriefActs, MAX_ASKS_PER_RUN, NEIGHBOURS_ASKED, RECORDS_PER_ACT, RECORDS_PER_NEIGHBOUR } from '../../../src/modules/director/brief.acts.js';
import type { BriefArtist, BriefArtists } from '../../../src/modules/director/brief.artists.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import type { SimilarityService } from '../../../src/modules/similarity/similarity.service.js';
import type { SimilarityStoreRepository, StoredNeighbour } from '../../../src/modules/similarity/similarity.store.repository.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const BRIEF = 'Black metal: Mayhem, Darkthrone, Emperor, Bathory, Behemoth. No Burzum.';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const neighbour = (name: string): StoredNeighbour => ({ name, source: 'deadair.lastfm' });

interface Options {
    library?: BriefArtist[];
    neighbours?: Record<string, StoredNeighbour[]>;
    /** Artists whose answer is already stored, per kind. */
    stored?: { artists?: string[]; records?: string[] };
    similarity?: boolean;
    failingStore?: boolean;
}

function build(options: Options = {}) {
    const library = options.library ?? [
        { name: 'Bathory', artistKey: 'bathory' },
        { name: 'Behemoth', artistKey: 'behemoth', lastAiredAt: DateTime.utc().minus({ hours: 2 }) },
    ];
    const briefArtists = { named: vi.fn(async () => library) };
    const similarity = {
        hasSimilarity: () => options.similarity ?? true,
        similarTo: vi.fn(async () => []),
        topTracks: vi.fn(async () => []),
    };
    const neighbours = options.neighbours ?? {
        behemoth: [
            neighbour('Mayhem'),
            neighbour('Burzum'),
            neighbour('Watain'),
            neighbour('Bathory'),
            neighbour('Marduk'),
            neighbour('Gorgoroth'),
            neighbour('Dark Funeral'),
        ],
        bathory: [neighbour('Emperor'), neighbour('Darkthrone'), neighbour('Venom')],
    };
    const fail = async (): Promise<never> => {
        throw new Error('the database is down');
    };
    const store = {
        askedWithin: options.failingStore
            ? vi.fn(fail)
            : vi.fn(
                  async (kind: 'artists' | 'records', keys: readonly string[]) =>
                      new Set(keys.filter(key => (options.stored?.[kind] ?? []).includes(key))),
              ),
        neighboursFor: vi.fn(
            async (keys: readonly string[]) => new Map(keys.filter(key => neighbours[key] !== undefined).map(key => [key, neighbours[key]!])),
        ),
    };
    const history = { lastAiredByArtist: vi.fn(async () => new Map([['darkthrone', DateTime.utc().minus({ days: 1 })]])) };

    return {
        acts: new BriefActs(
            briefArtists as unknown as BriefArtists,
            similarity as unknown as SimilarityService,
            store as unknown as SimilarityStoreRepository,
            history as unknown as PlayHistoryRepository,
            new StationIdentity(),
            stubLogger(),
        ),
        similarity,
        store,
    };
}

describe('BriefActs', () => {
    it('finds the acts the library lacks among the neighbours, and leaves out the one the brief rules out', async () => {
        const { acts } = build();

        const reach = await acts.reach(BRIEF);

        // Never aired first, in the brief's own order; then by how long ago.
        expect(reach.acts.map(act => [act.name, act.inLibrary])).toEqual([
            ['Mayhem', false],
            ['Emperor', false],
            ['Bathory', true],
            ['Darkthrone', false],
            ['Behemoth', true],
        ]);
        expect(reach.acts.map(act => act.name)).not.toContain('Burzum');
    });

    it('keeps the closest few neighbours of each act that are not acts themselves, and never one the brief rules out', async () => {
        const { acts } = build();

        const reach = await acts.reach(BRIEF);

        expect(reach.neighbours.map(entry => [entry.name, entry.of])).toEqual([
            ['Venom', 'bathory'],
            ['Watain', 'behemoth'],
            ['Marduk', 'behemoth'],
            ['Gorgoroth', 'behemoth'],
        ]);
    });

    it('asks who resembles each library act only when that is not stored, and then fills records acts first', async () => {
        const { acts, similarity } = build({ stored: { artists: ['bathory'], records: ['behemoth'] } });

        await acts.reach(BRIEF);

        expect(similarity.similarTo.mock.calls).toEqual([[{ name: 'Behemoth' }, NEIGHBOURS_ASKED]]);
        expect(similarity.topTracks.mock.calls).toEqual([
            [{ name: 'Mayhem' }, RECORDS_PER_ACT],
            [{ name: 'Emperor' }, RECORDS_PER_ACT],
            [{ name: 'Bathory' }, RECORDS_PER_ACT],
            [{ name: 'Darkthrone' }, RECORDS_PER_ACT],
            [{ name: 'Venom' }, RECORDS_PER_NEIGHBOUR],
            [{ name: 'Watain' }, RECORDS_PER_NEIGHBOUR],
            [{ name: 'Marduk' }, RECORDS_PER_NEIGHBOUR],
            [{ name: 'Gorgoroth' }, RECORDS_PER_NEIGHBOUR],
        ]);
    });

    it('never asks more than its cap in one call', async () => {
        const library = Array.from({ length: 30 }, (_, index) => ({ name: `Act ${index}`, artistKey: `act ${index}` }));
        const { acts, similarity } = build({ library, neighbours: {} });

        await acts.reach(library.map(act => act.name).join(', '));

        expect(similarity.similarTo.mock.calls.length + similarity.topTracks.mock.calls.length).toBe(MAX_ASKS_PER_RUN);
    });

    it('asks nothing for a refill that has been stopped', async () => {
        const { acts, similarity } = build();
        const stopped = new AbortController();
        stopped.abort();

        await acts.reach(BRIEF, stopped.signal);

        expect(similarity.similarTo).not.toHaveBeenCalled();
        expect(similarity.topTracks).not.toHaveBeenCalled();
    });

    it("answers with the library's acts alone when nothing can say who sounds alike", async () => {
        const { acts, store } = build({ similarity: false });

        const reach = await acts.reach(BRIEF);

        expect(reach).toEqual({
            acts: [expect.objectContaining({ name: 'Bathory', inLibrary: true }), expect.objectContaining({ name: 'Behemoth', inLibrary: true })],
            neighbours: [],
        });
        expect(store.askedWithin).not.toHaveBeenCalled();
    });

    it("answers with the library's acts alone when the store cannot be read", async () => {
        const { acts } = build({ failingStore: true });

        const reach = await acts.reach(BRIEF);

        expect(reach.acts.map(act => act.name)).toEqual(['Bathory', 'Behemoth']);
        expect(reach.neighbours).toEqual([]);
    });

    it('answers with nobody for a brief that names no act the library holds', async () => {
        const { acts, store } = build({ library: [] });

        expect(await acts.reach('Loud and fast')).toEqual({ acts: [], neighbours: [] });
        expect(store.askedWithin).not.toHaveBeenCalled();
    });
});
