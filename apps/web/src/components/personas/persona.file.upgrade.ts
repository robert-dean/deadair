import type { PersonaFile } from '@deadair/sdk';

/** What the station writes now, and what a file of the shape before it says it is. */
export const PERSONA_FILE_FORMAT = 'deadair.persona/2';
const FIRST_FORMAT = 'deadair.persona/1';

/**
 * A parsed persona file, in the shape the station takes today.
 *
 * A quirk was a string in a `deadair.persona/1` file and is `{ text, cadence }` since, and the import
 * route validates the new shape: a station's own old export would otherwise be refused as malformed by
 * the build that wrote it. So a string quirk becomes the `always` quirk it always was, and the file is
 * stamped `/2`, since it now IS one and the preview's "this file says it is something else" notice
 * would be a false alarm about a conversion that cannot go wrong.
 *
 * Anything else is passed through untouched for the route to judge, including a file that is not a
 * persona file at all: what to refuse, and how to say so, is the API's.
 */
export function upgradePersonaFile(parsed: unknown): PersonaFile {
    if (typeof parsed !== 'object' || parsed === null) return parsed as PersonaFile;

    const file = parsed as { format?: unknown; personas?: unknown };
    if (file.format !== FIRST_FORMAT || !Array.isArray(file.personas)) return parsed as PersonaFile;

    return {
        ...file,
        format: PERSONA_FILE_FORMAT,
        personas: file.personas.map(persona => {
            if (typeof persona !== 'object' || persona === null) return persona;

            const { quirks } = persona as { quirks?: unknown };
            if (!Array.isArray(quirks)) return persona;

            return { ...persona, quirks: quirks.map(quirk => (typeof quirk === 'string' ? { text: quirk } : quirk)) };
        }),
    } as PersonaFile;
}
