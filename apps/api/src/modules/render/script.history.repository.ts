import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { toJsonb } from '#modules/data/jsonb.js';
import { StationIdentity } from '#modules/shared/station.identity.js';

/**
 * Everything the station ever wrote, including the attempts that came to nothing.
 *
 * `segments.script` answers "what does this break say", and only for a break that still exists. This
 * answers "what has the station written", which is a different question and the one somebody
 * actually has when a break sounded wrong: the attempt that was overwritten, the writer that
 * declined, the words of a segment that has since been deleted. None of it is reconstructable
 * afterwards, which is why it is written now rather than when something wants it.
 *
 * ## One row per ATTEMPT
 *
 * Not per segment. A break where a model declined and the floor covered for it is two rows, and the
 * second on its own reads as a station that never had a model configured.
 *
 * ## Nothing here is load-bearing
 *
 * No caller reads this to decide anything, so every write is best-effort at the call site: a history
 * write that fails must never cost the station the break it was describing. That is the same trade
 * `segment_events` makes one table over, for the same reason.
 */

/** What a writer was told about a record, kept as it was told. */
export interface HistoryTrack {
    title: string;
    artist: string;
    /**
     * The facts it was shown, when it was shown any.
     *
     * Kept because a break that said nothing interesting and a break that was TOLD nothing
     * interesting look identical from the script alone, and the enrichment tables cannot answer it
     * afterwards: what was chosen depends on the rotation, and what was stored may have changed
     * since. Unlike `prompt`, this stays on every row rather than waiting for `llm.captureWrites`,
     * because it is two short sentences rather than a whole conversation.
     */
    facts?: readonly string[];
}

/** Whether there are words, and if not, which way it went wrong. */
export type ScriptOutcome = 'written' | 'declined' | 'failed';

/** One attempt to write something the station would say. */
export interface ScriptWrite {
    /** The segment this was for, when it is still known. */
    segmentId?: string;
    kind: string;
    /** Both absent for an attempt that produced nothing. */
    label?: string;
    script?: string;
    /** The binding that produced or declined it. `BreakWriter.name`. */
    writer: string;
    /**
     * Who was presenting, as the persona's own KEY.
     *
     * The key rather than the id, and denormalised like everything else here, because this table
     * outlives what it describes: `segments.persona_id` records the same fact and cannot answer it
     * once the segment is gone. Absent means nobody was presenting, which is an ordinary state.
     */
    personaKey?: string;
    /** The model that said it, for a writer that used one. */
    model?: string;
    /** What the line was rendered from, for a writer working from something an operator can edit. */
    source?: string;
    previous?: HistoryTrack;
    next?: HistoryTrack;
    outcome: ScriptOutcome;
    /** Why, for anything that is not `written`. */
    reason?: string;
    /** The provider's own token counts, when it reported any. */
    usage?: Record<string, number>;
    durationMs?: number;
    /** Only while `llm.captureWrites` is on. See the migration. */
    prompt?: unknown;
    raw?: string;
}

/** One attempt as it is read back. */
export interface ScriptHistoryEntry extends ScriptWrite {
    id: string;
    at: DateTime;
}

/** One page of {@link ScriptHistoryRepository.page}, with the filters a console offers. */
export interface ScriptHistoryPageQuery {
    limit: number;
    /** Where the previous page ended, as {@link encodeScriptCursor} wrote it. */
    before?: string;
    kind?: string;
    writer?: string;
    outcome?: ScriptOutcome;
    /** Everything one character has said, which is the read a persona's own page wants. */
    personaKey?: string;
    /** Every attempt made for one break, in place of the whole history. */
    segmentId?: string;
}

/** The cursor for the row after this one. */
export const encodeScriptCursor = (entry: ScriptHistoryEntry): string => `${entry.at.toISO()}|${entry.id}`;

/**
 * Answers `undefined` for anything this file did not write, which is treated as no cursor at all.
 *
 * Split on the FIRST separator, exactly as the activity feed's is: an ISO timestamp cannot contain
 * one, and splitting on the last would cut an id in half rather than fail loudly.
 */
