import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';

export interface PendingJudgement {
    questionKey: string;
    question: string;
    trackId: string;
    title: string;
    artist: string;
}

/**
 * The model's stored answers to the questions mix flows ask about records: `deadair.mix_judgements`.
 *
 * Read by the picker and the flow's counts, written pending by the picker when it meets a record it has
 * no answer for, and answered by `MixJudgeService`.
 */
@Injectable()
export class MixJudgeRepository extends DataRepository {
    /** The answered questions about these records, by track and then by question key. Pending rows are left out. */
    async answersFor(trackIds: readonly string[], questionKeys: readonly string[]): Promise<Map<string, Map<string, boolean>>> {
        const answers = new Map<string, Map<string, boolean>>();
        if (trackIds.length === 0 || questionKeys.length === 0) return answers;
        const rows = await this.db
            .selectFrom('deadair.mixJudgements')
            .select(['trackId', 'questionKey', 'answer'])
            .where('trackId', 'in', [...trackIds])
            .where('questionKey', 'in', [...questionKeys])
            .where('judgedAt', 'is not', null)
            .execute();
        for (const row of rows) {
            if (row.answer == null) continue;
            const byQuestion = answers.get(row.trackId) ?? new Map<string, boolean>();
            byQuestion.set(row.questionKey, row.answer);
            answers.set(row.trackId, byQuestion);
        }
        return answers;
    }

    /** Ask about these records later: a pending row each, leaving any that exists alone. */
    async askLater(questionKey: string, question: string, trackIds: readonly string[]): Promise<void> {
        if (trackIds.length === 0) return;
        await this.db
            .insertInto('deadair.mixJudgements')
            .values(trackIds.map(trackId => ({ questionKey, question, trackId })))
            .onConflict(conflict => conflict.columns(['questionKey', 'trackId']).doNothing())
            .execute();
    }

    /** Pending questions, oldest first, not waiting out a failure. */
    async pending(limit: number): Promise<PendingJudgement[]> {
        if (limit <= 0) return [];
        const rows = await this.db
            .selectFrom('deadair.mixJudgements as j')
            .innerJoin('deadair.tracks as t', 't.id', 'j.trackId')
            .innerJoin('deadair.artists as a', 'a.id', 't.artistId')
            .select(['j.questionKey', 'j.question', 'j.trackId', 't.title', 'a.name as artist'])
            .where('j.judgedAt', 'is', null)
            .where(eb => eb.or([eb('j.retryAfter', 'is', null), eb('j.retryAfter', '<=', sql<DateTime>`now()`)]))
            .orderBy('j.createdAt')
            .limit(Math.floor(limit))
            .execute();
        return rows.map(row => ({
            questionKey: row.questionKey,
            question: row.question,
            trackId: row.trackId,
            title: row.title,
            artist: row.artist,
        }));
    }

    /** The model's answer; an unplaceable record is stored as no, since nothing airs on a guess. */
    async answer(questionKey: string, trackId: string, answer: boolean, version: string): Promise<void> {
        await this.db
            .updateTable('deadair.mixJudgements')
            .set({ answer, version, judgedAt: sql`now()`, failures: 0, lastError: null, retryAfter: null, updatedAt: sql`now()` })
            .where('questionKey', '=', questionKey)
            .where('trackId', '=', trackId)
            .execute();
    }

    /** A judgement that failed, retried after a backoff doubling from `baseRetryMs` up to `maxRetryMs`. */
    async recordFailure(questionKey: string, trackId: string, error: string, baseRetryMs: number, maxRetryMs: number): Promise<void> {
        await sql`
            update deadair.mix_judgements
               set failures = failures + 1,
                   last_error = ${error},
                   retry_after = now() + make_interval(secs => least(${maxRetryMs / 1000}, ${baseRetryMs / 1000} * power(2, failures))),
                   updated_at = now()
             where question_key = ${questionKey} and track_id = ${trackId}
        `.execute(this.db);
    }
}
