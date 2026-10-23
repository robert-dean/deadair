import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { AlbumsRepository } from './albums.repository.js';
import { AlbumsService } from './albums.service.js';
import { ArtistsRepository } from './artists.repository.js';
import { ArtistsService } from './artists.service.js';
import { withRating } from './rating.js';
import { TracksRepository } from './tracks.repository.js';
import { Track, type Album, type Artist, type SuspendInput } from './types/catalog.types.js';

/** The three things that can be suspended, as the feed names them. */
type Suspendable = 'artist' | 'album' | 'track';

/**
 * Keeping an artist, a release or a record off the station for a while, and ending that early.
 *
 * One service for the three, rather than a verb on each of the three catalog services, because what
 * the six verbs share is everything but the table: a write to `suspended_until`, a 404 for a row
 * that is not there, a line on the activity feed with the operator who asked, and the row read back
 * the way its own rating verb reads it back. What stops a suspended record airing is not here at all:
 * it is `catalog/suspension.ts`, beside the dislike in every read that keeps one off the air.
 *
 * Nothing already in the running order is taken out. A commit already made stands, as it does for a
 * dislike's rating verb on its own, and the two or three records in front of the operator are theirs
 * to remove.
 */
@Injectable()
export class SuspensionsService {
    constructor(
        private readonly artistsRepository: ArtistsRepository,
        private readonly artists: ArtistsService,
        private readonly albumsRepository: AlbumsRepository,
        private readonly albums: AlbumsService,
        private readonly tracksRepository: TracksRepository,
        private readonly context: AuthorizationContext,
        private readonly activity: ActivityRecorder,
    ) {}

    async suspendArtist(id: string, input: SuspendInput): Promise<Artist> {
        await this.write('artist', id, this.artistsRepository.setSuspension(id, input.days));
        const artist = await this.artists.getArtist(id);
        this.record('artist', id, artist.name, input.days);
        return artist;
    }

    async liftArtist(id: string): Promise<Artist> {
        const before = await this.artists.getArtist(id);
        await this.write('artist', id, this.artistsRepository.setSuspension(id, undefined));
        if (before.suspendedUntil !== undefined) this.record('artist', id, before.name, undefined);
        return await this.artists.getArtist(id);
    }

    async suspendAlbum(id: string, input: SuspendInput): Promise<Album> {
        await this.write('album', id, this.albumsRepository.setSuspension(id, input.days));
        const album = await this.albums.getAlbum(id);
        this.record('album', id, album.name, input.days);
        return album;
    }

    async liftAlbum(id: string): Promise<Album> {
        const before = await this.albums.getAlbum(id);
        await this.write('album', id, this.albumsRepository.setSuspension(id, undefined));
        if (before.suspendedUntil !== undefined) this.record('album', id, before.name, undefined);
        return await this.albums.getAlbum(id);
    }

    async suspendTrack(id: string, input: SuspendInput): Promise<Track> {
        await this.write('track', id, this.tracksRepository.setSuspension(id, input.days));
        const track = await this.readTrack(id);
        this.record('track', id, track.title, input.days);
        return track;
    }

    async liftTrack(id: string): Promise<Track> {
        const before = await this.readTrack(id);
        await this.write('track', id, this.tracksRepository.setSuspension(id, undefined));
        if (before.suspendedUntil !== undefined) this.record('track', id, before.title, undefined);
        return await this.readTrack(id);
    }

    /** The write, and the 404 for a row that was not there to change. */
    private async write(kind: Suspendable, id: string, written: Promise<boolean>): Promise<void> {
        if (!(await written)) throw httpError(404).withDetails({ message: `${kind} "${id}" is not in the catalog` });
    }

    /** A record read back as its rating verb reads it back: the `Track`, not the whole detail page. */
    private async readTrack(id: string): Promise<Track> {
        const row = await this.tracksRepository.findTrack(id);
        if (row === undefined) throw httpError(404).withDetails({ message: `track "${id}" is not in the catalog` });
        return await parseAndValidate(withRating(row), Track);
    }

    /**
     * One feed line per set and per lift. On the feed rather than in a column, because the reason an
     * operator kept something off is the kind of thing the feed already holds for every other action
     * that changes what airs, and a lapsed suspension is not a thing anybody queries.
     */
    private record(kind: Suspendable, id: string, name: string, days: number | undefined): void {
        const what = kind === 'album' ? 'release' : kind === 'track' ? 'record' : 'artist';
        const actorId = this.context.actor.kind === 'user' ? this.context.actor.actorId : undefined;
        void this.activity.record({
            module: 'catalog',
            kind: days === undefined ? 'suspension.lifted' : 'suspension.set',
            detail:
                days === undefined
                    ? `An operator ended the suspension on the ${what} ${name}, so the station may choose it again.`
                    : `An operator kept the ${what} ${name} off the station for ${days} ${days === 1 ? 'day' : 'days'}.`,
            data: { [`${kind}Id`]: id, ...(days === undefined ? {} : { days }) },
            ...(actorId === undefined ? {} : { actorId }),
        });
    }
}
