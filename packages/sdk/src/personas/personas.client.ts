import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type {
    GeneratedPersona,
    Persona,
    PersonaFile,
    PersonaImportPlan,
    PersonaImportResult,
    PersonaInput,
    PersonaList,
    PersonaNoteList,
    PersonaNoteState,
    PersonaNoteWrite,
    PersonaRehearsal,
    PersonaRequest,
    PersonaStoryDetailWrite,
    PersonaStoryList,
    PersonaStoryState,
    PersonaStoryWrite,
} from './types/personas.types.js';

export class PersonasClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List personas
     * @description Every persona this station has, oldest first
     */
    async listPersonas(): Promise<PersonaList> {
        const result = await this.fetch(`/personas`, { method: 'GET' });
        return await parseJson<PersonaList>(result);
    }

    /**
     * @name Create persona
     * @description Writes a new persona. It is not put on air by creating it
     */
    async createPersona(body: PersonaInput): Promise<PersonaList> {
        const result = await this.fetch(`/personas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PersonaList>(result);
    }

    /**
     * @name Generate persona
     * @description Turns a description of a character into a whole persona, checked against its own sample lines and handed back unsaved
     */
    async generatePersona(body: PersonaRequest): Promise<GeneratedPersona> {
        const result = await this.fetch(`/personas/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<GeneratedPersona>(result);
    }

    /**
     * @name Restore station personas
     * @description Writes back whichever of the station's own personas this station is missing, touching nothing it already has and putting nothing on air
     */
    async restoreStationPersonas(): Promise<PersonaList> {
        const result = await this.fetch(`/personas/restore`, { method: 'POST' });
        return await parseJson<PersonaList>(result);
    }

    /**
     * @name Export personas
     * @description Every character this station holds, as one file
     */
    async exportPersonas(): Promise<{ data: PersonaFile; headers: { contentDisposition?: string } }> {
        const result = await this.fetch(`/personas/export`, { method: 'GET' });
        const data = await parseJson<PersonaFile>(result);
        return { data, headers: { contentDisposition: result.headers.get('Content-Disposition') ?? undefined } };
    }

    /**
     * @name Export persona
     * @description One character, its sheet and its stories, as a file
     */
    async exportPersona(id: string): Promise<{ data: PersonaFile; headers: { contentDisposition?: string } }> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/export`, { method: 'GET' });
        const data = await parseJson<PersonaFile>(result);
        return { data, headers: { contentDisposition: result.headers.get('Content-Disposition') ?? undefined } };
    }

    /**
     * @name Preview persona import
     * @description Reads a file and reports what importing it would create, rewrite and skip. Writes nothing
     */
    async previewPersonaImport(body: PersonaFile): Promise<PersonaImportPlan> {
        const result = await this.fetch(`/personas/import/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PersonaImportPlan>(result);
    }

    /**
     * @name Import personas
     * @description Writes a file into this station, merging by key, and answers with what it did
     */
    async importPersonas(body: PersonaFile): Promise<PersonaImportResult> {
        const result = await this.fetch(`/personas/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PersonaImportResult>(result);
    }

    /**
     * @name Update persona
     * @description Rewrites one persona. An edit to the one on air is heard on the next break
     */
    async updatePersona(id: string, body: PersonaInput): Promise<PersonaList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PersonaList>(result);
    }

    /**
     * @name Delete persona
     * @description Removes a persona, including the one on air, which leaves the station with none
     */
    async deletePersona(id: string): Promise<PersonaList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return await parseJson<PersonaList>(result);
    }

    /**
     * @name Put persona on air
     * @description Puts this persona on air and takes the previous one off
     */
    async putPersonaOnAir(id: string): Promise<PersonaList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/active`, { method: 'PUT' });
        return await parseJson<PersonaList>(result);
    }

    /**
     * @name List persona notes
     * @description Everything this character has accumulated, oldest first, in every state
     */
    async listPersonaNotes(id: string): Promise<PersonaNoteList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/notes`, { method: 'GET' });
        return await parseJson<PersonaNoteList>(result);
    }

    /**
     * @name Write persona note
     * @description Writes a note by hand. An operator's own note is active from the moment it exists; only the distil pass proposes
     */
    async writePersonaNote(id: string, body: PersonaNoteWrite): Promise<PersonaNoteList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PersonaNoteList>(result);
    }

    /**
     * @name Update persona note
     * @description Rewrites one note's words, whoever wrote it. Editing what the station proposed is most of the point of the panel
     */
    async updatePersonaNote(id: string, noteId: string, body: PersonaNoteWrite): Promise<PersonaNoteList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PersonaNoteList>(result);
    }

    /**
     * @name Delete persona note
     * @description Removes a note outright. Turning down a PROPOSAL is a state rather than this, or the next pass writes it again
     */
    async deletePersonaNote(id: string, noteId: string): Promise<PersonaNoteList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
        return await parseJson<PersonaNoteList>(result);
    }

    /**
     * @name Set persona note state
     * @description Accepts a proposal, turns one down, or rests an active note. Mirrors the lexicon's own state route
     */
    async setPersonaNoteState(id: string, noteId: string, body: PersonaNoteState): Promise<PersonaNoteList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}/state`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PersonaNoteList>(result);
    }

    /**
     * @name List persona stories
     * @description Every story this character holds, oldest first, in every state
     */
    async listPersonaStories(id: string): Promise<PersonaStoryList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/stories`, { method: 'GET' });
        return await parseJson<PersonaStoryList>(result);
    }

    /**
     * @name Write persona story
     * @description Writes a story by hand. An operator's own is tellable from the moment it exists; only the enrichment pass proposes
     */
    async writePersonaStory(id: string, body: PersonaStoryWrite): Promise<PersonaStoryList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/stories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PersonaStoryList>(result);
    }

    /**
     * @name Update persona story
     * @description Rewrites one story's handle and telling, whoever wrote it
     */
    async updatePersonaStory(id: string, storyId: string, body: PersonaStoryWrite): Promise<PersonaStoryList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/stories/${encodeURIComponent(storyId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PersonaStoryList>(result);
    }

    /**
     * @name Delete persona story
     * @description Removes a story outright, details and all. Turning down a PROPOSAL is a state rather than this, or the next pass writes it again
     */
    async deletePersonaStory(id: string, storyId: string): Promise<PersonaStoryList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/stories/${encodeURIComponent(storyId)}`, { method: 'DELETE' });
        return await parseJson<PersonaStoryList>(result);
    }

    /**
     * @name Set persona story state
     * @description Accepts a proposal, turns one down, or takes a story out of the rotation without losing it
     */
    async setPersonaStoryState(id: string, storyId: string, body: PersonaStoryState): Promise<PersonaStoryList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/stories/${encodeURIComponent(storyId)}/state`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PersonaStoryList>(result);
    }

    /**
     * @name Add persona story detail
     * @description Adds one thing to a story that already exists
     */
    async addPersonaStoryDetail(id: string, storyId: string, body: PersonaStoryDetailWrite): Promise<PersonaStoryList> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/stories/${encodeURIComponent(storyId)}/details`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PersonaStoryList>(result);
    }

    /**
     * @name Update persona story detail
     * @description Rewrites one detail's words
     */
    async updatePersonaStoryDetail(id: string, storyId: string, detailId: string, body: PersonaStoryDetailWrite): Promise<PersonaStoryList> {
        const result = await this.fetch(
            `/personas/${encodeURIComponent(id)}/stories/${encodeURIComponent(storyId)}/details/${encodeURIComponent(detailId)}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body, bigIntReplacer),
            },
        );
        return await parseJson<PersonaStoryList>(result);
    }

    /**
     * @name Delete persona story detail
     * @description Removes one detail, leaving the story it was hung on alone
     */
    async deletePersonaStoryDetail(id: string, storyId: string, detailId: string): Promise<PersonaStoryList> {
        const result = await this.fetch(
            `/personas/${encodeURIComponent(id)}/stories/${encodeURIComponent(storyId)}/details/${encodeURIComponent(detailId)}`,
            { method: 'DELETE' },
        );
        return await parseJson<PersonaStoryList>(result);
    }

    /**
     * @name Set persona story detail state
     * @description Accepts a proposed detail or turns it down, which has to outlive the pass that proposed it
     */
    async setPersonaStoryDetailState(id: string, storyId: string, detailId: string, body: PersonaStoryState): Promise<PersonaStoryList> {
        const result = await this.fetch(
            `/personas/${encodeURIComponent(id)}/stories/${encodeURIComponent(storyId)}/details/${encodeURIComponent(detailId)}/state`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body, bigIntReplacer),
            },
        );
        return await parseJson<PersonaStoryList>(result);
    }

    /**
     * @name Rehearse persona
     * @description Writes a talk break under this persona against two fixed invented records, and answers with every writer that was asked
     */
    async rehearsePersona(id: string): Promise<PersonaRehearsal> {
        const result = await this.fetch(`/personas/${encodeURIComponent(id)}/rehearse`, { method: 'POST' });
        return await parseJson<PersonaRehearsal>(result);
    }
}
