import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import type {
    PersonaNoteList,
    PersonaNoteState as PersonaNoteStateInput,
    PersonaNoteWrite as PersonaNoteWriteInput,
} from './types/personas.types.js';
import { PersonaRepository } from './persona.repository.js';
import { PersonaNotesRepository } from './persona.notes.repository.js';

/**
 * The operator's surface over what each character has accumulated.
 *
 * ## Every mutation answers the whole notebook
 *
 * `PersonasService`' rule one level down, and for a reason that is sharper here: accepting a proposal
 * moves a row between two sections of the same panel, so a caller handed back only the row it named
 * is holding a list it has to refetch to draw.
 *
 * ## An operator's note is ACTIVE and a model's is proposed, and only the second is a decision
 *
 * Nothing here can create a `suggested` note. An operator writing a line about their own character
 * has already made the judgement a proposal exists to ask for, and a form that offered them a
 * "propose this to myself" state would be asking a question with one answer. The distil pass is the
 * only writer of proposals, which is also what makes "there is something to look at" a fact about the
 * machine rather than about the page.
 *
 * ## Turning a proposal down is a STATE, and deleting it is not the same thing
 *
 * `rejected` outlives the pass that proposed it, which is the whole reason the column exists: the
 * distil pass re-reads the same scripts and a deleted proposal comes back forever. So the console
 * offers both, and they mean different things — reject what the station suggested, delete what you
 * wrote yourself.
 */
@Injectable()
export class PersonaNotesService {
    constructor(
        private readonly personas: PersonaRepository,
        private readonly notes: PersonaNotesRepository,
    ) {}

    /** Everything one character holds, in every state, oldest first. */
    async list(id: string): Promise<PersonaNoteList> {
        return await this.answer(await this.keyFor(id), id);
    }

    /** Writes one an operator typed. Active from the moment it exists; see the class note. */
    async create(id: string, write: PersonaNoteWriteInput): Promise<PersonaNoteList> {
        const personaKey = await this.keyFor(id);

        // Asked before the insert rather than caught after it, because the partial unique index does
        // not cover `rejected` and the honest answer to "you already turned this down" is not the
        // same as "you already have this". Both are 409 and the sentence is what an operator reads.
        if (await this.notes.holds(personaKey, write.note))
            throw httpError(409).withDetails({ message: `this character already has a note in those words` });

        await this.notes.add({ personaKey, kind: write.kind, note: write.note, state: 'active', origin: 'operator' });
        return await this.answer(personaKey, id);
    }

    /** Rewrites one note's words, whoever wrote it. Editing a proposal is most of the point of the panel. */
    async update(id: string, noteId: string, write: PersonaNoteWriteInput): Promise<PersonaNoteList> {
        const personaKey = await this.keyFor(id);

        if (!(await this.notes.update(noteId, write.note))) throw httpError(404).withDetails({ message: `note "${noteId}" does not exist` });

        return await this.answer(personaKey, id);
    }

    /** Accepts a proposal, turns one down, or rests an active note without losing it. */
    async setState(id: string, noteId: string, input: PersonaNoteStateInput): Promise<PersonaNoteList> {
        const personaKey = await this.keyFor(id);

        if (!(await this.notes.setState(noteId, input.state))) throw httpError(404).withDetails({ message: `note "${noteId}" does not exist` });

        return await this.answer(personaKey, id);
    }

    /** Removes one outright. Turning down a PROPOSAL is `setState` instead; see the class note. */
    async remove(id: string, noteId: string): Promise<PersonaNoteList> {
        const personaKey = await this.keyFor(id);

        if (!(await this.notes.remove(noteId))) throw httpError(404).withDetails({ message: `note "${noteId}" does not exist` });

        return await this.answer(personaKey, id);
    }

    /**
     * The persona's KEY from the id in the path.
     *
     * The route names a persona by id because that is what every other route in the file does and
     * what the console holds, while the notes themselves are keyed by the persona's key — which is
     * the stable name, and the one `script_history` records. This is the one place the two meet, so
     * nothing else has to know both.
     */
    private async keyFor(id: string): Promise<string> {
        const persona = await this.personas.find(id);
        if (persona === undefined) throw httpError(404).withDetails({ message: `persona "${id}" does not exist` });

        return persona.key;
    }

    private async answer(personaKey: string, personaId: string): Promise<PersonaNoteList> {
        return { personaId, notes: await this.notes.list(personaKey) };
    }
}
