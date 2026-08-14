import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import type { Persona as PersonaView, PersonaInput, PersonaList } from './types/personas.types.js';
import type { Persona, PersonaDraft } from './persona.js';
import { PersonaRepository } from './persona.repository.js';
import { SEED_PERSONAS } from './persona.defaults.js';

/**
 * The operator's surface over who the station is.
 *
 * ## Every mutation answers the whole list
 *
 * Because every mutation can change more than the row it names. Putting one persona on air takes
 * another off, and deleting the active one leaves the station with none — so a caller handed back
 * only the row it touched would be holding a list it has to fetch again to draw.
 *
 * ## Which persona is seeded active, and why seeding is guarded on emptiness
 *
 * A fresh station gets the four in `persona.defaults.ts` with the classic host on air, so it sounds
 * like a station before an operator has opened this page at all. The guard is that the station has
 * NO personas rather than that each key is missing, which is the difference between a seed and a
 * default: an operator who deleted the pirate meant it, and a boot that put it back would make
 * deleting one impossible to express.
 */
@Injectable()
export class PersonasService {
    constructor(
        private readonly personas: PersonaRepository,
        private readonly logger: Logger,
    ) {}

    async list(): Promise<PersonaList> {
        return this.answer();
    }

    async create(body: PersonaInput): Promise<PersonaList> {
        await this.write(body.key, () => this.personas.create(draftOf(body)));
        this.logger.info('personas: an operator wrote a persona', { key: body.key });

        return this.answer();
    }

    async update(id: string, body: PersonaInput): Promise<PersonaList> {
        const updated = await this.write(body.key, () => this.personas.update(id, draftOf(body)));
        if (updated === undefined) throw httpError(404).withDetails({ message: `persona "${id}" does not exist` });

        this.logger.info('personas: an operator edited a persona', { key: updated.key, onAir: updated.active });
        return this.answer();
    }

    async remove(id: string): Promise<PersonaList> {
        if (!(await this.personas.remove(id))) throw httpError(404).withDetails({ message: `persona "${id}" does not exist` });

        this.logger.info('personas: an operator deleted a persona', { persona: id });
        return this.answer();
    }

    async setActive(id: string): Promise<PersonaList> {
        const active = await this.personas.setActive(id);
        if (active === undefined) throw httpError(404).withDetails({ message: `persona "${id}" does not exist` });

        this.logger.info('personas: the station changed character', { key: active.key });
        return this.answer();
    }

    /**
     * Write the seeds on a station that has none.
     *
     * Called from `ready()` rather than from the migration, so the sheets have ONE source: a SQL
     * copy of the four would be a second place they are written and would drift from the TypeScript
     * the prompt renderer actually reads. A failure here is caught by the module, because a station
     * with no personas is an ordinary state everything downstream already handles.
     */
    async seed(): Promise<void> {
        const written = await this.personas.seed(SEED_PERSONAS, 'classic');
        if (written > 0) this.logger.info('personas: seeded a station that had none', { written });
    }

    private async answer(): Promise<PersonaList> {
        return { personas: (await this.personas.list()).map(toView) };
    }

    /**
     * A write, with a taken key answered as a conflict rather than as a crash.
     *
     * The key is unique per station in the database, which is where it belongs — but a constraint
     * violation reaching a console is a 500 and the sentence "Internal Server Error", and the
     * operator's actual mistake is one they can fix in the field they are looking at. Caught rather
     * than pre-checked, because a read followed by a write would still race and would still have to
     * handle this.
     */
    private async write<T>(key: string, work: () => Promise<T>): Promise<T> {
        try {
            return await work();
        } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            throw httpError(409).withDetails({ message: `this station already has a persona called "${key}"` });
        }
    }
}

/** Postgres's `unique_violation`. Narrowed by code rather than by message, which is localised. */
function isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505';
}

/**
 * A submitted persona as a draft.
 *
 * `id` and `active` are `readonly` in the contract and so are absent from what a client may send;
 * `active` moves only through {@link PersonasService.setActive}, which is what keeps "one persona is
 * on air" a fact the database enforces rather than one every write has to remember.
 */
function draftOf(body: PersonaInput): PersonaDraft {
    const text = (value: string | undefined): string | undefined => {
        const trimmed = value?.trim();
        return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
    };
    const list = (values: string[] | undefined): readonly string[] | undefined => (values === undefined || values.length === 0 ? undefined : values);

    return {
        key: body.key,
        label: body.label,
        style: body.style,
        ...omitUndefined({
            djName: text(body.djName),
            voice: text(body.voice),
            background: text(body.background),
            templates: text(body.templates),
            music: text(body.music),
            diction: list(body.diction),
            dictionMarkers: list(body.dictionMarkers),
            quirks: list(body.quirks),
            catchphrases: list(body.catchphrases),
            avoid: list(body.avoid),
            samples: list(body.samples),
        }),
    };
}

function toView(persona: Persona): PersonaView {
    return {
        id: persona.id,
        key: persona.key,
        label: persona.label,
        style: persona.style,
        active: persona.active,
        ...omitUndefined({
            djName: persona.djName,
            voice: persona.voice,
            background: persona.background,
            templates: persona.templates,
            music: persona.music,
            diction: mutable(persona.diction),
            dictionMarkers: mutable(persona.dictionMarkers),
            quirks: mutable(persona.quirks),
            catchphrases: mutable(persona.catchphrases),
            avoid: mutable(persona.avoid),
            samples: mutable(persona.samples),
        }),
    };
}

const mutable = (values: readonly string[] | undefined): string[] | undefined => (values === undefined ? undefined : [...values]);

/** Drop the keys that are `undefined`, so an optional field is absent rather than explicitly empty. */
function omitUndefined<T extends Record<string, unknown>>(values: T): Partial<T> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}
