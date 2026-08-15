import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type { Persona, PersonaInput, PersonaList } from './types/personas.types.js';

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
     * @name Restore station personas
     * @description Writes back whichever of the station's own personas this station is missing, touching nothing it already has and putting nothing on air
     */
    async restoreStationPersonas(): Promise<PersonaList> {
        const result = await this.fetch(`/personas/restore`, { method: 'POST' });
        return await parseJson<PersonaList>(result);
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
}
