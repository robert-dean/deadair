// The six suspension verbs share everything but the table: a write, a 404 for a row that is not
// there, a feed line with the operator who asked, and the row read back. What keeps a suspended
// record off the air is not here at all; it is `catalog/suspension.ts`, tested with the reads.

import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';

import { SuspensionsService } from '../../../src/modules/catalog/suspensions.service.js';

const ARTIST_ID = '00000000-0000-4000-8000-0000000000a1';
const TRACK_ID = '00000000-0000-4000-8000-0000000000c1';
const OPERATOR = 'actor-1';
const LATER = DateTime.fromISO('2026-10-28T12:00:00.000Z');

function build(options: { found?: boolean; suspended?: boolean } = {}) {
    const found = options.found ?? true;
    let suspended = options.suspended ?? false;
    const setSuspension = vi.fn(async (_id: string, days: number | undefined) => {
        suspended = days !== undefined;
        return found;
    });
    const artist = () => ({ id: ARTIST_ID, name: 'Metallica', rating: 'liked' as const, ...(suspended ? { suspendedUntil: LATER } : {}) });
    const trackRow = () => ({
        id: TRACK_ID,
        title: 'One',
        artistId: ARTIST_ID,
        artists: 'Metallica',
        artistName: 'Metallica',
        rating: 1,
        ...(suspended ? { suspendedUntil: LATER } : {}),
    });
    const activity = { record: vi.fn(async (_event: Record<string, unknown>) => undefined) };
    const service = new SuspensionsService(
        { setSuspension } as never,
        { getArtist: vi.fn(async () => artist()) } as never,
        { setSuspension } as never,
        { getAlbum: vi.fn() } as never,
        { setSuspension, findTrack: vi.fn(async () => (found ? trackRow() : undefined)) } as never,
        { actor: { kind: 'user', actorId: OPERATOR } } as never,
        activity as never,
    );
    return { service, setSuspension, activity };
}

describe('SuspensionsService', () => {
    it('suspends an artist for the days asked, answers it re-read, and puts it on the feed', async () => {
        const { service, setSuspension, activity } = build();

        const artist = await service.suspendArtist(ARTIST_ID, { days: 5 });

        expect(setSuspension).toHaveBeenCalledWith(ARTIST_ID, 5);
        expect(artist.suspendedUntil).toBe(LATER);
        // The opinion is untouched, which is the whole point of a suspension.
        expect(artist.rating).toBe('liked');
        expect(activity.record).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'suspension.set', data: { artistId: ARTIST_ID, days: 5 }, actorId: OPERATOR }),
        );
        expect(vi.mocked(activity.record).mock.calls[0]![0]).toMatchObject({
            detail: expect.stringContaining('Metallica off the station for 5 days'),
        });
    });

    it('lifts a suspension, and says so only when there was one', async () => {
        const suspended = build({ suspended: true });
        expect((await suspended.service.liftArtist(ARTIST_ID)).suspendedUntil).toBeUndefined();
        expect(suspended.activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'suspension.lifted' }));

        const plain = build();
        await plain.service.liftArtist(ARTIST_ID);
        expect(plain.activity.record).not.toHaveBeenCalled();
    });

    it('suspends a record and answers the Track its rating verb would', async () => {
        const { service } = build();

        const track = await service.suspendTrack(TRACK_ID, { days: 2 });

        expect(track).toMatchObject({ id: TRACK_ID, title: 'One', rating: 'liked', suspendedUntil: LATER });
    });

    it('404s on a record that is not in the catalog, and records nothing', async () => {
        const { service, activity } = build({ found: false });

        await expect(service.suspendTrack(TRACK_ID, { days: 2 })).rejects.toMatchObject({ statusCode: 404 });
        expect(activity.record).not.toHaveBeenCalled();
    });
});
