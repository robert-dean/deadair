import { Injectable } from 'injectkit';
import { Kysely, sql, type Transaction } from 'kysely';
import type { ArtistTrack } from '@deadair/plugin-sdk';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';

/** Which question a stored answer answers. The values `similarity_asks.kind` allows. */
export type SimilarityAskKind = 'artists' | 'records';

/** One artist that resembles another, as it is kept. */
export interface StoredNeighbour {
    name: string;
    mbid?: string;
    match?: number;
    /** The plugin id whose answer named this artist first. */
    source: string;
}

/** One record an artist is known for, as it is kept: the SDK's `ArtistTrack` and who said so. */
export interface StoredRecord extends ArtistTrack {
    source: string;
}

/** A stored answer, with what is needed to judge whether it still serves. */
export interface StoredAnswer<T> {
    /** How many were asked for when this was stored. */
    askedLimit: number;
    /** How old the answer is, in milliseconds, by the database's clock. */
    ageMs: number;
    entries: T[];
}

/**
 * What the similarity sources have said, kept. See `0119_similarity_store.sql`.
 *
 * Written only by `SimilarityService`, which answers from here first and writes every fresh answer
 * through, and read by the shortlist, which wants every record stored for a set of artists at once.
 * Lives in the similarity module for the reason `ProviderPlaylistsRepository` lives in the catalog's:
 * the service that writes it registers before the director that reads it.
 */
