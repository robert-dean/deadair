import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import {
    PERSONA_STORY_DETAIL_LIMIT,
    type PersonaStory,
    type PersonaStoryDetail,
    type PersonaStoryDraft,
    type PersonaStoryForPrompt,
    type PersonaStoryOrigin,
    type PersonaStoryState,
} from './persona.story.js';

/** A story on its way in, with the two things only the writer of it knows. */
export interface PersonaStoryWrite extends PersonaStoryDraft {
    personaKey: string;
    state: PersonaStoryState;
    origin: PersonaStoryOrigin;
}

/** A detail on its way in, hung on a story that already exists. */
export interface PersonaStoryDetailWrite {
    storyId: string;
    detail: string;
    state: PersonaStoryState;
    origin: PersonaStoryOrigin;
    source?: string;
}

/**
 * What each character has lived through, as far as the station is concerned.
 *
 * Shaped after `PersonaNotesRepository`, which solves the same problem one table over: a list an
 * operator and a machine both append to, where a proposal that was turned down has to outlive the
 * pass that proposed it.
 *
 * ## The read and the stamp are two calls, deliberately
 *
 * {@link forPrompt} touches neither `last_told_at` nor `times_told`. The caller that is actually
 * putting words on air calls {@link markTold} afterwards, which is the arrangement `FactRepository`
 * and `PersonaNotesRepository` both have and exists for the same reason: a rehearsal reads a
 * character to let an operator HEAR it, and a preview that spent the rotation would hand the next
 * real break the second-best story.
 *
 * The stamp is at SELECTION rather than at air, which is the same inaccuracy `chooseFacts` buys and
 * against the same alternative — a break dropped before its slot has still spent its story, and the
 * only way to do better is a second writer of these columns that can disagree with the first.
 *
 * ## One story, never a list
 *
 * {@link forPrompt} answers at most ONE. The measured failure of handing a model material is that the
 * model gets through the material, and a break is 40 words. Which one comes round is the index's
 * business — least recently told first — so a character with six stories tells all six rather than
 * the first one forever.
 */
