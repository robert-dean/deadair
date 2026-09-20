import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import type {
    PersonaStoryBeatWrite as PersonaStoryBeatWriteInput,
    PersonaStoryDetailWrite as PersonaStoryDetailWriteInput,
    PersonaStoryList,
    PersonaStoryState as PersonaStoryStateInput,
    PersonaStoryWrite as PersonaStoryWriteInput,
} from './types/personas.types.js';
import { PersonaRepository } from './persona.repository.js';
import { PersonaStoriesRepository } from './persona.stories.repository.js';

/**
 * The operator's surface over what has happened to each character.
 *
 * `PersonaNotesService`' shape one table over, and everything true there is true here: every mutation
 * answers the whole list because accepting a proposal moves a row between two sections of one panel;
 * an operator's own story is tellable from the moment it exists, because somebody writing about their
 * own character has already made the judgement a proposal exists to ask for; and turning one DOWN is
 * a state rather than a deletion, because the enrichment pass reads the same catalogue back and a
 * deleted proposal comes round forever.
 *
 * ## The details are the half that is new
 *
 * A story grows, so it has children, and they carry the same three states for the same reason. What
 * an operator actually wants to turn down is usually not the story but the one clause a model hung on
 * it — "and the radio in the truck went to static a mile before" — which is exactly what a row per
 * detail makes possible and a rewritten telling does not.
 *
 * Every detail route names its story in the path even though the id would be enough, because the
 * answer is the whole list either way and a detail that belongs to another character's story is a
 * request that should 404 rather than quietly succeed.
 */
@Injectable()
export class PersonaStoriesService {
    constructor(
        private readonly personas: PersonaRepository,
        private readonly stories: PersonaStoriesRepository,
    ) {}

    /** Everything one character holds, in every state, oldest first. */
    async list(id: string): Promise<PersonaStoryList> {
        return await this.answer(await this.keyFor(id), id);
    }

    /** Writes one an operator typed. Tellable from the moment it exists; see the class note. */
    async create(id: string, write: PersonaStoryWriteInput): Promise<PersonaStoryList> {
        const personaKey = await this.keyFor(id);

        // Asked before the insert rather than caught after it, because the partial unique index does
        // not cover `rejected` and "you already turned this one down" is not the same sentence as
        // "you already have this". Both are 409 and the words are what an operator reads.
        if (await this.stories.holds(personaKey, write.title))
            throw httpError(409).withDetails({ message: `this character already has a story called "${write.title}"` });

        await this.stories.add({
            personaKey,
            title: write.title,
            story: write.story,
            // Absent means `anecdote`, which is what the column defaults to and what somebody
            // writing about a night that happened means without being asked.
            ...(write.kind === undefined ? {} : { kind: write.kind }),
            state: 'active',
            origin: 'operator',
        });
        return await this.answer(personaKey, id);
    }

    /** Rewrites one story's handle and telling. Editing what the pass proposed is most of the point. */
    async update(id: string, storyId: string, write: PersonaStoryWriteInput): Promise<PersonaStoryList> {
        const personaKey = await this.keyFor(id);
        await this.holding(personaKey, storyId);

        // The kind can change, which is how an anecdote somebody has thought better of becomes an
        // arc. Going the other way leaves any beats where they are rather than deleting them: they
        // stop being read, and an operator who changes their mind back has not lost the writing.
        await this.stories.update(storyId, { title: write.title, story: write.story, ...(write.kind === undefined ? {} : { kind: write.kind }) });
        return await this.answer(personaKey, id);
    }

    /** Accepts a proposal, turns one down, or rests a story without losing it. */
    async setState(id: string, storyId: string, input: PersonaStoryStateInput): Promise<PersonaStoryList> {
        const personaKey = await this.keyFor(id);
        await this.holding(personaKey, storyId);

        await this.stories.setState(storyId, input.state);
        return await this.answer(personaKey, id);
    }

    /** Removes one outright, details and all. Turning down a PROPOSAL is `setState`; see the class note. */
    async remove(id: string, storyId: string): Promise<PersonaStoryList> {
        const personaKey = await this.keyFor(id);
        await this.holding(personaKey, storyId);

        await this.stories.remove(storyId);
        return await this.answer(personaKey, id);
    }

    /** Adds one thing to a story that already exists. Active, for an operator's own reason above. */
    async addDetail(id: string, storyId: string, write: PersonaStoryDetailWriteInput): Promise<PersonaStoryList> {
        const personaKey = await this.keyFor(id);
        await this.holding(personaKey, storyId);

        if (await this.stories.holdsDetail(storyId, write.detail))
            throw httpError(409).withDetails({ message: 'this story already carries that detail' });

        await this.stories.addDetail({ storyId, detail: write.detail, state: 'active', origin: 'operator' });
        return await this.answer(personaKey, id);
    }

