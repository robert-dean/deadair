// Measured on the live station, 2026-10-11: The Boneyard's brief names twenty-four acts, every one of
// them in the library, and three refills searched only the top of the list. This is the list in the
// order the station needs it: whoever has been off air longest first.

import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { BriefArtists, orderByNeglect, type BriefArtist } from '../../../src/modules/director/brief.artists.js';
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

describe('orderByNeglect', () => {
    it("keeps the brief's own order between acts equally neglected", () => {
        const artists: BriefArtist[] = [
            { name: 'Sodom', artistKey: 'sodom' },
            { name: 'Kreator', artistKey: 'kreator' },
        ];

        expect(orderByNeglect(artists, 'Kreator, Sodom').map(artist => artist.name)).toEqual(['Kreator', 'Sodom']);
    });
});
