// The list a model chooses from. Pinned: the library's records and what the store holds are gathered
// per artist and deduplicated by song, each artist's freshest first; the resolver's screen decides
// what may be listed; the list spreads one record per artist per turn, acts before neighbours and up
// to each one's turns; and a list too short for the batch, or a read that fails, offers nothing.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { Logger } from '@maroonedsoftware/logger';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { drawFromShortlist, PER_ACT, PER_NEIGHBOUR, Shortlist, SHORTLIST_MAX, type ShortlistEntry } from '../../../src/modules/director/shortlist.js';
import type { BriefReach } from '../../../src/modules/director/brief.acts.js';
import type { CandidateTrack, CandidatesRepository } from '../../../src/modules/director/candidates.repository.js';
import type { PickResolver } from '../../../src/modules/director/pick.resolver.js';
import type { SetInputs } from '../../../src/modules/director/set.generator.js';
import type { SimilarityStoreRepository, StoredRecord } from '../../../src/modules/similarity/similarity.store.repository.js';
import { AiredRecords } from '../../../src/modules/shared/aired.records.js';
import { DEFAULT_RULES } from '../../../src/modules/director/rotation.rules.js';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;
const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;

const owned = (title: string, artist: string, trackId: string): CandidateTrack => ({ trackId, title, artist, credit: artist, rating: 0 });
const named = (title: string, artist: string): StoredRecord => ({ title, artist, source: 'deadair.lastfm' });

const REACH: BriefReach = {
    acts: [
        { name: 'Mayhem', artistKey: 'mayhem', inLibrary: false },
        { name: 'Slayer', artistKey: 'slayer', inLibrary: true },
    ],
    neighbours: [{ name: 'Watain', artistKey: 'watain', of: 'mayhem' }],
};

interface Options {
    library?: CandidateTrack[];
    stored?: Record<string, StoredRecord[]>;
    /** Titles the screen refuses. */
    refused?: string[];
    aired?: Record<string, number>;
    failing?: boolean;
}

function build(options: Options = {}) {
    const candidates = {
        byArtists: vi.fn(async () => {
            if (options.failing) throw new Error('the database is down');
            return options.library ?? [owned('Raining Blood', 'Slayer', 't1'), owned('South of Heaven', 'Slayer', 't2')];
        }),
    };
    const store = {
        recordsFor: vi.fn(
            async () =>
                new Map(
                    Object.entries(
                        options.stored ?? {
                            mayhem: [named('Freezing Moon', 'Mayhem'), named('Deathcrush', 'Mayhem')],
                            slayer: [named('Raining Blood', 'Slayer'), named('Angel of Death', 'Slayer')],
                            watain: [named('Malfeitor', 'Watain')],
                        },
                    ),
                ),
        ),
    };
    const screen = vi.fn(async (offered: ShortlistEntry[]) => offered.filter(entry => !(options.refused ?? []).includes(entry.title)));
    const aired = new AiredRecords();
    const now = DateTime.utc();
    aired.remember(new Map(Object.entries(options.aired ?? {}).map(([key, days]) => [key, now.minus({ days, hours: 1 })])), now);

    return {
        shortlist: new Shortlist(
            candidates as unknown as CandidatesRepository,
            store as unknown as SimilarityStoreRepository,
            { screen } as unknown as PickResolver,
            aired,
            config,
            stubLogger(),
        ),
        screen,
        candidates,
    };
}

const inputs = (count: number, overrides: Partial<SetInputs> = {}): SetInputs => ({ count, rules: DEFAULT_RULES, ...overrides });

