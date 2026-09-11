import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';
import type { RundownItem } from '#modules/playout/rundown.js';
import { artistKey, songKey } from './rotation.keys.js';

/** One track that actually aired, as the director hands it over. */
export interface PlayHistoryEntry {
    item: RundownItem;
    /** What put it in the running order: `director`, `import`, later a request. */
    source: string;
    /** Which station aired it. Every read below is scoped to it: a repeat window is per station. */
    stationKey: string;
    /**
     * Which broadcast aired it.
     *
     * Absent should not happen in practice — something aired, so a broadcast was on — but it is
     * optional rather than required because this is a history table and refusing to record what a
     * listener demonstrably heard, over a missing label, would be the wrong way round.
     */
    broadcastId?: string;
}

/**
 * How long a station may run before its history is trimmed.
 *
 * Far past the longest window any rule reads, so pruning can never take a row a
 * rotation still cares about. It exists so a station left running for a year
 * does not carry a table nobody will ever query.
 */
const RETENTION_DAYS = 120;

/** Writes between retention sweeps. A track boundary is not the moment to delete a year of rows. */
const PRUNE_EVERY = 50;

/**
 * How many rows {@link PlayHistoryRepository.recentArtists} reads per artist it wants.
 *
 * A station plays several records by the same act in an evening — and the artist
 * cooldown bounds how CLOSE together, not how many — so a scan the width of the
 * answer would come back short after deduplication. Six is comfortably past the
 * per-artist cap on a batch.
 */
const RECENT_ARTIST_SCAN = 6;

/**
 * What the station has aired: `deadair.play_history`.
 *
 * Written from the rundown's `onAired`, which is the only event that can
 * honestly say a track started. Writing it when an item is handed to the player
 * would put every row one track ahead of what the listener heard, and every
 * rotation rule downstream would be steering off that lie.
 *
 * The keys are computed here, through the same helpers the rules read them with,
 * so the writer and the reader cannot drift. A rotation rule that silently never
 * matches has no symptom except a station that repeats itself.
 */
@Injectable()
export class PlayHistoryRepository extends DataRepository {
    /** Writes since the last sweep. Process-local, and only ever a heuristic for when to prune. */
    private static writesSincePrune = 0;

    /**
     * Record one aired track, and occasionally sweep.
     *
     * The sweep rides on the write rather than a timer because it needs no
     * accuracy at all: retention is measured in months, and a station that airs
     * nothing has nothing to trim.
     */
    async record(entry: PlayHistoryEntry): Promise<void> {
        const { item } = entry;

        await this.db
            .insertInto('deadair.playHistory')
            .values({
                stationKey: entry.stationKey,
                broadcastId: entry.broadcastId ?? null,
                trackId: item.trackId ?? null,
                pluginId: item.pluginId,
                externalId: item.externalId,
                title: item.title,
                // The credit as written, for display. Identity comes from the keys below.
                artists: item.artists.join(', '),
                // The lead as written, which is the only speakable form of it: `artists` above is
                // the whole credit line and `artistKey` below is normalized past being sayable.
                artist: item.artist,
                // Off `artist`, the item's lead, and never off `artists` — which is a credit line
                // in one element for everything a generator resolved, so keying it wrote
                // "drake wizkid kyla" as one artist and no repeat window or cooldown could match a
                // collaboration again.
                songKey: songKey(item.title, [item.artist]),
                artistKey: artistKey([item.artist]),
                source: entry.source,
            })
            .execute();

        PlayHistoryRepository.writesSincePrune += 1;
        if (PlayHistoryRepository.writesSincePrune >= PRUNE_EVERY) {
            PlayHistoryRepository.writesSincePrune = 0;
            await this.prune();
        }
    }

    /**
     * Songs aired within the last `days` — the repeat window.
     *
     * `0` or less answers with an empty set WITHOUT querying, which is what makes
     * a disabled rule free rather than a branch at every call site. It is also
     * the honest answer: nothing is suppressed.
     */
    async songKeysSince(days: number, stationKey: string): Promise<Set<string>> {
        if (days <= 0) return new Set();

        const rows = await this.db
            .selectFrom('deadair.playHistory')
            .select('songKey')
            .distinct()
            // Scoped to the station, and the index leads with it. A repeat window is an argument
            // about what THIS station has been playing; answering it from every station's history
            // would have one station's rotation suppressed by another's.
            .where('stationKey', '=', stationKey)
            // Literal interval rather than a bound parameter: `$1::interval` cannot be
            // multiplied by a plain number in a way every driver agrees on, and the value
            // is an integer this code produced, never operator input.
            .where('airedAt', '>', sql<DateTime>`now() - ${sql.lit(`${Math.floor(days)} days`)}::interval`)
            .execute();

        return new Set(rows.map(row => row.songKey));
    }

    /** Artists aired within the last `minutes` — the cooldown. `0` disables it, as above. */
    async artistKeysSince(minutes: number, stationKey: string): Promise<Set<string>> {
        if (minutes <= 0) return new Set();

        const rows = await this.db
            .selectFrom('deadair.playHistory')
            .select('artistKey')
            .distinct()
            .where('stationKey', '=', stationKey)
            .where('airedAt', '>', sql<DateTime>`now() - ${sql.lit(`${Math.floor(minutes)} minutes`)}::interval`)
            .execute();

        return new Set(rows.map(row => row.artistKey));
    }