function decodeCursor(cursor: string | undefined): { at: DateTime; id: string } | undefined {
    if (cursor === undefined) return undefined;

    const separator = cursor.indexOf('|');
    if (separator <= 0) return undefined;

    const at = DateTime.fromISO(cursor.slice(0, separator));
    const id = cursor.slice(separator + 1);
    if (!at.isValid || id === '') return undefined;

    return { at, id };
}

interface ScriptHistoryRow {
    id: string;
    createdAt: DateTime;
    segmentId: string | null;
    kind: string;
    label: string | null;
    script: string | null;
    writer: string;
    personaKey: string | null;
    model: string | null;
    source: string | null;
    previous: unknown;
    next: unknown;
    outcome: ScriptOutcome;
    reason: string | null;
    usage: unknown;
    durationMs: number | null;
    prompt: unknown;
    raw: string | null;
}

const HISTORY_COLUMNS = [
    'id',
    'createdAt',
    'segmentId',
    'kind',
    'label',
    'script',
    'writer',
    'personaKey',
    'model',
    'source',
    'previous',
    'next',
    'outcome',
    'reason',
    'usage',
    'durationMs',
    'prompt',
    'raw',
] as const;

/** Rows read back as `undefined` rather than `null`, per the note in CLAUDE.md. */
function toEntry(row: ScriptHistoryRow): ScriptHistoryEntry {
    return {
        id: row.id,
        at: row.createdAt,
        kind: row.kind,
        writer: row.writer,
        outcome: row.outcome,
        ...(row.segmentId == null ? {} : { segmentId: row.segmentId }),
        ...(row.label == null ? {} : { label: row.label }),
        ...(row.script == null ? {} : { script: row.script }),
        ...(row.personaKey == null ? {} : { personaKey: row.personaKey }),
        ...(row.model == null ? {} : { model: row.model }),
        ...(row.source == null ? {} : { source: row.source }),
        ...(row.previous == null ? {} : { previous: row.previous as HistoryTrack }),
        ...(row.next == null ? {} : { next: row.next as HistoryTrack }),
        ...(row.reason == null ? {} : { reason: row.reason }),
        ...(row.usage == null ? {} : { usage: row.usage as Record<string, number> }),
        ...(row.durationMs == null ? {} : { durationMs: row.durationMs }),
        ...(row.prompt == null ? {} : { prompt: row.prompt }),
        ...(row.raw == null ? {} : { raw: row.raw }),
    };
}

@Injectable()
export class ScriptHistoryRepository extends DataRepository {
    /** Injected for the reason `SegmentRepository` spells out: the writers here are jobs. */
    constructor(
        db: Kysely<DB>,
        private readonly identity: StationIdentity,
    ) {
        super(db);
    }

    /** Write down one attempt. */
    async record(write: ScriptWrite): Promise<void> {
        await this.db
            .insertInto('deadair.scriptHistory')
            .values({
                stationKey: this.identity.stationKey,
                // Denormalised like everything else on this row, and for the same reason: the table
                // outlives the segment, so the broadcast has to be a value here rather than
                // something reachable through a reference that may already be null.
                broadcastId: this.identity.current() ?? null,
                segmentId: write.segmentId ?? null,
                kind: write.kind,
                label: write.label ?? null,
                script: write.script ?? null,
                writer: write.writer,
                personaKey: write.personaKey ?? null,
                model: write.model ?? null,
                source: write.source ?? null,
                previous: toJsonb(write.previous),
                next: toJsonb(write.next),
                outcome: write.outcome,
                reason: write.reason ?? null,
                usage: toJsonb(write.usage),
                durationMs: write.durationMs ?? null,
                prompt: toJsonb(write.prompt),
                raw: write.raw ?? null,
            })
            .execute();
    }

    /** Several attempts at once, in the order they were made. */
    async recordAll(writes: readonly ScriptWrite[]): Promise<void> {
        for (const write of writes) await this.record(write);
    }