describe('Shortlist', () => {
    it('spreads one record per artist per turn, acts first, the library before what only a source named', async () => {
        const { shortlist } = build();

        const list = await shortlist.build(inputs(3), REACH);

        expect(list?.map(entry => `${entry.artist}: ${entry.title}`)).toEqual([
            'Mayhem: Freezing Moon',
            'Slayer: Raining Blood',
            'Watain: Malfeitor',
            'Mayhem: Deathcrush',
            'Slayer: South of Heaven',
            'Slayer: Angel of Death',
        ]);
        // The library's copy of a song a source also named is the one listed, with its catalog id.
        expect(list?.find(entry => entry.title === 'Raining Blood')?.trackId).toBe('t1');
        expect(list?.find(entry => entry.artist === 'Watain')?.like).toBe('Mayhem');
    });

    it('lists only what the screen lets through, and hands it the refill’s own windows', async () => {
        const { shortlist, screen } = build({ refused: ['Freezing Moon', 'Raining Blood'] });
        const avoidSongKeys = new Set(['ghost:ritual']);

        const list = await shortlist.build(inputs(2, { avoidSongKeys }), REACH);

        expect(list?.map(entry => entry.title)).toEqual(['Deathcrush', 'South of Heaven', 'Malfeitor', 'Angel of Death']);
        expect(screen).toHaveBeenCalledWith(expect.any(Array), DEFAULT_RULES, expect.objectContaining({ want: 2, avoidSongKeys }));
    });

    it('puts an artist’s never-aired records first, then the longest off air', async () => {
        const { shortlist } = build({ aired: { 'slayer:raining blood': 1, 'slayer:south of heaven': 20 } });

        const list = await shortlist.build(inputs(1), { acts: [REACH.acts[1]!], neighbours: [] });

        expect(list?.map(entry => [entry.title, entry.airedDaysAgo])).toEqual([
            ['Angel of Death', undefined],
            ['South of Heaven', 20],
            ['Raining Blood', 1],
        ]);
    });

    it('gives an act and a neighbour their own number of turns, and stops at the most it shows', async () => {
        const many = (artist: string, count: number) => Array.from({ length: count }, (_, index) => named(`${artist} ${index}`, artist));
        const acts = Array.from({ length: 20 }, (_, index) => ({ name: `Act ${index}`, artistKey: `act ${index}`, inLibrary: false }));
        const stored = Object.fromEntries([...acts.map(act => [act.artistKey, many(act.name, 10)]), ['near', many('Near', 10)]]);
        const { shortlist } = build({ library: [], stored });

        const few = await shortlist.build(inputs(1), { acts: acts.slice(0, 1), neighbours: [{ name: 'Near', artistKey: 'near', of: 'act 0' }] });
        const lots = await shortlist.build(inputs(1), { acts, neighbours: [] });

        expect(few?.filter(entry => entry.artist === 'Act 0')).toHaveLength(PER_ACT);
        expect(few?.filter(entry => entry.artist === 'Near')).toHaveLength(PER_NEIGHBOUR);
        expect(lots).toHaveLength(SHORTLIST_MAX);
    });

    it('offers nothing when the list would be shorter than the batch', async () => {
        const { shortlist } = build();

        expect(await shortlist.build(inputs(7), REACH)).toBeUndefined();
    });

    it('offers nothing for a brief that reaches nobody, without reading anything', async () => {
        const { shortlist, candidates } = build();

        expect(await shortlist.build(inputs(1), { acts: [], neighbours: [] })).toBeUndefined();
        expect(candidates.byArtists).not.toHaveBeenCalled();
    });

    it('offers nothing when a read fails, so the model searches as before', async () => {
        const { shortlist } = build({ failing: true });

        expect(await shortlist.build(inputs(1), REACH)).toBeUndefined();
    });
});

describe('drawFromShortlist', () => {
    const LIST: ShortlistEntry[] = [
        { title: 'One', artist: 'Slayer', trackId: 't1', airedDaysAgo: 1 },
        { title: 'Two', artist: 'Slayer', trackId: 't2' },
        { title: 'Three', artist: 'Slayer' },
        { title: 'Four', artist: 'Mayhem' },
        { title: 'Five', artist: 'Watain', like: 'Mayhem' },
    ];

    it('draws each record once, carrying the catalog id, and no more by one artist than the cap', () => {
        const drawn = drawFromShortlist(LIST, 5, 2, () => 0);

        expect(drawn).toHaveLength(4);
        expect(drawn.filter(pick => pick.artist === 'Slayer')).toHaveLength(2);
        expect(drawn[0]).toEqual({ title: 'One', artist: 'Slayer', trackId: 't1' });
        expect(new Set(drawn.map(pick => pick.title)).size).toBe(4);
    });

    it('draws everything with no cap', () => {
        expect(drawFromShortlist(LIST, 10, 0, () => 0.5)).toHaveLength(5);
    });

    it('weighs a record aired lately and a neighbour below a fresh act', () => {
        // Weights: One 0.25 (aired a day ago, floored), Two 1, Three 1, Four 1, Five 0.5. Total 3.75.
        // A draw just under 0.25 of the total lands on One; just past it, on Two.
        expect(drawFromShortlist(LIST, 1, 0, () => 0.24 / 3.75)[0]?.title).toBe('One');
        expect(drawFromShortlist(LIST, 1, 0, () => 0.26 / 3.75)[0]?.title).toBe('Two');
        expect(drawFromShortlist(LIST, 1, 0, () => 3.3 / 3.75)[0]?.title).toBe('Five');
    });
});