    /**
     * The artists most recently aired, newest first, as they are CREDITED.
     *
     * Names rather than keys, which is what makes this a different method than the
     * two above rather than a parameter on one: a key is for comparing, and this is
     * for asking somebody else about. A similarity service needs the artist as a
     * human wrote it.
     *
     * The lead credit alone, taken off `artist_key`'s own source rather than off
     * `artists`, because that column is the whole credit line ("A, B & C") and a
     * lookup against a joined credit finds nothing. Deduplicated by key so an
     * evening of one act does not fill the answer.
     *
     * **This is a source of SEEDS and must never become a ranking.** Ordering
     * anything by how often the station has played an artist is a positive feedback
     * loop — what aired is what is offered, so what is offered is what airs — which
     * is the bubble the similarity path exists to break rather than to deepen. See
     * [station-intelligence](https://github.com/robert-dean/deadair/discussions/37) §5.
     */
    async recentArtists(limit: number, stationKey: string, broadcastId?: string): Promise<string[]> {
        if (limit <= 0) return [];

        // Captured so the predicate and the narrowing read the same value: `$if`'s callback cannot
        // see the guard on its own condition, and re-testing the parameter inside it would be a
        // second place for the two to disagree.
        const scoped = broadcastId;

        const rows = await this.db
            .selectFrom('deadair.playHistory')
            .select(['artist', 'artistKey'])
            .where('stationKey', '=', stationKey)
            // Narrowed to one broadcast where the caller names one. The station-wide answer is the
            // right one for "what has this station been playing" and the wrong one the moment an
            // operator changes what it is playing: see `SimilarSetGenerator.seeds`, which is the
            // only caller that passes this and the only one for which the difference is audible.
            .$if(scoped !== undefined, query => query.where('broadcastId', '=', scoped as string))
            .orderBy('airedAt', 'desc')
            // Several rows per artist is the normal case, so the scan is deliberately
            // wider than the answer: taking `limit` rows would return one artist's
            // three songs as three seeds.
            .limit(Math.floor(limit) * RECENT_ARTIST_SCAN)
            .execute();

        const names: string[] = [];
        const seen = new Set<string>();

        for (const row of rows) {
            if (names.length >= limit) break;
            if (seen.has(row.artistKey)) continue;

            // The lead as the writer had it. This used to split `artists` on the first comma,
            // which is right about a joined credit line and wrong about a name with a comma in
            // it — "Earth, Wind & Fire" seeded the similarity generator as "Earth".
            if (!row.artist) continue;

            seen.add(row.artistKey);
            names.push(row.artist);
        }

        return names;
    }

    /**
     * What this broadcast has played, newest first: the show a presenter is in the middle of.
     *
     * Keyed by BROADCAST rather than by a time window, which is the whole point — "what have we
     * played tonight" is a question about a programme, and a window would answer it with the tail of
     * the one before whenever a show had just started. That is what `broadcast_id` is on this table
     * for.
     *
     * The LEAD credit, never the credit line, by the rule the search tools already follow: handing a
     * writer "USHER, Lil Jon, Ludacris" as an artist would put a name on air that nothing else in
     * the station agrees exists. It is read off the column the writer filled rather than recovered
     * from `artists`, which cost the station any lead with a comma in its own name.
     *
     * Deliberately NOT deduplicated. A record played twice in one broadcast is a fact worth a
     * presenter knowing, and collapsing it would hide exactly the case somebody would want to
     * mention or apologise for.
     */
    async duringBroadcast(broadcastId: string, limit: number): Promise<{ title: string; artist: string }[]> {
        if (limit <= 0) return [];

        const rows = await this.db
            .selectFrom('deadair.playHistory')
            .select(['title', 'artist'])
            .where('broadcastId', '=', broadcastId)
            .orderBy('airedAt', 'desc')
            .limit(Math.floor(limit))
            .execute();

        return rows.map(row => ({ title: row.title, artist: row.artist }));
    }

    /**
     * When one record has aired, newest first, and how many times in all.
     *
     * The one read here keyed by the canonical track rather than by a rotation key, and deliberately
     * NOT scoped to a station: the three reads above answer "has this station played this lately",
     * which is a question about one station's memory, while this answers what a catalogue row has
     * accumulated and that belongs to no station in particular.
     *
     * The count comes back beside the rows because the page shows a handful and has to say honestly
     * that there are more — a list of ten with no total reads as a record that has aired ten times.
     *
     * A row whose `track_id` was set null when the catalog forgot the record is absent, which is
     * correct: the fact that something aired survives the catalog, but it is no longer this record's
     * history.
     */
    async forTrack(trackId: string, limit: number): Promise<{ plays: { airedAt: DateTime; broadcastId?: string; source: string }[]; total: number }> {
        const [rows, counted] = await Promise.all([
            this.db
                .selectFrom('deadair.playHistory')
                .select(['airedAt', 'broadcastId', 'source'])
                .where('trackId', '=', trackId)
                .orderBy('airedAt', 'desc')
                .limit(limit)
                .execute(),
            this.db
                .selectFrom('deadair.playHistory')
                .select(eb => eb.fn.countAll<number>().as('total'))
                .where('trackId', '=', trackId)
                .executeTakeFirstOrThrow(),
        ]);

        return {
            plays: rows.map(row => ({
                airedAt: row.airedAt,
                ...(row.broadcastId == null ? {} : { broadcastId: row.broadcastId }),
                source: row.source,
            })),
            total: Number(counted.total),
        };
    }

    /**
     * Drop anything older than the retention window.
     *
     * Deliberately NOT scoped to a station, unlike the two reads above: retention is one number for
     * the install, and a sweep that ran per station would leave every other station's rows to
     * whichever station happened to be airing.
     */
    async prune(days = RETENTION_DAYS): Promise<number> {
        const result = await this.db
            .deleteFrom('deadair.playHistory')
            .where('airedAt', '<', sql<DateTime>`now() - ${sql.lit(`${Math.floor(days)} days`)}::interval`)
            .executeTakeFirst();

        return Number(result.numDeletedRows ?? 0);
    }
}