@Injectable()
export class PersonaStoriesRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * Every story one character holds, in every state, oldest first, each with its own details.
     *
     * The console read. Ordered on the stamp with the id behind it, for `PersonaRepository.list`'s
     * reason: a seed or a pass writes a batch in one statement, so rows share a timestamp and a sort
     * on it alone reshuffles between reads.
     */
    async list(personaKey: string): Promise<PersonaStory[]> {
        const rows = await this.db
            .selectFrom('deadair.personaStories')
            .selectAll()
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .orderBy('createdAt', 'asc')
            .orderBy('id', 'asc')
            .execute();

        if (rows.length === 0) return [];

        const details = await this.detailsFor(rows.map(row => row.id));

        return rows.map(row => ({
            id: row.id,
            personaKey: row.personaKey,
            title: row.title,
            story: row.story,
            state: row.state as PersonaStoryState,
            origin: row.origin as PersonaStoryOrigin,
            details: details.get(row.id) ?? [],
            timesTold: Number(row.timesTold),
            ...(row.source == null ? {} : { source: row.source }),
            ...(row.lastToldAt == null ? {} : { lastToldAt: row.lastToldAt.toISO() ?? '' }),
            createdAt: row.createdAt.toISO() ?? '',
        }));
    }

    /**
     * The story this break may tell, or `undefined` for a character with none.
     *
     * `undefined` is an ordinary answer rather than a fault, and it is the answer every station gets
     * until somebody writes one: a talk break simply carries no story, and a `story` break declines
     * its slot. Only ACTIVE rows, so a proposal nobody has looked at cannot reach a listener.
     */
    async forPrompt(personaKey: string): Promise<{ story: PersonaStoryForPrompt; id: string } | undefined> {
        const row = await this.db
            .selectFrom('deadair.personaStories')
            .select(['id', 'title', 'story', 'timesTold'])
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where('state', '=', 'active')
            // Least recently told first, and `nulls first` so a story that has never gone out is
            // ahead of every story that has. Then oldest, so two reads a second apart agree rather
            // than answering whatever the planner felt like.
            .orderBy(sql`last_told_at asc nulls first`)
            .orderBy('createdAt', 'asc')
            .executeTakeFirst();

        if (row === undefined) return undefined;

        const details = (await this.detailsFor([row.id], 'active')).get(row.id) ?? [];

        return {
            id: row.id,
            story: {
                title: row.title,
                story: row.story,
                details: details.slice(0, PERSONA_STORY_DETAIL_LIMIT).map(detail => detail.detail),
                timesTold: Number(row.timesTold),
            },
        };
    }

    /**
     * Rest the story that was just carried into a break, and count the telling.
     *
     * Separate from the read so a caller that is not on air spends nothing. See the class note.
     */
    async markTold(id: string): Promise<void> {
        await this.db
            .updateTable('deadair.personaStories')
            .set({ lastToldAt: sql`now()`, timesTold: sql`times_told + 1` })
            .where('stationKey', '=', this.station.stationKey)
            .where('id', '=', id)
            .execute();
    }

    /** Writes one story and answers with it. */
    async add(write: PersonaStoryWrite): Promise<PersonaStory> {
        const row = await this.db.insertInto('deadair.personaStories').values(this.valuesFor(write)).returning('id').executeTakeFirstOrThrow();

        return (await this.list(write.personaKey)).find(story => story.id === row.id)!;
    }

    /**
     * Writes several, skipping anything this character already holds under the same title.
     *
     * `on conflict do nothing` against the partial unique index rather than a read and then a write,
     * for `PersonaNotesRepository.addAll`'s reason: a seed at boot and an operator's own story can
     * land in the same moment, and the loser of that race should be the machine.
     *
     * Answers how many rows were actually written, which is what a seed reports and what decides
     * whether anything is said about it at all.
     */
    async addAll(writes: readonly PersonaStoryWrite[]): Promise<number> {
        if (writes.length === 0) return 0;

        const written = await this.db
            .insertInto('deadair.personaStories')
            .values(writes.map(write => this.valuesFor(write)))
            .onConflict(conflict => conflict.doNothing())
            .returning('id')
            .execute();

        return written.length;
    }

    /** Rewrites one story's handle and telling. An operator editing what the pass proposed is the point. */
    async update(id: string, draft: { title: string; story: string }): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.personaStories')
            .set({ title: draft.title.trim(), story: draft.story.trim(), updatedAt: sql`now()` })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(result.numUpdatedRows) > 0;
    }

    /** Accepts a proposal, turns one down, or takes a story out of the rotation without losing it. */
    async setState(id: string, state: PersonaStoryState): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.personaStories')
            .set({ state, updatedAt: sql`now()` })
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(result.numUpdatedRows) > 0;
    }

    /** Removes one outright, details and all. Turning down a PROPOSAL is {@link setState} instead. */
    async remove(id: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.personaStories')
            .where('id', '=', id)
            .where('stationKey', '=', this.station.stationKey)
            .executeTakeFirst();

        return Number(result.numDeletedRows) > 0;
    }

    /** Whether this character already holds a story under this title, in any state including `rejected`. */
    async holds(personaKey: string, title: string): Promise<boolean> {
        const found = await this.db
            .selectFrom('deadair.personaStories')
            .select('id')
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where(sql<boolean>`lower(btrim(title)) = lower(btrim(${title}))`)
            .executeTakeFirst();

        return found !== undefined;
    }

    /** One story of this character's by id, or `undefined`. What a detail write is checked against. */
    async find(personaKey: string, id: string): Promise<PersonaStory | undefined> {
        return (await this.list(personaKey)).find(story => story.id === id);
    }

    /** Hangs one detail on a story. */
    async addDetail(write: PersonaStoryDetailWrite): Promise<void> {
        await this.db.insertInto('deadair.personaStoryDetails').values(this.detailValuesFor(write)).execute();
    }

    /** Hangs several, skipping any this story already carries in the same words. See {@link addAll}. */
    async addDetails(writes: readonly PersonaStoryDetailWrite[]): Promise<number> {
        if (writes.length === 0) return 0;

        const written = await this.db
            .insertInto('deadair.personaStoryDetails')
            .values(writes.map(write => this.detailValuesFor(write)))
            .onConflict(conflict => conflict.doNothing())
            .returning('id')
            .execute();

        return written.length;
    }

    /** Rewrites one detail's words. */
    async updateDetail(id: string, detail: string): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.personaStoryDetails')
            .set({ detail: detail.trim() })
            .where('id', '=', id)
            .executeTakeFirst();

        return Number(result.numUpdatedRows) > 0;
    }

    /** Accepts a proposed detail, or turns it down without losing the fact that it was turned down. */
    async setDetailState(id: string, state: PersonaStoryState): Promise<boolean> {
        const result = await this.db.updateTable('deadair.personaStoryDetails').set({ state }).where('id', '=', id).executeTakeFirst();

        return Number(result.numUpdatedRows) > 0;
    }

    /** Removes one detail outright, leaving the story it was hung on alone. */
    async removeDetail(id: string): Promise<boolean> {
        const result = await this.db.deleteFrom('deadair.personaStoryDetails').where('id', '=', id).executeTakeFirst();

        return Number(result.numDeletedRows) > 0;
    }

    /** Whether this story already carries a detail in these words, in any state including `rejected`. */
    async holdsDetail(storyId: string, detail: string): Promise<boolean> {
        const found = await this.db
            .selectFrom('deadair.personaStoryDetails')
            .select('id')
            .where('storyId', '=', storyId)
            .where(sql<boolean>`lower(btrim(detail)) = lower(btrim(${detail}))`)
            .executeTakeFirst();

        return found !== undefined;
    }

    /**
     * The details of several stories at once, oldest first.
     *
     * One query for the whole page rather than one per story, which is the only reason {@link list}
     * can answer a character's whole notebook of them without a walk.
     */
    private async detailsFor(storyIds: readonly string[], state?: PersonaStoryState): Promise<Map<string, PersonaStoryDetail[]>> {
        const out = new Map<string, PersonaStoryDetail[]>();
        if (storyIds.length === 0) return out;

        let query = this.db
            .selectFrom('deadair.personaStoryDetails')
            .selectAll()
            .where('storyId', 'in', [...storyIds])
            .orderBy('createdAt', 'asc')
            .orderBy('id', 'asc');

        if (state !== undefined) query = query.where('state', '=', state);

        for (const row of await query.execute()) {
            const detail: PersonaStoryDetail = {
                id: row.id,
                storyId: row.storyId,
                detail: row.detail,
                state: row.state as PersonaStoryState,
                origin: row.origin as PersonaStoryOrigin,
                ...(row.source == null ? {} : { source: row.source }),
                createdAt: row.createdAt.toISO() ?? '',
            };

            const held = out.get(row.storyId);
            if (held === undefined) out.set(row.storyId, [detail]);
            else held.push(detail);
        }

        return out;
    }

    private valuesFor(write: PersonaStoryWrite) {
        return {
            stationKey: this.station.stationKey,
            personaKey: write.personaKey,
            title: write.title.trim(),
            story: write.story.trim(),
            state: write.state,
            origin: write.origin,
            source: write.source ?? null,
        };
    }

    private detailValuesFor(write: PersonaStoryDetailWrite) {
        return {
            storyId: write.storyId,
            detail: write.detail.trim(),
            state: write.state,
            origin: write.origin,
            source: write.source ?? null,
        };
    }
}
