import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';
import { toJsonb } from '#modules/data/jsonb.js';

/** A station playlist's own row, with how many of its rows there are and how many can air. */
export interface StationPlaylistRow {
    id: string;
    name: string;
    prompt: string;
    originPluginId?: string;
    trackCount: number;
    resolvedCount: number;
    createdAt: DateTime;
    updatedAt: DateTime;
}

/** What a placeholder knows about the record it stands for, as `origin_snapshot` holds it. */
export interface PlaylistSnapshot {
    title: string;
    artists: string[];
    album?: string;
    durationMs?: number;
    isrc?: string;
}

/**
 * One row of a station playlist as it is read back.
 *
 * A resolved row describes itself from the CATALOG, which is the record the station will actually
 * play, and a placeholder from its snapshot, which is all anybody knows about it yet.
 */
export interface StationPlaylistRowTrack {
    id: string;
    position: number;
    trackId?: string;
    title: string;
    artists: string[];
    album?: string;
    durationMs?: number;
    isrc?: string;
    artistId?: string;
    albumId?: string;
    originPluginId?: string;
    originExternalId?: string;
}

/** A placeholder as a fill reads it: the copy it was cloned from, if any, and what it describes. */
export interface PlaylistPlaceholderRow {
    id: string;
    position: number;
    origin?: { pluginId: string; externalId: string };
    snapshot?: PlaylistSnapshot;
}

/** One row to write: a record the library holds, or a placeholder for one it does not. */
export type NewPlaylistRow =
    { trackId: string } | { trackId?: undefined; snapshot: PlaylistSnapshot; origin?: { pluginId: string; externalId: string } };

/**
 * The playlists the station owns, in `deadair.playlists` and `deadair.playlist_tracks`.
 *
 * Nothing here reaches a provider. A provider's playlist is read live by `PlaylistsService` and is
 * never a row in these tables; a row here is a clone that has since been free to differ (0005).
 */
@Injectable()
export class StationPlaylistsRepository extends DataRepository {
    /** Every station playlist, newest first. */
    async list(): Promise<StationPlaylistRow[]> {
        const rows = await this.summaries().orderBy('deadair.playlists.createdAt', 'desc').execute();
        return rows.map(toSummary);
    }

    /** One station playlist's own row, or `undefined` for an id this station does not hold. */
    async find(id: string): Promise<StationPlaylistRow | undefined> {
        const row = await this.summaries().where('deadair.playlists.id', '=', id).executeTakeFirst();
        return row === undefined ? undefined : toSummary(row);
    }

    /**
     * One playlist's rows in order.
     *
     * The artists come from `track_artists` in credit order, which is the list the resolver's own
     * keys are built from, so a file exported from here matches back onto the same records. A track
     * ingested before that table existed has no rows in it, and falls back to its credit string as
     * one name. The ISRC is whichever binding claims one first: there is no `tracks.isrc`, by design,
     * because providers disagree about it, so it is carried as a hint and matched as one.
     */
    async tracks(playlistId: string): Promise<StationPlaylistRowTrack[]> {
        const rows = await this.db
            .selectFrom('deadair.playlistTracks as pt')
            .leftJoin('deadair.tracks as t', 't.id', 'pt.trackId')
            .leftJoin('deadair.albums as al', 'al.id', 't.albumId')
            .select([
                'pt.id',
                'pt.position',
                'pt.trackId',
                'pt.originPluginId',
                'pt.originExternalId',
                'pt.originSnapshot',
                't.title',
                't.artists as credit',
                't.durationMs',
                't.artistId',
                't.albumId',
                'al.name as albumName',
            ])
            .select(eb => [
                eb
                    .selectFrom('deadair.trackArtists as ta')
                    .innerJoin('deadair.artists as a', 'a.id', 'ta.artistId')
                    .select(sql<string[]>`array_agg(a.name order by ta.position)`.as('names'))
                    .whereRef('ta.trackId', '=', 'pt.trackId')
                    .as('artistNames'),
                eb
                    .selectFrom('deadair.trackSources as ts')
                    .select('ts.isrc')
                    .whereRef('ts.trackId', '=', 'pt.trackId')
                    .where('ts.isrc', 'is not', null)
                    .orderBy('ts.createdAt', 'asc')
                    .limit(1)
                    .as('isrc'),
            ])
            .where('pt.playlistId', '=', playlistId)
            .orderBy('pt.position', 'asc')
            .execute();

        return rows.map((row): StationPlaylistRowTrack => {
            const origin =
                row.originPluginId == null || row.originExternalId == null
                    ? {}
                    : { originPluginId: row.originPluginId, originExternalId: row.originExternalId };

            if (row.trackId != null && row.title != null) {
                const artists = row.artistNames != null && row.artistNames.length > 0 ? row.artistNames : row.credit == null ? [] : [row.credit];
                return {
                    id: row.id,
                    position: row.position,
                    trackId: row.trackId,
                    title: row.title,
                    artists,
                    ...(row.albumName == null ? {} : { album: row.albumName }),
                    ...(row.durationMs == null ? {} : { durationMs: row.durationMs }),
                    ...(row.isrc == null ? {} : { isrc: row.isrc }),
                    ...(row.artistId == null ? {} : { artistId: row.artistId }),
                    ...(row.albumId == null ? {} : { albumId: row.albumId }),
                };
            }

            const snapshot = readSnapshot(row.originSnapshot);
            return {
                id: row.id,
                position: row.position,
                title: snapshot?.title ?? 'Unknown record',
                artists: snapshot?.artists ?? [],
                ...(snapshot?.album === undefined ? {} : { album: snapshot.album }),
                ...(snapshot?.durationMs === undefined ? {} : { durationMs: snapshot.durationMs }),
                ...(snapshot?.isrc === undefined ? {} : { isrc: snapshot.isrc }),
                ...origin,
            };
        });
    }

