import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { PersonaStoryBeat, PersonaStoryBeatDraft } from './persona.story.beat.js';
import { nextThread } from './persona.thread.js';
import {
    PERSONA_STORY_DETAIL_LIMIT,
    type PersonaStory,
    type PersonaStoryKind,
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

/** A beat on its way in, hung on an arc that already exists. */
export interface PersonaStoryBeatWrite extends PersonaStoryBeatDraft {
    storyId: string;
    state: PersonaStoryState;
    origin: PersonaStoryOrigin;
}

/**
 * What each character has lived through, as far as the station is concerned.
 *
 * Shaped after `PersonaNotesRepository`, which solves the same problem one table over: a list an
 * operator and a machine both append to, where a proposal that was turned down has to outlive the
 * pass that proposed it.
 *
 * ## Reading a story spends nothing, and that is still the arrangement
 *
 * {@link forPrompt} writes nothing at all. What spends a story's turn is a row in
 * `deadair.persona_tellings`, written by whatever actually put words somewhere — the arrangement
 * `FactRepository` and `PersonaNotesRepository` both have, and for the same reason: a rehearsal
 * reads a character to let an operator HEAR it, and a preview that spent the rotation would hand the
 * next real break the second-best story.
 *
 * The spend used to be at SELECTION, on `chooseFacts`' argument that a break dropped before its slot
 * having spent its story was the cheaper of two inaccuracies. It is now taken after the script has
 * won its segment (`WriteBreakJob.spend`), because the ledger made the better answer cheap: the row
 * is keyed on the segment, so a rewrite replaces rather than doubles, and a break that failed or was
 * claimed by something else spends nothing.
 *
 * ## The rotation and the count are READ, not stored
 *
 * `last_told_at` and `times_told` are still columns and are no longer looked at; {@link TIMES_TOLD}
 * and {@link LAST_CARRIED} derive both from the ledger and migration 0038 drops them. What that buys
 * is a distinction two stamps could not hold: the rotation moves on a CARRY, so a story the model
 * keeps being offered and keeps passing over stops blocking the shelf, while the count moves only on
 * a TELLING, so the prompt never asks for a re-telling of something no listener has heard.
 *
 * It also makes a rollback one delete rather than a delete and a repair, which is what stops a story
 * claiming it went out at a moment the station no longer holds any record of.
 *
 * ## One story, never a list
 *
 * {@link forPrompt} answers at most ONE. The measured failure of handing a model material is that the
 * model gets through the material, and a break is 40 words. Which one comes round is the rotation's
 * business — least recently carried first — so a character with six stories tells all six rather
 * than the first one forever.
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
            // Aliased apart from the columns `selectAll` already brought, which still exist and are
            // no longer read. Two columns of one name in one result set is the driver's choice
            // rather than ours.
            .select([TOLD_COUNT, TOLD_AT])
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .orderBy('createdAt', 'asc')
            .orderBy('id', 'asc')
            .execute();

        if (rows.length === 0) return [];

        const [details, beats] = await Promise.all([this.detailsFor(rows.map(row => row.id)), this.beatsFor(rows.map(row => row.id))]);

        return rows.map(row => ({
            id: row.id,
            personaKey: row.personaKey,
            title: row.title,
            story: row.story,
            kind: row.kind as PersonaStoryKind,
            state: row.state as PersonaStoryState,
            origin: row.origin as PersonaStoryOrigin,
            details: details.get(row.id) ?? [],
            beats: beats.get(row.id) ?? [],
            timesTold: Number(row.toldCount),
            ...(row.source == null ? {} : { source: row.source }),
            ...(row.toldAt == null ? {} : { lastToldAt: row.toldAt }),
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
    async forPrompt(
        personaKey: string,
        options: { now: number; gapMs: number },
    ): Promise<{ story: PersonaStoryForPrompt; id: string; beatId?: string } | undefined> {
        const rows = await this.db
            .selectFrom('deadair.personaStories')
            .select(['id', 'title', 'story', 'kind', TIMES_TOLD, CARRIED_AT])
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where('state', '=', 'active')
            // Least recently CARRIED first, and `nulls first` so a story that has never been handed
            // over is ahead of every story that has. Then oldest, so two reads a second apart agree
            // rather than answering whatever the planner felt like.
            //
            // The whole shelf rather than one row, because which of them is ELIGIBLE is no longer a
            // question the order can answer: an arc that has been told out and a thread inside its
            // cadence gap are both skipped, and the next one down takes the break. See `nextThread`.
            .orderBy(sql`carried_at asc nulls first`)
            .orderBy('createdAt', 'asc')
            .execute();

        if (rows.length === 0) return undefined;

        const beats = await this.tellableBeats(rows.filter(row => row.kind === 'arc').map(row => row.id));

        const chosen = nextThread(
            rows.map(row => ({
                id: row.id,
                kind: row.kind as PersonaStoryKind,
                beats: beats.get(row.id) ?? [],
                ...(row.carriedAt == null ? {} : { lastCarriedAt: Number(row.carriedAt) }),
            })),
            options.now,
            options.gapMs,
        );

        if (chosen === undefined) return undefined;

        const row = rows.find(candidate => candidate.id === chosen.id)!;
        const details = (await this.detailsFor([row.id], 'active')).get(row.id) ?? [];
        // Only a BIT is shown its own history: an anecdote is told whole, and an arc has approved
        // parts to move through rather than past wording to move on from.
        const said = row.kind === 'bit' ? await this.saidFor(row.id) : [];
        // Where the thing has GOT to, in one line. Shown INSTEAD of the words when there is one, so
        // the model is told what the bit has become without being handed sentences to reproduce.
        // `said` still travels, because it is what the verbatim guard is built from.
        const recap = row.kind === 'bit' ? await this.recapFor(row.id) : undefined;

        return {
            id: row.id,
            ...(chosen.beat === undefined ? {} : { beatId: chosen.beat.id }),
            story: {
                title: row.title,
                story: row.story,
                kind: row.kind as PersonaStoryKind,
                details: details.slice(0, PERSONA_STORY_DETAIL_LIMIT).map(detail => detail.detail),
                timesTold: Number(row.timesTold),
                ...(said.length === 0 ? {} : { said }),
                ...(recap === undefined ? {} : { recap }),
                ...(chosen.beat === undefined
                    ? {}
                    : {
                          beat: {
                              text: chosen.beat.text,
                              last: chosen.beat.last,
                              ...(chosen.beat.leftAt === undefined ? {} : { leftAt: chosen.beat.leftAt }),
                          },
                      }),
            },
        };
    }

    /**
     * What this character actually said the last few times it came back to a running bit.
     *
     * Told AND aired, because this is offered as somewhere the character has already been: a bit
     * written into a break that was dropped is one no listener has heard, and showing it back would
     * have the presenter refer to a joke nobody got.
     *
     * Two, which is a ceiling on the prompt rather than on the joke. Every line of history is a line
     * of "never name a record you were not given" further from the end of the turn, and two is
     * already enough to see where a thing has got to.
     *
     * Nothing here judges whether a telling was any GOOD, which is the same gap
     * `ScriptHistoryRepository.writtenBy` carries a comment about: a bit built on the one telling the
     * operator winced at is the character being taught to repeat what did not land. The clause is
     * one left join through `segment_id` to `deadair.script_ratings` once that table is read here.
     */
    private async saidFor(storyId: string, limit = 2): Promise<string[]> {
        const rows = await this.db
            .selectFrom('deadair.personaTellings')
            .select('said')
            .where('stationKey', '=', this.station.stationKey)
            .where('storyId', '=', storyId)
            .where('told', '=', true)
            .where('airedAt', 'is not', null)
            .where('said', 'is not', null)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .execute();

        return rows.flatMap(row => (row.said == null ? [] : [row.said]));
    }

    /** The newest recap for one story, or `undefined` for a bit nobody has summarised yet. */
    private async recapFor(storyId: string): Promise<string | undefined> {
        const row = await this.db
            .selectFrom('deadair.personaStoryRecaps')
            .select('recap')
            .where('stationKey', '=', this.station.stationKey)
            .where('storyId', '=', storyId)
            .orderBy('createdAt', 'desc')
            .executeTakeFirst();

        return row?.recap ?? undefined;
    }

    /**
     * Every bit this character has told enough times to be worth summarising, with its tellings.
     *
     * What the nightly pass reads to write a recap. `since` is how many aired tellings the newest
     * recap already covered, so a bit nothing has done with since is not summarised again — the
     * question is whether the character has MOVED it, not how long ago it last did.
     */
    async recappable(personaKey: string, minimum: number): Promise<{ id: string; title: string; story: string; said: string[] }[]> {
        const rows = await this.db
            .selectFrom('deadair.personaStories')
            .select([
                'id',
                'title',
                'story',
                sql<string>`(select count(*) from deadair.persona_tellings t where t.story_id = deadair.persona_stories.id and t.told and t.aired_at is not null)`.as(
                    'heard',
                ),
                sql<
                    string | null
                >`(select r.tellings from deadair.persona_story_recaps r where r.story_id = deadair.persona_stories.id order by r.created_at desc limit 1)`.as(
                    'covered',
                ),
            ])
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where('kind', '=', 'bit')
            .where('state', '=', 'active')
            .execute();

        const worth = rows.filter(row => Number(row.heard) >= minimum && Number(row.heard) > Number(row.covered ?? 0));
        if (worth.length === 0) return [];

        return await Promise.all(
            worth.map(async row => ({
                id: row.id,
                title: row.title,
                story: row.story,
                // The whole run rather than the last two: a recap exists to hold what a pair of
                // tellings cannot, which is where a joke has escalated to over its whole life.
                said: await this.saidFor(row.id, RECAP_TELLINGS),
            })),
        );
    }

    /** Writes a recap, which is append-only: the newest is the one that is read. */
    async addRecap(storyId: string, recap: string, tellings: number): Promise<void> {
        await this.db
            .insertInto('deadair.personaStoryRecaps')
            .values({ stationKey: this.station.stationKey, storyId, recap: recap.trim(), tellings })
            .execute();
    }

    /**
     * The tellable parts of several arcs, in order, each saying whether it has been heard.
     *
     * AIRED rather than written, which is the whole reason this is a join and not a column: a break
     * is planned up to eight items ahead of its slot and can be retracted in between, so a part
     * skipped on the strength of a break nobody heard is one nothing will ever offer again.
     */
    private async tellableBeats(storyIds: readonly string[]): Promise<Map<string, { id: string; beat: string; aired: boolean }[]>> {
        const out = new Map<string, { id: string; beat: string; aired: boolean }[]>();
        if (storyIds.length === 0) return out;

        const rows = await this.db
            .selectFrom('deadair.personaStoryBeats')
            .select([
                'id',
                'storyId',
                'beat',
                sql<boolean>`exists (select 1 from deadair.persona_tellings t where t.beat_id = deadair.persona_story_beats.id and t.told and t.aired_at is not null)`.as(
                    'aired',
                ),
            ])
            .where('storyId', 'in', [...storyIds])
            .where('state', '=', 'active')
            .orderBy('ordinal', 'asc')
            .orderBy('id', 'asc')
            .execute();

        for (const row of rows) {
            const beat = { id: row.id, beat: row.beat, aired: row.aired };
            const held = out.get(row.storyId);
            if (held === undefined) out.set(row.storyId, [beat]);
            else held.push(beat);
        }

        return out;
    }

    /**
     * Every story this character could tell, least recently told first.
     *
     * {@link forPrompt}'s answer widened to the whole shelf, for a caller writing SEVERAL breaks in
     * one pass. That caller cannot use `forPrompt`: it answers the same story every time until
     * somebody stamps it, and stamping is exactly what a caller that is not on air must not do — so
     * an audition of twenty transitions would otherwise offer one story twenty times and report a
     * character with one anecdote.
     *
     * Same filter and same order as `forPrompt`, so the story an audition sees first is the story
     * the next real break would get. Only `active` rows, so a proposal nobody has looked at cannot
     * reach even a preview.
     */
    async tellable(personaKey: string, limit = 20): Promise<PersonaStoryForPrompt[]> {
        const rows = await this.db
            .selectFrom('deadair.personaStories')
            .select(['id', 'title', 'story', TIMES_TOLD, LAST_CARRIED])
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where('state', '=', 'active')
            .orderBy(sql`last_carried asc nulls first`)
            .orderBy('createdAt', 'asc')
            .limit(limit)
            .execute();

        if (rows.length === 0) return [];

        const details = await this.detailsFor(
            rows.map(row => row.id),
            'active',
        );

        return rows.map(row => ({
            title: row.title,
            story: row.story,
            details: (details.get(row.id) ?? []).slice(0, PERSONA_STORY_DETAIL_LIMIT).map(detail => detail.detail),
            timesTold: Number(row.timesTold),
        }));
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
    async update(id: string, draft: { title: string; story: string; kind?: PersonaStoryKind }): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.personaStories')
            .set({
                title: draft.title.trim(),
                story: draft.story.trim(),
                ...(draft.kind === undefined ? {} : { kind: draft.kind }),
                updatedAt: sql`now()`,
            })
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

    /** Adds one part to an arc. */
    async addBeat(write: PersonaStoryBeatWrite): Promise<void> {
        await this.db.insertInto('deadair.personaStoryBeats').values(this.beatValuesFor(write)).execute();
    }

    /** Adds several, skipping any this arc already carries in the same words or at the same place. */
    async addBeats(writes: readonly PersonaStoryBeatWrite[]): Promise<number> {
        if (writes.length === 0) return 0;

        const written = await this.db
            .insertInto('deadair.personaStoryBeats')
            .values(writes.map(write => this.beatValuesFor(write)))
            .onConflict(conflict => conflict.doNothing())
            .returning('id')
            .execute();

        return written.length;
    }

    /** Rewrites one part's words, or moves it in the order. */
    async updateBeat(id: string, draft: { beat?: string; ordinal?: number }): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.personaStoryBeats')
            .set({
                ...(draft.beat === undefined ? {} : { beat: draft.beat.trim() }),
                ...(draft.ordinal === undefined ? {} : { ordinal: draft.ordinal }),
                updatedAt: sql`now()`,
            })
            .where('id', '=', id)
            .executeTakeFirst();

        return Number(result.numUpdatedRows) > 0;
    }

    /** Accepts a proposed part, or turns it down without losing that it was turned down. */
    async setBeatState(id: string, state: PersonaStoryState): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.personaStoryBeats')
            .set({ state, updatedAt: sql`now()` })
            .where('id', '=', id)
            .executeTakeFirst();

        return Number(result.numUpdatedRows) > 0;
    }

    /** Removes one part outright, leaving the arc it belonged to standing. */
    async removeBeat(id: string): Promise<boolean> {
        const result = await this.db.deleteFrom('deadair.personaStoryBeats').where('id', '=', id).executeTakeFirst();

        return Number(result.numDeletedRows) > 0;
    }

    /** Whether this arc already carries a part in these words, in any state including `rejected`. */
    async holdsBeat(storyId: string, beat: string): Promise<boolean> {
        const found = await this.db
            .selectFrom('deadair.personaStoryBeats')
            .select('id')
            .where('storyId', '=', storyId)
            .where(sql<boolean>`lower(btrim(beat)) = lower(btrim(${beat}))`)
            .executeTakeFirst();

        return found !== undefined;
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
     * What a rollback to this moment would take off the shelf.
     *
     * Same predicates as {@link rollbackAfter}, so a preview cannot promise one thing and do
     * another. See `PersonaNotesRepository.countAfter` for what `rejected` and `touched` are for.
     *
     * The detail count is what would be deleted DIRECTLY. A model story that is itself going takes
     * every detail hung on it, in any state and of any age, through the cascade — so the number an
     * operator sees is a floor rather than a total, and the service says so.
     */
    async countAfter(personaKey: string, to: string): Promise<{ stories: number; details: number; rejected: number; touched: number }> {
        const story = await this.db
            .selectFrom('deadair.personaStories')
            .select([
                sql<string>`count(*)`.as('stories'),
                sql<string>`count(*) filter (where state = 'rejected')`.as('rejected'),
                sql<string>`count(*) filter (where updated_at > created_at)`.as('touched'),
            ])
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where('origin', '=', 'model')
            .where(sql<boolean>`created_at > ${to}::timestamptz`)
            .executeTakeFirstOrThrow();

        // Through the story, because a detail carries neither a station nor a character of its own.
        const detail = await this.db
            .selectFrom('deadair.personaStoryDetails as detail')
            .innerJoin('deadair.personaStories as story', 'story.id', 'detail.storyId')
            .select(sql<string>`count(*)`.as('details'))
            .where('story.stationKey', '=', this.station.stationKey)
            .where('story.personaKey', '=', personaKey)
            .where('detail.origin', '=', 'model')
            .where(sql<boolean>`detail.created_at > ${to}::timestamptz`)
            .executeTakeFirstOrThrow();

        return {
            stories: Number(story.stories),
            details: Number(detail.details),
            rejected: Number(story.rejected),
            touched: Number(story.touched),
        };
    }

    /**
     * Undo what the STATION proposed onto this shelf after a moment, and nothing an operator wrote.
     *
     * Details first and stories second, which is not tidiness: a model detail hung on an OPERATOR's
     * story has no cascade to take it, so deleting the stories first would leave exactly the rows
     * this is for. Going the other way is safe in both directions, because a detail deleted here
     * and a detail deleted by the cascade are the same row gone.
     */
    async rollbackAfter(personaKey: string, to: string): Promise<{ stories: number; details: number }> {
        // Recaps first, and every one of them regardless of origin — a recap is not a claim somebody
        // made, it is the station's summary of tellings that are about to stop existing. Leaving one
        // behind would have a character carrying a description of a run nothing has any record of,
        // which is the one way this store can lie.
        await this.db
            .deleteFrom('deadair.personaStoryRecaps')
            .where('stationKey', '=', this.station.stationKey)
            .where(sql<boolean>`created_at > ${to}::timestamptz`)
            .where(({ eb, selectFrom }) =>
                eb(
                    'storyId',
                    'in',
                    selectFrom('deadair.personaStories')
                        .select('id')
                        .where('stationKey', '=', this.station.stationKey)
                        .where('personaKey', '=', personaKey),
                ),
            )
            .execute();

        const details = await this.db
            .deleteFrom('deadair.personaStoryDetails')
            .where('origin', '=', 'model')
            .where(sql<boolean>`created_at > ${to}::timestamptz`)
            .where(({ eb, selectFrom }) =>
                eb(
                    'storyId',
                    'in',
                    selectFrom('deadair.personaStories')
                        .select('id')
                        .where('stationKey', '=', this.station.stationKey)
                        .where('personaKey', '=', personaKey),
                ),
            )
            .executeTakeFirst();

        const stories = await this.db
            .deleteFrom('deadair.personaStories')
            .where('stationKey', '=', this.station.stationKey)
            .where('personaKey', '=', personaKey)
            .where('origin', '=', 'model')
            .where(sql<boolean>`created_at > ${to}::timestamptz`)
            .executeTakeFirst();

        return { stories: Number(stories.numDeletedRows), details: Number(details.numDeletedRows) };
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

    /**
     * The beats of several arcs at once, in telling order.
     *
     * One query for the whole page rather than one per arc, exactly as {@link detailsFor} is and for
     * the same reason.
     */
    private async beatsFor(storyIds: readonly string[], state?: PersonaStoryState): Promise<Map<string, PersonaStoryBeat[]>> {
        const out = new Map<string, PersonaStoryBeat[]>();
        if (storyIds.length === 0) return out;

        let query = this.db
            .selectFrom('deadair.personaStoryBeats')
            .selectAll()
            .where('storyId', 'in', [...storyIds])
            // The order the arc is told in. `id` behind it because gaps are legal and a pass writing
            // a batch in one statement can give two parts the same number before anybody tidies up.
            .orderBy('ordinal', 'asc')
            .orderBy('id', 'asc');

        if (state !== undefined) query = query.where('state', '=', state);

        for (const row of await query.execute()) {
            const beat: PersonaStoryBeat = {
                id: row.id,
                storyId: row.storyId,
                ordinal: Number(row.ordinal),
                beat: row.beat,
                state: row.state as PersonaStoryState,
                origin: row.origin as PersonaStoryOrigin,
                ...(row.source == null ? {} : { source: row.source }),
                createdAt: row.createdAt.toISO() ?? '',
            };

            const held = out.get(row.storyId);
            if (held === undefined) out.set(row.storyId, [beat]);
            else held.push(beat);
        }

        return out;
    }

    private valuesFor(write: PersonaStoryWrite) {
        return {
            stationKey: this.station.stationKey,
            personaKey: write.personaKey,
            title: write.title.trim(),
            story: write.story.trim(),
            // Absent means `anecdote`, which is what every story written before arcs existed is and
            // what somebody writing one about a night that happened means without saying so.
            ...(write.kind === undefined ? {} : { kind: write.kind }),
            state: write.state,
            origin: write.origin,
            source: write.source ?? null,
        };
    }

    private beatValuesFor(write: PersonaStoryBeatWrite) {
        return {
            storyId: write.storyId,
            ordinal: write.ordinal,
            beat: write.beat.trim(),
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

/**
 * How many tellings of a bit the nightly pass reads to summarise it.
 *
 * More than the two a prompt is ever shown, because that is the point of a recap: a pair of
 * tellings says where a joke is now and a recap says what it has become, and the second needs the
 * run. Bounded all the same — the pass has one model slot and a bit told fifty times would spend
 * it on the first forty.
 */
const RECAP_TELLINGS = 12;

/**
 * How often this story has actually gone out, off the ledger.
 *
 * Only rows the writer read back as TOLD. A story handed to a break that ignored it has not been
 * heard, and the prompt reads this number to decide whether to ask for a re-telling — "tell it the
 * way somebody tells a story twice" in front of a listener who has never heard it once is the
 * character misremembering its own life.
 */
const TIMES_TOLD = sql<string>`(select count(*) from deadair.persona_tellings t where t.story_id = deadair.persona_stories.id and t.told)`.as(
    'timesTold',
);

/**
 * When this story was last HANDED to anything, told or not.
 *
 * The rotation, and it counts carries rather than tellings deliberately: a story the model keeps
 * being offered and keeps passing over would otherwise stay at the front of the queue forever and
 * the rest of the shelf would never come round.
 */
const LAST_CARRIED = sql<string | null>`(select max(t.created_at) from deadair.persona_tellings t where t.story_id = deadair.persona_stories.id)`.as(
    'lastCarried',
);

/**
 * {@link LAST_CARRIED} as epoch milliseconds, which is what the eligibility rules compare.
 *
 * A number rather than a timestamp because `nextThread` is a pure function over plain values and
 * takes `now` as one too — the cadence gap is arithmetic, not a moment anybody hands back.
 */
const CARRIED_AT = sql<
    string | null
>`(select extract(epoch from max(t.created_at)) * 1000 from deadair.persona_tellings t where t.story_id = deadair.persona_stories.id)`.as(
    'carriedAt',
);

/** {@link TIMES_TOLD} under a name `selectAll` has not already taken. See {@link PersonaStoriesRepository.list}. */
const TOLD_COUNT = sql<string>`(select count(*) from deadair.persona_tellings t where t.story_id = deadair.persona_stories.id and t.told)`.as(
    'toldCount',
);

/**
 * When this story was last told, as TEXT, for the console.
 *
 * Text rather than a timestamp for `PersonaTelling.at`'s reason: these are the same moments the
 * timeline reports and a rollback is chosen against, and a value that went through a `DateTime`
 * would no longer compare against the row it came from.
 */
const TOLD_AT = sql<
    string | null
>`(select max(t.created_at)::text from deadair.persona_tellings t where t.story_id = deadair.persona_stories.id and t.told)`.as('toldAt');