    /** What the station has written lately, newest first. */
    async recent(limit: number): Promise<ScriptHistoryEntry[]> {
        if (limit <= 0) return [];

        const rows = await this.db.selectFrom('deadair.scriptHistory').select(HISTORY_COLUMNS).orderBy('createdAt', 'desc').limit(limit).execute();

        return rows.map(row => toEntry(row as ScriptHistoryRow));
    }

    /**
     * What the station has actually SAID during one broadcast, newest first.
     *
     * The memory a presenter has of the show it is in the middle of, and the reason it is read here
     * rather than from `segments`: that table deliberately carries no `broadcast_id`, because an
     * ident legitimately sits at three slots in one hour and in every broadcast after it, so a
     * column naming one would be a lie by its second play. This table has the broadcast, the words
     * and the writer already.
     *
     * Two filters and a deduplication, and the last one is the trap. **This table is one row per
     * ATTEMPT**, which is the property that makes it worth keeping — but a break the model declined
     * and the floor then wrote is two rows, and a break re-written after its claim went stale is two
     * more. Handed over raw, a writer is told the station said the same thing twice when it said it
     * once, and then avoids repeating a line it never actually used. So: only `written` attempts
     * with words, and only the LATEST per segment.
     *
     * The dedup key falls back to the row's own id, so an attempt with no segment — one whose
     * segment was deleted, since the reference is `on delete set null` — stays its own row rather
     * than collapsing every orphan in the broadcast into one.
     *
     * Kind-agnostic on purpose. A talk break repeating what the bulletin before it just said is the
     * same failure as one repeating another talk break, and only a reader that sees both can catch
     * it.
     */
    async spokenDuring(broadcastId: string, limit: number): Promise<string[]> {
        if (limit <= 0) return [];

        // `distinct on` rather than a window function: it is the cheapest way Postgres expresses
        // "the first row of each group" and it needs no subquery for the filter. The outer select
        // re-sorts, because `distinct on` forces its own leading order-by key.
        const rows = await sql<{ script: string }>`
            select script from (
                select distinct on (coalesce(segment_id::text, id::text)) script, created_at
                from deadair.script_history
                where broadcast_id = ${broadcastId}
                  and outcome = 'written'
                  and script is not null
                order by coalesce(segment_id::text, id::text), created_at desc
            ) said
            order by said.created_at desc
            limit ${Math.floor(limit)}
        `.execute(this.db);

        return rows.rows.map(row => row.script);
    }

    /**
     * What ONE character has actually said, oldest first, since a given moment.
     *
     * The read the notebook's distil pass makes, and the reason `persona_key` exists on this table.
     * Oldest first rather than newest, unlike everything else here, because the model is being asked
     * to notice a habit developing and a list handed to it backwards is a list it reads as one.
     *
     * Deduplicated per segment exactly as {@link spokenDuring} is, and for the same reason: a break
     * the model declined and the floor then wrote is two rows and one thing the station said, and a
     * pass told it twice will note the repetition as a habit.
     *
     * `since` is the watermark, exclusive, so a script read by the last pass is not read again.
     * `undefined` means this character has never been read and takes the whole window.
     *
     * **It is a string, and that is not laziness about types.** Postgres keeps a `timestamptz` to the
     * microsecond and Luxon cannot represent one — a `DateTime` round trip truncates to the
     * millisecond, so a watermark taken from a row's own `created_at` always compares as EARLIER than
     * that row and the last script of every window is read again on the next pass, forever. Carrying
     * the column's own text through and casting it back is exact. Measured: without this, the
     * exclusive watermark returned the row it was taken from.
     *
     * **This is where the operator's opinion joins**, once there is one. `docs/todo/break-ratings.md`
     * scopes `deadair.script_ratings`, and the clause to add here is exactly one: a note distilled
     * from a break the operator thumbed down is the character being taught to repeat the thing that
     * did not land.
     *
     *     left join deadair.script_ratings r on r.script_id = said.id
     *     ...and r.rating is distinct from -1
     */
    async writtenBy(personaKey: string, since: string | undefined, limit: number): Promise<{ id: string; script: string; at: string }[]> {
        if (limit <= 0) return [];

        const rows = await sql<{ id: string; script: string; at: string }>`
            select id, script, at from (
                select distinct on (coalesce(segment_id::text, id::text)) id, script, created_at, created_at::text as at
                from deadair.script_history
                where station_key = ${this.identity.stationKey}
                  and persona_key = ${personaKey}
                  and outcome = 'written'
                  and script is not null
                  ${since === undefined ? sql`` : sql`and created_at > ${since}::timestamptz`}
                order by coalesce(segment_id::text, id::text), created_at desc
            ) said
            order by said.created_at asc
            limit ${Math.floor(limit)}
        `.execute(this.db);

        return rows.rows.map(row => ({ id: row.id, script: row.script, at: row.at }));
    }

