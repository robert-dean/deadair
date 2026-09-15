// The walk from one artist to records by the artists who sound like them. Two callers share it:
// the similar binding, seeding from what aired, and a playlist mixing in its neighbours, seeding from
// its own records. So what is asserted here is only what is true whatever the seed was.

import { describe, expect, it, vi } from 'vitest';
import type { ArtistTrack, SimilarArtist } from '@deadair/plugin-sdk';

import { SimilarPicker, type NeighbourWalk } from '../../../src/modules/director/similar.picker.js';
import type { SimilarityService } from '../../../src/modules/similarity/similarity.service.js';
import { artistKey, songKey } from '../../../src/modules/director/rotation.keys.js';
import type { TrackPick } from '../../../src/modules/director/set.generator.js';

interface Options {
    similar?: SimilarArtist[];
    /** Records per neighbour, by neighbour name. A neighbour missing here names one record of its own. */
    tracks?: Record<string, ArtistTrack[]>;
}

function build(options: Options = {}) {
    const similarTo = vi.fn(async (_ref: { name: string }, _limit: number): Promise<SimilarArtist[]> => options.similar ?? [{ name: 'Tricky' }]);
    const topTracks = vi.fn(
        async (ref: { name: string }, _limit: number): Promise<ArtistTrack[]> =>
            options.tracks?.[ref.name] ?? [{ title: `${ref.name} Song`, artist: ref.name }],
    );
    const similarity = { similarTo, topTracks } as unknown as SimilarityService;
    return { picker: new SimilarPicker(similarity), similarTo, topTracks };
}

const walk = (overrides: Partial<NeighbourWalk> = {}): NeighbourWalk => ({
    takenSongs: new Set<string>(),
    takenArtists: new Set<string>(),
    freshness: () => 1,
    ...overrides,
});

describe('SimilarPicker.pickFromNeighbours', () => {
    it('names one record per neighbour, best neighbour first, up to what was asked for', async () => {
        const { picker } = build({ similar: [{ name: 'Tricky' }, { name: 'Morcheeba' }, { name: 'Lamb' }] });

        const picks = await picker.pickFromNeighbours('Portishead', 2, walk());

        expect(picks).toEqual([
            { title: 'Tricky Song', artist: 'Tricky' },
            { title: 'Morcheeba Song', artist: 'Morcheeba' },
        ]);
    });

    it('stops asking upstream once it has what it wanted', async () => {
        const { picker, topTracks } = build({ similar: [{ name: 'Tricky' }, { name: 'Morcheeba' }, { name: 'Lamb' }] });

        await picker.pickFromNeighbours('Portishead', 1, walk());

        expect(topTracks).toHaveBeenCalledOnce();
    });

    it('asks nothing at all when it wants nothing', async () => {
        const { picker, similarTo } = build();

        expect(await picker.pickFromNeighbours('Portishead', 0, walk())).toEqual([]);
        expect(similarTo).not.toHaveBeenCalled();
    });

    it('carries what it took across seeds, so a second seed does not name the same neighbour again', async () => {
        // Both seeds have Tricky as their best neighbour. One walk shared between them is the
        // whole reason `NeighbourWalk` is mutated rather than returned.
        const { picker } = build({ similar: [{ name: 'Tricky' }, { name: 'Lamb' }] });
        const shared = walk();

        const first = await picker.pickFromNeighbours('Portishead', 1, shared);
        const second = await picker.pickFromNeighbours('Massive Attack', 1, shared);

        expect(first.map(pick => pick.artist)).toEqual(['Tricky']);
        expect(second.map(pick => pick.artist)).toEqual(['Lamb']);
        expect(shared.takenArtists.has(artistKey(['Tricky']))).toBe(true);
        expect(shared.takenSongs.has(songKey('Tricky Song', ['Tricky']))).toBe(true);
    });

    it('passes over a neighbour the caller has already given a record', async () => {
        const { picker, topTracks } = build({ similar: [{ name: 'Tricky' }, { name: 'Lamb' }] });

        const picks = await picker.pickFromNeighbours('Portishead', 1, walk({ takenArtists: new Set([artistKey(['Tricky'])]) }));

        expect(picks.map(pick => pick.artist)).toEqual(['Lamb']);
        expect(topTracks).toHaveBeenCalledOnce();
    });

    it('skips a song already taken and takes the next the source ranked', async () => {
        const { picker } = build({
            tracks: {
                Tricky: [
                    { title: 'Overcome', artist: 'Tricky' },
                    { title: 'Aftermath', artist: 'Tricky' },
                ],
            },
        });

        const picks = await picker.pickFromNeighbours('Portishead', 1, walk({ takenSongs: new Set([songKey('Overcome', ['Tricky'])]) }));

        expect(picks).toEqual([{ title: 'Aftermath', artist: 'Tricky' }]);
    });

    it("takes the freshest of a neighbour's records, ties going to the source's own order", async () => {
        const tracks = {
            Tricky: [
                { title: 'Karmacoma', artist: 'Tricky' },
                { title: 'Aftermath', artist: 'Tricky' },
                { title: 'Overcome', artist: 'Tricky' },
            ],
        };
        const stale = new Set([songKey('Karmacoma', ['Tricky'])]);

        const { picker } = build({ tracks });
        const leaned = await picker.pickFromNeighbours('Portishead', 1, walk({ freshness: song => (stale.has(song) ? 0.1 : 1) }));
        const level = await build({ tracks }).picker.pickFromNeighbours('Portishead', 1, walk());

        expect(leaned).toEqual([{ title: 'Aftermath', artist: 'Tricky' }]);
        expect(level).toEqual([{ title: 'Karmacoma', artist: 'Tricky' }]);
    });

    it('names only what falls inside the period, keeping a record with no year', async () => {
        const { picker } = build({
            similar: [{ name: 'Tricky' }, { name: 'Lamb' }],
            tracks: {
                Tricky: [{ title: 'Late', artist: 'Tricky', year: 1998 }],
                Lamb: [{ title: 'Undated', artist: 'Lamb' }],
            },
        });

        const picks = await picker.pickFromNeighbours('Portishead', 2, walk({ era: { from: 1970, to: 1979 } }));

        expect(picks).toEqual([{ title: 'Undated', artist: 'Lamb' }]);
    });

    it("appends to the caller's list as it goes, so a throw part way keeps what was found", async () => {
        const { picker, topTracks } = build({ similar: [{ name: 'Tricky' }, { name: 'Lamb' }] });
        topTracks.mockResolvedValueOnce([{ title: 'Overcome', artist: 'Tricky' }]).mockRejectedValueOnce(new Error('upstream went away'));
        const into: TrackPick[] = [];

        await expect(picker.pickFromNeighbours('Portishead', 2, walk(), into)).rejects.toThrow('upstream went away');
        expect(into).toEqual([{ title: 'Overcome', artist: 'Tricky' }]);
    });
});
