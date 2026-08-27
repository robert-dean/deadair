import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { httpError } from '@maroonedsoftware/errors';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { PersonaRepository } from './persona.repository.js';
import { PersonaStoriesRepository } from './persona.stories.repository.js';
import { PERSONA_FILE_FORMAT, personaForFile } from './persona.file.js';
import type { PersonaFile } from './types/personas.types.js';

/**
 * Handing a character over: the whole roster, or one of them.
 *
 * Read-only, and the one thing in the import/export seam that can be built on its own — an operator
 * who only ever gets this half still has something worth having, which is why it is the first phase.
 *
 * ## One shape for one and for many
 *
 * Both routes answer a {@link PersonaFile} carrying an array, rather than a single character having a
 * shape of its own. A file is a file: the console can concatenate two exports by hand, an operator can
 * delete a persona out of a roster file in a text editor, and the phase-2 preview has one thing to
 * parse instead of two. The only difference between the two routes is how many entries come back and
 * what the download is called.
 *
 * ## Why it is not on `PersonasService`
 *
 * That class is the operator's surface over the table and every method on it answers the whole list,
 * because every mutation there can change more than the row it names. Nothing here mutates anything,
 * nothing here answers a list of rows, and the import half that lands beside this will reach further
 * still — into the stories service and the pad library. Two services with two jobs, rather than one
 * that has to explain which of its methods are about the table and which are about a file.
 */
@Injectable()
export class PersonaExportService {
    constructor(
        private readonly personas: PersonaRepository,
        private readonly stories: PersonaStoriesRepository,
        private readonly station: StationIdentity,
    ) {}

    /** Every character this station holds, callers included, in the order the table lists them. */
    async exportPersonas(): Promise<{ body: PersonaFile; headers: { contentDisposition: string } }> {
        const personas = await this.personas.list();
        const entries = await Promise.all(personas.map(async persona => personaForFile(persona, await this.stories.list(persona.key))));

        return this.answer(entries, 'personas');
    }

    /**
     * One character, named by the row's id because that is what the console is holding.
     *
     * The ID identifies the row for this request and never appears in what comes back: what crosses
     * between two installs is the `key`. See `persona.file.ts`.
     *
     * @throws 404 for an id this station does not hold, rather than an empty file — a file with no
     * characters in it is a valid document and would look like an export that worked.
     */
    async exportPersona(id: string): Promise<{ body: PersonaFile; headers: { contentDisposition: string } }> {
        const persona = await this.personas.find(id);
        if (persona === undefined) throw httpError(404).withDetails({ message: `persona "${id}" does not exist` });

        const entry = personaForFile(persona, await this.stories.list(persona.key));
        return this.answer([entry], persona.key);
    }

    /**
     * The envelope, and the name the browser saves it under.
     *
     * `takenAt` is ISO-8601 rather than a Luxon object because this document is written to disk and
     * read back by something that is not this process — the plugin SDK's JSON-safe rule, applied here
     * for its original reason rather than by analogy.
     *
     * The filename is dated because the whole point of keeping one is having more than one, and two
     * downloads called `personas.json` are a downloads folder with `personas (3).json` in it. The date
     * alone rather than the time: a second export in the same minute is the same character, and an
     * operator who wants both can rename one.
     */
    private answer(personas: PersonaFile['personas'], name: string): { body: PersonaFile; headers: { contentDisposition: string } } {
        const takenAt = DateTime.utc();

        return {
            body: {
                format: PERSONA_FILE_FORMAT,
                takenAt: takenAt.toISO(),
                station: this.station.stationKey,
                personas,
            },
            headers: { contentDisposition: `attachment; filename="${safeFileName(name)}-${takenAt.toFormat('yyyy-LL-dd')}.json"` },
        };
    }
}

/**
 * A persona key as a filename.
 *
 * A key is a slug in practice and free text in the column, so this is a guard rather than a
 * formality: a `"` or a `/` in a `Content-Disposition` filename is a header somebody else's browser
 * gets to interpret. Anything that is not a plain slug character becomes a dash, and a name left with
 * nothing falls back to the generic one rather than to an empty filename.
 */
function safeFileName(name: string): string {
    const safe = name
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return safe.length === 0 ? 'persona' : safe;
}