    /**
     * One page of what the station has written, newest first.
     *
     * A keyset over `(created_at, id)` rather than an offset, for the reason `ActivityRepository`
     * gives: rows arrive at the head continuously, so an offset re-shows a row on every page as the
     * table grows under it. The id is half of it because a model's attempt and the floor's attempt
     * for the same break land in the same millisecond, which is the ordinary case here rather than
     * a rare one.
     *
     * Reads one row more than asked for, so a caller can tell a full page from the end of the table
     * without counting.
     *
     * Filtered on `station_key`, unlike {@link recent}: this is the read a console paginates
     * through, and a page that mixed two stations would be wrong in a way nothing on it could show.
     */
    async page(query: ScriptHistoryPageQuery): Promise<ScriptHistoryEntry[]> {
        if (query.limit <= 0) return [];

        let statement = this.db
            .selectFrom('deadair.scriptHistory')
            .select(HISTORY_COLUMNS)
            .where('stationKey', '=', this.identity.stationKey)
            .orderBy('createdAt', 'desc')
            .orderBy('id', 'desc')
            .limit(query.limit + 1);

        const cursor = decodeCursor(query.before);
        if (cursor !== undefined) {
            statement = statement.where(sql<boolean>`(created_at, id) < (${cursor.at.toISO()}::timestamptz, ${cursor.id})`);
        }
        if (query.kind !== undefined) statement = statement.where('kind', '=', query.kind);
        if (query.writer !== undefined) statement = statement.where('writer', '=', query.writer);
        if (query.outcome !== undefined) statement = statement.where('outcome', '=', query.outcome);
        if (query.personaKey !== undefined) statement = statement.where('personaKey', '=', query.personaKey);
        // Newest first like every other read here, rather than the oldest-first walk a single
        // break's attempts would suggest: this is the same page in the same order, narrowed. The
        // handful of rows one segment produces fits on it either way.
        if (query.segmentId !== undefined) statement = statement.where('segmentId', '=', query.segmentId);

        const rows = await statement.execute();
        return rows.map(row => toEntry(row as ScriptHistoryRow));
    }

    /**
     * Drop everything older than this many days. Answers how many rows went.
     *
     * `0` or less keeps everything, which is what the setting's own `0` means. Guarded HERE rather
     * than only at the call site, because this is the one statement in the module that deletes
     * anything and "keep it all" must not be reachable as "delete it all" by a caller that forgot.
     *
     * Shaped exactly like `PlayHistoryRepository.prune`, down to the floored literal interval: the
     * window is compared against the database's own clock rather than the app's, so an app whose
     * host has drifted cannot delete a week it should have kept.
     */
    async pruneOlderThanDays(days: number): Promise<number> {
        if (days <= 0) return 0;

        const result = await this.db
            .deleteFrom('deadair.scriptHistory')
            .where('createdAt', '<', sql<DateTime>`now() - ${sql.lit(`${Math.floor(days)} days`)}::interval`)
            .executeTakeFirst();

        return Number(result.numDeletedRows ?? 0);
    }
}
