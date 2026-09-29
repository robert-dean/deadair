import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import type { DateTime } from 'luxon';
import type { ProviderPlaylist } from '@deadair/plugin-sdk';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';

/** One source's playlists as the last complete walk read them. */
export interface ProviderPlaylistListing {
    pluginId: string;
    /** When the walk finished reading the list. */
    listedAt: DateTime;
    playlists: ProviderPlaylist[];
}

/**
 * One stored playlist as a `ProviderPlaylist`, or `undefined` for anything that is not one.
 *
 * What was stored came from a plugin through the sync, so it is the plugin's answer and nothing this
 * station checked. A row that has lost its id or its name cannot be listed or addressed and is
 * dropped; every optional field is carried only when it has the type the SDK says, because the page
 * reading this answers a contract that would refuse anything else.
 */
function toProviderPlaylist(value: unknown): ProviderPlaylist | undefined {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || row.id === '' || typeof row.name !== 'string' || row.name === '') return undefined;

    const playlist: ProviderPlaylist = { id: row.id, name: row.name };
    if (typeof row.description === 'string') playlist.description = row.description;
    if (typeof row.trackCount === 'number') playlist.trackCount = row.trackCount;
    if (typeof row.artworkUrl === 'string') playlist.artworkUrl = row.artworkUrl;
    if (Array.isArray(row.permissions)) {
        playlist.permissions = row.permissions.filter((permission): permission is 'read' | 'edit' => permission === 'read' || permission === 'edit');
    }
    if (row.madeByProvider === true) playlist.madeByProvider = true;
    return playlist;
}

/**
 * The last complete list of playlists each music source offered. See `0058_provider_playlist_listings.sql`.
 *
 * `CatalogSyncService` is the only writer, on a walk that read the whole list, and the Library page
 * reads it instead of asking every provider while an operator waits. Lives in the catalog module
 * beside {@link HiddenPlaylistsRepository} for the same reason that one does: the sync writes it and
 * `PlaylistsService` reads it, and `CatalogModule` registers before both.
 */
@Injectable()
export class ProviderPlaylistsRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /** Every source's stored listing, whichever plugins they belong to. */
    async list(): Promise<ProviderPlaylistListing[]> {
        const rows = await this.db
            .selectFrom('deadair.providerPlaylistListings')
            .select(['pluginId', 'listedAt', 'playlists'])
            .where('stationKey', '=', this.station.stationKey)
            .execute();

        return rows.map(row => ({
            pluginId: row.pluginId,
            listedAt: row.listedAt,
            playlists: Array.isArray(row.playlists) ? row.playlists.flatMap(one => toProviderPlaylist(one) ?? []) : [],
        }));
    }

    /**
     * Replace one source's listing with a list that was read to the end.
     *
     * The caller's half of the bargain is that `playlists` is complete: this replaces whatever was
     * stored, so a partial list written here would make every playlist it missed disappear from the
     * page until the next walk.
     */
    async put(pluginId: string, playlists: readonly ProviderPlaylist[]): Promise<void> {
        // Through the same reader as `list`, so what is kept is the SDK's fields and nothing else: a
        // plugin may hand back objects carrying more than the interface says.
        const stored = sql<string>`${JSON.stringify(playlists.flatMap(one => toProviderPlaylist(one) ?? []))}::jsonb`;
        await this.db
            .insertInto('deadair.providerPlaylistListings')
            .values({ stationKey: this.station.stationKey, pluginId, playlists: stored, listedAt: sql`now()` })
            .onConflict(conflict => conflict.columns(['stationKey', 'pluginId']).doUpdateSet({ playlists: stored, listedAt: sql`now()` }))
            .execute();
    }

    /** Forget one source's listing, for an account that is no longer the one it was read from. */
    async remove(pluginId: string): Promise<void> {
        await this.db
            .deleteFrom('deadair.providerPlaylistListings')
            .where('stationKey', '=', this.station.stationKey)
            .where('pluginId', '=', pluginId)
            .execute();
    }
}
