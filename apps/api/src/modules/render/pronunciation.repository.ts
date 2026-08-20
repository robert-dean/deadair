import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { Pronunciation } from './pronunciation.lexicon.js';

/** Whether an entry is said, proposed, or turned down. */
export type PronunciationState = 'active' | 'suggested' | 'rejected';

/** Who says so: an operator typed it, or an article printed a pronunciation key for itself. */
export type PronunciationOrigin = 'operator' | 'gloss';

/** What an article was about, so a proposal can be shown beside the record it was noticed on. */
export type PronunciationSubjectKind = 'track' | 'album' | 'artist';

/** One entry, with everything the console needs to judge it. */
export interface PronunciationEntry extends Pronunciation {
    id: string;
    state: PronunciationState;
    origin: PronunciationOrigin;
    sourceUrl?: string;
    sourceQuote?: string;
    subjectKind?: PronunciationSubjectKind;
    subjectId?: string;
    createdAt: string;
}

/** An entry before it is a row. The evidence is required of anything an operator did not type. */
export interface PronunciationDraft extends Pronunciation {
    state: PronunciationState;
    origin: PronunciationOrigin;
    sourceUrl?: string;
    sourceQuote?: string;
    subjectKind?: PronunciationSubjectKind;
    subjectId?: string;
}

/**
 * The station's lexicon: the names it says differently from how they are written.
 *
 * ## Why the rows are read on every render rather than cached
 *
 * `SpeechService` asks for {@link active} once per segment, which is a few dozen rows once every few
 * minutes. The setting this replaced was parsed per call on the same argument, and it kept the
 * property that mattered: an operator's edit is heard on the next break rather than after a
 * restart.
 *
 * ## A proposal that was turned down stays
 *
 * {@link propose} is written to be safe to run over the same article forever, because it will be:
 * the mining pass re-reads a document whenever a plugin hands over a new one. `rejected` is
 * therefore a row rather than a deletion, and {@link holds} is what a caller asks before spending
 * anything on a proposal — including the operator's attention.
 */
@Injectable()
export class PronunciationRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * What the station says differently, right now.
     *
     * Only the shape the lexicon needs, because that is all the render path uses and this is the
     * read on the path of every spoken segment.
     */
    async active(): Promise<Pronunciation[]> {
        const rows = await this.db
            .selectFrom('deadair.pronunciations')
            .select(['written', 'spoken'])
            .where('stationKey', '=', this.station.stationKey)
            .where('state', '=', 'active')
            .execute();

        return rows.map(row => ({ written: row.written, spoken: row.spoken }));
    }

    /**
     * Every entry the station holds, or every entry in one state.
     *
     * Oldest first, then by written form: the seeds are written in ONE insert and share a
     * transaction timestamp, so a sort on the stamp alone hands back whatever order the planner
     * felt like and a console list reshuffles between reads. `PersonaRepository.list` has the same
     * tiebreaker for the same reason.
     */
    async list(state?: PronunciationState): Promise<PronunciationEntry[]> {
        let query = this.db
            .selectFrom('deadair.pronunciations')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .orderBy('createdAt', 'asc')
            .orderBy('written', 'asc');

        if (state !== undefined) query = query.where('state', '=', state);

        return (await query.execute()).map(row => ({
            id: row.id,
            written: row.written,
            spoken: row.spoken,
            state: row.state,
            origin: row.origin,
            ...(row.sourceUrl == null ? {} : { sourceUrl: row.sourceUrl }),
            ...(row.sourceQuote == null ? {} : { sourceQuote: row.sourceQuote }),
            ...(row.subjectKind == null ? {} : { subjectKind: row.subjectKind }),
            ...(row.subjectId == null ? {} : { subjectId: row.subjectId }),
            createdAt: row.createdAt.toISO() ?? '',
        }));
    }

    /** Whether any row already speaks for this written form, in any state at all. */
    async holds(written: string): Promise<boolean> {
        const found = await this.db
            .selectFrom('deadair.pronunciations')
            .select('id')
            .where('stationKey', '=', this.station.stationKey)
            .where(sql<boolean>`lower(written) = lower(${written})`)
            .executeTakeFirst();

        return found !== undefined;
    }

    /** How many entries this station holds, which is what seeding guards on. */
    async count(): Promise<number> {
        const row = await this.db
            .selectFrom('deadair.pronunciations')
            .select(({ fn }) => fn.countAll<string>().as('count'))
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(row?.count ?? 0);
    }

    /** Writes one entry and answers with it. */
    async add(draft: PronunciationDraft): Promise<PronunciationEntry> {
        const row = await this.db
            .insertInto('deadair.pronunciations')
            .values({
                stationKey: this.station.stationKey,
                written: draft.written.trim(),
                spoken: draft.spoken.trim(),
                state: draft.state,
                origin: draft.origin,
                sourceUrl: draft.sourceUrl ?? null,
                sourceQuote: draft.sourceQuote ?? null,
                subjectKind: draft.subjectKind ?? null,
                subjectId: draft.subjectId ?? null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();

        return (await this.list()).find(entry => entry.id === row.id)!;
    }

    /**
     * Writes several, skipping any written form the station already holds.
     *
     * `on conflict do nothing` against the partial unique index rather than a read followed by a
     * write, because the mining pass and an operator's own edit can land in the same moment and the
     * loser of that race should be the machine.
     */
    async addAll(drafts: readonly PronunciationDraft[]): Promise<number> {
        if (drafts.length === 0) return 0;

        const written = await this.db
            .insertInto('deadair.pronunciations')
            .values(
                drafts.map(draft => ({
                    stationKey: this.station.stationKey,
                    written: draft.written.trim(),
                    spoken: draft.spoken.trim(),
                    state: draft.state,
                    origin: draft.origin,
                    sourceUrl: draft.sourceUrl ?? null,
                    sourceQuote: draft.sourceQuote ?? null,
                    subjectKind: draft.subjectKind ?? null,
                    subjectId: draft.subjectId ?? null,
                })),
            )
            .onConflict(conflict => conflict.doNothing())
            .returning('id')
            .execute();

        return written.length;
    }

    /** Rewrites one entry's words. */
    async update(id: string, entry: Pronunciation): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.pronunciations')
            .set({ written: entry.written.trim(), spoken: entry.spoken.trim(), updatedAt: sql`now()` })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(result.numUpdatedRows) > 0;
    }

    /** Accepts or turns down a proposal, or takes an entry out of use without losing it. */
    async setState(id: string, state: PronunciationState): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.pronunciations')
            .set({ state, updatedAt: sql`now()` })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(result.numUpdatedRows) > 0;
    }

    /** Removes one entry outright, which is the operator's own to do. */
    async remove(id: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.pronunciations')
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(result.numDeletedRows) > 0;
    }
}