@Injectable()
export class SimilarityStoreRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /** Who resembles `artistKey`, as last stored, or `undefined` when nobody has asked. */
    async neighbours(artistKey: string): Promise<StoredAnswer<StoredNeighbour> | undefined> {
        const ask = await this.ask('artists', artistKey);
        if (ask === undefined) return undefined;

        const rows = await this.db
            .selectFrom('deadair.similarArtists')
            .select(['name', 'mbid', 'match', 'source'])
            .where('stationKey', '=', this.station.stationKey)
            .where('artistKey', '=', artistKey)
            .orderBy('rank')
            .execute();

        return {
            ...ask,
            // `== null` because the driver hands back `undefined` for a null column: see `apps/api/CLAUDE.md`.
            entries: rows.map(row => ({
                name: row.name,
                source: row.source,
                ...(row.mbid == null ? {} : { mbid: row.mbid }),
                ...(row.match == null ? {} : { match: Number(row.match) }),
            })),
        };
    }

    /** The records `artistKey` is known for, as last stored, or `undefined` when nobody has asked. */
    async records(artistKey: string): Promise<StoredAnswer<StoredRecord> | undefined> {
        const ask = await this.ask('records', artistKey);
        if (ask === undefined) return undefined;

        const rows = await this.recordRows([artistKey]);
        return { ...ask, entries: rows.map(row => row.record) };
    }

    /**
     * Every record stored for any of these artists, each artist's in the order its source ranked them.
     *
     * One query however many artists, for a shortlist built over a brief's acts and their neighbours.
     * An artist nobody has asked about is simply absent.
     */
    async recordsFor(artistKeys: readonly string[]): Promise<Map<string, StoredRecord[]>> {
        const found = new Map<string, StoredRecord[]>();
        if (artistKeys.length === 0) return found;

        for (const row of await this.recordRows(artistKeys)) {
            const own = found.get(row.artistKey);
            if (own === undefined) found.set(row.artistKey, [row.record]);
            else own.push(row.record);
        }
        return found;
    }

    /**
     * Who resembles each of these artists, as stored, best first. One query, like {@link recordsFor}.
     */
    async neighboursFor(artistKeys: readonly string[]): Promise<Map<string, StoredNeighbour[]>> {
        const found = new Map<string, StoredNeighbour[]>();
        if (artistKeys.length === 0) return found;

        const rows = await this.db
            .selectFrom('deadair.similarArtists')
            .select(['artistKey', 'name', 'mbid', 'match', 'source'])
            .where('stationKey', '=', this.station.stationKey)
            .where('artistKey', 'in', [...artistKeys])
            .orderBy('artistKey')
            .orderBy('rank')
            .execute();

        for (const row of rows) {
            const neighbour: StoredNeighbour = {
                name: row.name,
                source: row.source,
                ...(row.mbid == null ? {} : { mbid: row.mbid }),
                ...(row.match == null ? {} : { match: Number(row.match) }),
            };
            const own = found.get(row.artistKey);
            if (own === undefined) found.set(row.artistKey, [neighbour]);
            else own.push(neighbour);
        }
        return found;
    }

    /**
     * Which of these artists have had the question asked within `maxAgeMs`, for a fill deciding who is
     * still owed one.
     */
    async askedWithin(kind: SimilarityAskKind, artistKeys: readonly string[], maxAgeMs: number): Promise<Set<string>> {
        if (artistKeys.length === 0) return new Set();

        const rows = await this.db
            .selectFrom('deadair.similarityAsks')
            .select('artistKey')
            .where('stationKey', '=', this.station.stationKey)
            .where('kind', '=', kind)
            .where('artistKey', 'in', [...artistKeys])
            .where('askedAt', '>', sql<never>`now() - ${maxAgeMs} * interval '1 millisecond'`)
            .execute();

        return new Set(rows.map(row => row.artistKey));
    }

    /** Replace who resembles `artistKey` with a fresh answer, `neighbourKeys` beside each name. */
    async saveNeighbours(
        artistKey: string,
        artistName: string,
        askedLimit: number,
        neighbours: readonly (StoredNeighbour & { neighbourKey: string })[],
    ): Promise<void> {
        await this.replace('artists', artistKey, artistName, askedLimit, async trx => {
            await trx
                .deleteFrom('deadair.similarArtists')
                .where('stationKey', '=', this.station.stationKey)
                .where('artistKey', '=', artistKey)
                .execute();
            if (neighbours.length === 0) return;
            await trx
                .insertInto('deadair.similarArtists')
                .values(
                    neighbours.map((neighbour, rank) => ({
                        stationKey: this.station.stationKey,
                        artistKey,
                        rank,
                        name: neighbour.name,
                        neighbourKey: neighbour.neighbourKey,
                        mbid: neighbour.mbid ?? null,
                        match: neighbour.match ?? null,
                        source: neighbour.source,
                    })),
                )
                .execute();
        });
    }

    /** Replace the records `artistKey` is known for with a fresh answer. */
    async saveRecords(artistKey: string, artistName: string, askedLimit: number, records: readonly StoredRecord[]): Promise<void> {
        await this.replace('records', artistKey, artistName, askedLimit, async trx => {
            await trx
                .deleteFrom('deadair.artistRecords')
                .where('stationKey', '=', this.station.stationKey)
                .where('artistKey', '=', artistKey)
                .execute();
            if (records.length === 0) return;
            await trx
                .insertInto('deadair.artistRecords')
                .values(
                    records.map((record, rank) => ({
                        stationKey: this.station.stationKey,
                        artistKey,
                        rank,
                        title: record.title,
                        artist: record.artist,
                        album: record.album ?? null,
                        year: record.year ?? null,
                        source: record.source,
                    })),
                )
                .execute();
        });
    }

    private async ask(kind: SimilarityAskKind, artistKey: string): Promise<Omit<StoredAnswer<never>, 'entries'> | undefined> {
        const row = await this.db
            .selectFrom('deadair.similarityAsks')
            .select(['askedLimit', sql<number>`extract(epoch from now() - asked_at) * 1000`.as('ageMs')])
            .where('stationKey', '=', this.station.stationKey)
            .where('kind', '=', kind)
            .where('artistKey', '=', artistKey)
            .executeTakeFirst();

        return row === undefined ? undefined : { askedLimit: Number(row.askedLimit), ageMs: Number(row.ageMs) };
    }

    private async recordRows(artistKeys: readonly string[]): Promise<{ artistKey: string; record: StoredRecord }[]> {
        const rows = await this.db
            .selectFrom('deadair.artistRecords')
            .select(['artistKey', 'title', 'artist', 'album', 'year', 'source'])
            .where('stationKey', '=', this.station.stationKey)
            .where('artistKey', 'in', [...artistKeys])
            .orderBy('artistKey')
            .orderBy('rank')
            .execute();

        return rows.map(row => ({
            artistKey: row.artistKey,
            record: {
                title: row.title,
                artist: row.artist,
                source: row.source,
                ...(row.album == null ? {} : { album: row.album }),
                ...(row.year == null ? {} : { year: Number(row.year) }),
            },
        }));
    }

    /**
     * The ask row and its answer, written together or not at all.
     *
     * In the caller's transaction when there is one, since Kysely refuses `.transaction()` on a
     * `Transaction`: the same shape `CatalogResolverService.ingest` takes.
     */
    private async replace(
        kind: SimilarityAskKind,
        artistKey: string,
        artistName: string,
        askedLimit: number,
        answer: (trx: Kysely<DB> | Transaction<DB>) => Promise<void>,
    ): Promise<void> {
        const write = async (trx: Kysely<DB> | Transaction<DB>): Promise<void> => {
            const asked = { artistName, askedLimit, askedAt: sql<never>`now()` };
            await trx
                .insertInto('deadair.similarityAsks')
                .values({ stationKey: this.station.stationKey, kind, artistKey, ...asked })
                .onConflict(conflict => conflict.columns(['stationKey', 'kind', 'artistKey']).doUpdateSet(asked))
                .execute();
            await answer(trx);
        };

        if (this.db.isTransaction) await write(this.db);
        else await this.db.transaction().execute(write);
    }
}
