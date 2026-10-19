// Measured on the live station, 2026-10-11: The Boneyard's brief names twenty-four acts, every one of
// them in the library, and three refills searched only the top of the list. This is the list in the
// order the station needs it: whoever has been off air longest first.

import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { BriefArtists, excludedByBrief, orderByNeglect, type BriefArtist } from '../../../src/modules/director/brief.artists.js';
import type { ArtistsRepository } from '../../../src/modules/catalog/artists.repository.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as Logger;
const now = DateTime.utc();

function build(found: { name: string; artistKey: string }[], lastAired: Map<string, DateTime>, fails = false) {
    const namedIn = vi.fn(async () => {
        if (fails) throw new Error('the database went away');
        return found;
    });
    const lastAiredByArtist = vi.fn(async () => lastAired);
    return {
        briefArtists: new BriefArtists(
            { namedIn } as unknown as ArtistsRepository,
            { lastAiredByArtist } as unknown as PlayHistoryRepository,
            new StationIdentity(),
            logger,
        ),
        namedIn,
        lastAiredByArtist,
    };
}

describe('BriefArtists.named', () => {
    const brief = 'The classics: Black Sabbath, Judas Priest. Thrash: Metallica, Kreator, Sodom.';
    const found = [
        { name: 'Black Sabbath', artistKey: 'black sabbath' },
        { name: 'Judas Priest', artistKey: 'judas priest' },
        { name: 'Metallica', artistKey: 'metallica' },
        { name: 'Kreator', artistKey: 'kreator' },
        { name: 'Sodom', artistKey: 'sodom' },
    ];

    it('puts the acts with no airing first, then the oldest airing, whatever order the brief named them in', async () => {
        const { briefArtists } = build(
            found,
            new Map([
                ['black sabbath', now.minus({ hours: 1 })],
                ['judas priest', now.minus({ hours: 2 })],
                ['metallica', now.minus({ minutes: 10 })],
                ['kreator', now.minus({ days: 30 })],
            ]),
        );

        const named = await briefArtists.named(brief);

        expect(named.map(artist => artist.name)).toEqual(['Sodom', 'Kreator', 'Judas Priest', 'Black Sabbath', 'Metallica']);
        expect(named[0]!.lastAiredAt).toBeUndefined();
    });

    it('reads the history once, for the acts found, on this station', async () => {
        const { briefArtists, lastAiredByArtist } = build(found, new Map());

        await briefArtists.named(brief);

        expect(lastAiredByArtist).toHaveBeenCalledWith(['black sabbath', 'judas priest', 'metallica', 'kreator', 'sodom'], 'main');
    });

    it('asks nothing of a brief that is empty, and nothing of the history when the brief names nobody', async () => {
        const empty = build(found, new Map());
        expect(await empty.briefArtists.named('   ')).toEqual([]);
        expect(empty.namedIn).not.toHaveBeenCalled();

        const nobody = build([], new Map());
        expect(await nobody.briefArtists.named('loud and fast')).toEqual([]);
        expect(nobody.lastAiredByArtist).not.toHaveBeenCalled();
    });

    it('answers nothing rather than throwing when the library cannot be read', async () => {
        const { briefArtists } = build(found, new Map(), true);

        await expect(briefArtists.named(brief)).resolves.toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/programming without them/));
    });
});

describe('BriefArtists.named, over a brief that rules acts out', () => {
    it('does not lead with an act the brief names only to rule out', async () => {
        const { briefArtists, lastAiredByArtist } = build(
            [
                { name: 'Blur', artistKey: 'blur' },
                { name: 'Oasis', artistKey: 'oasis' },
                { name: 'Pulp', artistKey: 'pulp' },
            ],
            new Map(),
        );

        const named = await briefArtists.named('Britpop: Blur and Pulp, but no Oasis.');

        expect(named.map(artist => artist.name)).toEqual(['Blur', 'Pulp']);
        expect(lastAiredByArtist).toHaveBeenCalledWith(['blur', 'pulp'], expect.any(String));
    });

    it('asks nothing of the history when the brief rules out every act it names', async () => {
        const { briefArtists, lastAiredByArtist } = build([{ name: 'Metallica', artistKey: 'metallica' }], new Map());

        expect(await briefArtists.named('Thrash, anything but Metallica.')).toEqual([]);
        expect(lastAiredByArtist).not.toHaveBeenCalled();
    });
});