    /**
     * A new playlist and all of its rows, in the order given.
     *
     * Runs inside the request's transaction, so a failure part-way writes nothing: a playlist that
     * existed with half its rows would be an import nobody previewed.
     */
    async create(playlist: { name: string; prompt: string; originPluginId?: string }, rows: readonly NewPlaylistRow[]): Promise<string> {
        const { id } = await this.db
            .insertInto('deadair.playlists')
            .values({ name: playlist.name, prompt: playlist.prompt, originPluginId: playlist.originPluginId ?? null })
            .returning('id')
            .executeTakeFirstOrThrow();

        // Chunked so a thousand-row import is a handful of statements rather than one per row, and
        // well inside Postgres's limit on bound parameters per statement.
        const values = rows.map((row, position) =>
            row.trackId !== undefined
                ? { playlistId: id, position, trackId: row.trackId }
                : {
                      playlistId: id,
                      position,
                      originPluginId: row.origin?.pluginId ?? null,
                      originExternalId: row.origin?.externalId ?? null,
                      originSnapshot: toJsonb(row.snapshot),
                  },
        );
        for (let start = 0; start < values.length; start += 500) {
            await this.db
                .insertInto('deadair.playlistTracks')
                .values(values.slice(start, start + 500))
                .execute();
        }

        return id;
    }

    /**
     * One playlist's placeholders, in order: the rows a fill has something to do for.
     *
     * The snapshot is validated here, on {@link readSnapshot}'s terms, so a caller holds either a
     * description it can search by or nothing at all.
     */
    async placeholders(playlistId: string): Promise<PlaylistPlaceholderRow[]> {
        const rows = await this.db
            .selectFrom('deadair.playlistTracks')
            .select(['id', 'position', 'originPluginId', 'originExternalId', 'originSnapshot'])
            .where('playlistId', '=', playlistId)
            .where('trackId', 'is', null)
            .orderBy('position', 'asc')
            .execute();

        return rows.map(row => {
            const snapshot = readSnapshot(row.originSnapshot);
            return {
                id: row.id,
                position: row.position,
                ...(row.originPluginId == null || row.originExternalId == null
                    ? {}
                    : { origin: { pluginId: row.originPluginId, externalId: row.originExternalId } }),
                ...(snapshot === undefined ? {} : { snapshot }),
            };
        });
    }

    /** Rewrites the name or the prompt, whichever is given. */
    async update(id: string, changes: { name?: string; prompt?: string }): Promise<boolean> {
        if (changes.name === undefined && changes.prompt === undefined) return (await this.find(id)) !== undefined;

        const result = await this.db
            .updateTable('deadair.playlists')
            .set({
                ...(changes.name === undefined ? {} : { name: changes.name }),
                ...(changes.prompt === undefined ? {} : { prompt: changes.prompt }),
            })
            .where('id', '=', id)
            .executeTakeFirst();
        return Number(result.numUpdatedRows ?? 0) > 0;
    }

    /**
     * Deletes a playlist and its rows. The rows go first because the foreign key does not cascade,
     * and the records they named stay in the library: a playlist is a list of records, not an owner.
     */
    async delete(id: string): Promise<boolean> {
        await this.db.deleteFrom('deadair.playlistTracks').where('playlistId', '=', id).execute();
        const result = await this.db.deleteFrom('deadair.playlists').where('id', '=', id).executeTakeFirst();
        return Number(result.numDeletedRows ?? 0) > 0;
    }

    private summaries() {
        return this.db
            .selectFrom('deadair.playlists')
            .leftJoin('deadair.playlistTracks', 'deadair.playlistTracks.playlistId', 'deadair.playlists.id')
            .select([
                'deadair.playlists.id',
                'deadair.playlists.name',
                'deadair.playlists.prompt',
                'deadair.playlists.originPluginId',
                'deadair.playlists.createdAt',
                'deadair.playlists.updatedAt',
            ])
            .select(eb => [
                eb.fn.count<string>('deadair.playlistTracks.id').as('trackCount'),
                eb.fn.count<string>('deadair.playlistTracks.trackId').as('resolvedCount'),
            ])
            .groupBy('deadair.playlists.id');
    }
}

function toSummary(row: {
    id: string;
    name: string;
    prompt: string;
    originPluginId: string | null;
    createdAt: DateTime;
    updatedAt: DateTime;
    trackCount: string | number | bigint;
    resolvedCount: string | number | bigint;
}): StationPlaylistRow {
    return {
        id: row.id,
        name: row.name,
        prompt: row.prompt,
        ...(row.originPluginId == null ? {} : { originPluginId: row.originPluginId }),
        trackCount: Number(row.trackCount),
        resolvedCount: Number(row.resolvedCount),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

/**
 * `origin_snapshot` as a snapshot, or nothing.
 *
 * Validated rather than trusted, on `CatalogPlaceholderService`'s argument: the jsonb was written by
 * whichever importer existed at the time, and one malformed row must not fail a whole listing.
 */
export function readSnapshot(value: unknown): PlaylistSnapshot | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const row = value as Record<string, unknown>;
    if (typeof row.title !== 'string' || row.title.length === 0) return undefined;

    return {
        title: row.title,
        artists: Array.isArray(row.artists) ? row.artists.filter((one): one is string => typeof one === 'string' && one.length > 0) : [],
        ...(typeof row.album === 'string' && row.album.length > 0 ? { album: row.album } : {}),
        ...(typeof row.durationMs === 'number' && row.durationMs >= 0 ? { durationMs: row.durationMs } : {}),
        ...(typeof row.isrc === 'string' && row.isrc.length > 0 ? { isrc: row.isrc } : {}),
    };
}
