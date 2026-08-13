import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';
import { toJsonb } from '#modules/data/jsonb.js';

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

interface ScriptHistoryRow {
    id: string;
    createdAt: DateTime;
    segmentId: string | null;
    kind: string;
    label: string | null;
    script: string | null;
    writer: string;
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
    /** Write down one attempt. */
    async record(write: ScriptWrite): Promise<void> {
        await this.db
            .insertInto('deadair.scriptHistory')
            .values({
                segmentId: write.segmentId ?? null,
                kind: write.kind,
                label: write.label ?? null,
                script: write.script ?? null,
                writer: write.writer,
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

    /** Every attempt made for one segment, oldest first. */
    async forSegment(segmentId: string): Promise<ScriptHistoryEntry[]> {
        const rows = await this.db
            .selectFrom('deadair.scriptHistory')
            .select(HISTORY_COLUMNS)
            .where('segmentId', '=', segmentId)
            .orderBy('createdAt', 'asc')
            .execute();

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