// The brief is prose the model reads for itself; what is pinned here is only which of the library's
// acts the station LEADS with. Several of these are the live station's own briefs, as written.
describe('excludedByBrief', () => {
    const excluded = (brief: string, names: string[]) => [...excludedByBrief(brief, names)].sort();

    it('rules out an act after a negating word, to the end of its sentence', () => {
        expect(excluded('Britpop, but no Oasis. Blur all day.', ['Oasis', 'Blur'])).toEqual(['Oasis']);
        expect(excluded('Thrash, anything except Metallica', ['Metallica'])).toEqual(['Metallica']);
        expect(excluded('Hair metal without Poison; Ratt is fine.', ['Poison', 'Ratt'])).toEqual(['Poison']);
        expect(excluded('Rock. Never Nickelback, never Creed.', ['Nickelback', 'Creed'])).toEqual(['Creed', 'Nickelback']);
        expect(excluded('Neither Oasis nor Blur tonight', ['Oasis', 'Blur'])).toEqual(['Blur', 'Oasis']);
    });

    it('rules out every act in a negated list, and none after a colon opens the wanted one', () => {
        expect(excluded('Jazz. No Kenny G, Spyro Gyra or Yellowjackets.', ['Kenny G', 'Spyro Gyra', 'Yellowjackets'])).toEqual([
            'Kenny G',
            'Spyro Gyra',
            'Yellowjackets',
        ]);
        expect(
            excluded('Bluegrass and banjo music, not country and western: Bill Monroe, Flatt & Scruggs, The Stanley Brothers.', [
                'Bill Monroe',
                'Flatt & Scruggs',
                'The Stanley Brothers',
            ]),
        ).toEqual([]);
        expect(excluded('Avoid: Oasis, Blur. Pulp instead.', ['Oasis', 'Blur', 'Pulp'])).toEqual(['Blur', 'Oasis']);
    });

    it('lets a "but" turn back to what is wanted', () => {
        expect(excluded('Heart Of Glass is not it, but Heart, Boston and Journey are', ['Heart', 'Boston', 'Journey'])).toEqual([]);
        expect(excluded('No ballads but plenty of Whitesnake', ['Whitesnake'])).toEqual([]);
    });

    it('does not read "not only" as ruling anything out', () => {
        expect(excluded('Not only Queen but Bowie too', ['Queen', 'Bowie'])).toEqual([]);
    });

    it('does not read a negating word inside a name as one', () => {
        const brief = 'Nineties alternative: Blink-182, Weezer, Third Eye Blind, No Doubt, Garbage.';

        expect(excluded(brief, ['Weezer', 'No Doubt', 'Garbage'])).toEqual([]);
        expect(excluded('College rock: R.E.M. and The Smiths, no Pixies.', ['R.E.M.', 'The Smiths', 'Pixies'])).toEqual(['Pixies']);
        expect(excluded('No R.E.M., The Smiths or Pixies.', ['R.E.M.', 'The Smiths', 'Pixies'])).toEqual(['Pixies', 'R.E.M.', 'The Smiths']);
    });

    it('keeps an act the brief also asks for outside the negated stretch', () => {
        expect(excluded('Queen all night, but not Queen ballads.', ['Queen'])).toEqual([]);
    });

    it('leaves alone the negations the live briefs make about genres', () => {
        const brief =
            'Rock and hard rock from the seventies on: Queen, Led Zeppelin, AC/DC. No pop, no heavy metal. Keep the energy up, no long ambient stretches.';

        expect(excluded(brief, ['Queen', 'Led Zeppelin', 'AC/DC'])).toEqual([]);
    });
});

describe('orderByNeglect', () => {
    it("keeps the brief's own order between acts equally neglected", () => {
        const artists: BriefArtist[] = [
            { name: 'Sodom', artistKey: 'sodom' },
            { name: 'Kreator', artistKey: 'kreator' },
        ];

        expect(orderByNeglect(artists, 'Kreator, Sodom').map(artist => artist.name)).toEqual(['Kreator', 'Sodom']);
    });
});