    /** Rewrites one detail's words. */
    async updateDetail(id: string, storyId: string, detailId: string, write: PersonaStoryDetailWriteInput): Promise<PersonaStoryList> {
        const personaKey = await this.keyFor(id);
        await this.holdingDetail(personaKey, storyId, detailId);

        await this.stories.updateDetail(detailId, write.detail);
        return await this.answer(personaKey, id);
    }

    /** Accepts a proposed detail or turns it down, which has to outlive the pass that proposed it. */
    async setDetailState(id: string, storyId: string, detailId: string, input: PersonaStoryStateInput): Promise<PersonaStoryList> {
        const personaKey = await this.keyFor(id);
        await this.holdingDetail(personaKey, storyId, detailId);

        await this.stories.setDetailState(detailId, input.state);
        return await this.answer(personaKey, id);
    }

    /** Removes one detail, leaving the story it was hung on alone. */
    async removeDetail(id: string, storyId: string, detailId: string): Promise<PersonaStoryList> {
        const personaKey = await this.keyFor(id);
        await this.holdingDetail(personaKey, storyId, detailId);

        await this.stories.removeDetail(detailId);
        return await this.answer(personaKey, id);
    }

    /**
     * Adds one part to an arc. Active, for an operator's own reason above.
     *
     * Only an ARC may have parts, and that is checked rather than assumed: a beat on an anecdote
     * would be a row nothing ever reads, which is the kind of state that is discovered months later
     * by somebody wondering why their story never advances.
     */
    async addBeat(id: string, storyId: string, write: PersonaStoryBeatWriteInput): Promise<PersonaStoryList> {
        const personaKey = await this.keyFor(id);
        const story = await this.holding(personaKey, storyId);

        if (story.kind !== 'arc') throw httpError(409).withDetails({ message: 'only an arc is told in parts' });

        if (await this.stories.holdsBeat(storyId, write.beat))
            throw httpError(409).withDetails({ message: 'this arc already has a part in those words' });

        await this.stories.addBeat({ storyId, ordinal: write.ordinal, beat: write.beat, state: 'active', origin: 'operator' });
        return await this.answer(personaKey, id);
    }

    /** Rewrites one part's words, or moves it in the order. */
    async updateBeat(id: string, storyId: string, beatId: string, write: PersonaStoryBeatWriteInput): Promise<PersonaStoryList> {
        const personaKey = await this.keyFor(id);
        await this.holdingBeat(personaKey, storyId, beatId);

        await this.stories.updateBeat(beatId, { beat: write.beat, ordinal: write.ordinal });
        return await this.answer(personaKey, id);
    }

    /** Accepts a proposed part or turns it down, which has to outlive the pass that proposed it. */
    async setBeatState(id: string, storyId: string, beatId: string, input: PersonaStoryStateInput): Promise<PersonaStoryList> {
        const personaKey = await this.keyFor(id);
        await this.holdingBeat(personaKey, storyId, beatId);

        await this.stories.setBeatState(beatId, input.state);
        return await this.answer(personaKey, id);
    }

    /** Removes one part, leaving the arc it belonged to standing. */
    async removeBeat(id: string, storyId: string, beatId: string): Promise<PersonaStoryList> {
        const personaKey = await this.keyFor(id);
        await this.holdingBeat(personaKey, storyId, beatId);

        await this.stories.removeBeat(beatId);
        return await this.answer(personaKey, id);
    }

    /**
     * The persona's KEY from the id in the path.
     *
     * The route names a persona by id because that is what every other route in the file does and
     * what the console holds, while the stories themselves are keyed by the persona's key — the
     * stable name, and the one a story survives a delete-and-restore under. This is the one place the
     * two meet.
     */
    private async keyFor(id: string): Promise<string> {
        const persona = await this.personas.find(id);
        if (persona === undefined) throw httpError(404).withDetails({ message: `persona "${id}" does not exist` });

        return persona.key;
    }

    /** The story, or a 404. Checked against the CHARACTER, so one id cannot reach another's shelf. */
    private async holding(personaKey: string, storyId: string) {
        const story = await this.stories.find(personaKey, storyId);
        if (story === undefined) throw httpError(404).withDetails({ message: `story "${storyId}" does not exist` });

        return story;
    }

    /** The same for a detail, which has to belong to the story that was named as well. */
    private async holdingBeat(personaKey: string, storyId: string, beatId: string) {
        const story = await this.holding(personaKey, storyId);
        const beat = story.beats.find(held => held.id === beatId);
        if (beat === undefined) throw httpError(404).withDetails({ message: `beat "${beatId}" does not exist` });

        return beat;
    }

    private async holdingDetail(personaKey: string, storyId: string, detailId: string) {
        const story = await this.holding(personaKey, storyId);
        const detail = story.details.find(held => held.id === detailId);
        if (detail === undefined) throw httpError(404).withDetails({ message: `detail "${detailId}" does not exist` });

        return detail;
    }

    private async answer(personaKey: string, personaId: string): Promise<PersonaStoryList> {
        return { personaId, stories: await this.stories.list(personaKey) };
    }
}
