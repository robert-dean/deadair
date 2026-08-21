import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { AfterCommit } from '#modules/data/after.commit.js';
import { DirectorService } from '#modules/director/director.service.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { errorText } from '#modules/shared/error.text.js';
import type {
    GeneratedPersona,
    Persona as PersonaView,
    PersonaDraftView,
    PersonaInput,
    PersonaList,
    PersonaRequest,
} from './types/personas.types.js';
import type { Persona, PersonaDraft } from './persona.js';
import { PersonaRepository } from './persona.repository.js';
import { SEED_PERSONAS } from './persona.defaults.js';
import { BUDGET_MS, MAX_OUTPUT_TOKENS, MAX_WAIT_MS, PERSONA_MODEL_KEY, personaPrompt, readPersona } from './persona.writer.js';

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
        private readonly llm: LlmService,
        // Reaching FORWARDS: PersonasModule sits above DirectorModule in `modules.ts`, which is a
        // dependency order for lifecycle rather than for resolution. `ScheduleModule` already does
        // the same, from further up, for the same reason — the director is the one owner of what is
        // on air and everything else posts it a command. See {@link setActive}.
        private readonly director: DirectorService,
        private readonly afterCommit: AfterCommit,
        // Who is asking, so putting a character on air is on the feed as somebody's decision. This
        // is the station's second surface that can change what it sounds like mid-show.
        private readonly context: AuthorizationContext,
        private readonly activity: ActivityRecorder,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** The actor to stamp on an event, when there is one. See `DirectorConsoleService.actor`. */
    private actor(): string | undefined {
        return this.context.actor.kind === 'user' ? this.context.actor.actorId : undefined;
    }

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

    /**
     * Put one persona on air and take the previous one off.
     *
     * ## It reaches the show that is running, and only sometimes
     *
     * This is the STATION's host. A broadcast that named its own keeps it, which is
     * `PersonaRepository.presenting`'s precedence and the whole point of
     * `station_lineup.persona_id` — the way to change THAT show's host is the on-air page, which
     * says so. So the director is told what happened rather than what to do: the recast command
     * with no binding re-checks who is presenting and leaves the running order's own answer alone.
     *
     * What it costs when it does reach the show is a rewrite of the breaks the outgoing host had
     * lined up, because they are already written and spoken in a character the station has just
     * stopped being. That decision lives in the director; see `DirectorService.recast`.
     *
     * **After the commit, and not optional.** The director reads the personas table on its own
     * pooled connection, so from inside this transaction it would resolve the row as it stood
     * BEFORE this write and conclude that nothing had changed — the failure `AfterCommit` exists
     * for, in its quiet form. Best-effort once it runs: a director that would not take the command
     * must not cost the operator a write that has already happened.
     */
    async setActive(id: string): Promise<PersonaList> {
        const active = await this.personas.setActive(id);
        if (active === undefined) throw httpError(404).withDetails({ message: `persona "${id}" does not exist` });

        this.afterCommit.add(async () => {
            try {
                await this.director.post({ kind: 'recast' });
            } catch (error) {
                this.logger.warn(`personas: the station changed character but the show could not be told (${errorText(error)})`, { key: active.key });
            }
        });

        void this.activity.record({
            // `director` rather than a module of its own, and it is the honest answer rather than
            // the cheap one: the feed's modules are what an operator filters by — `director` is
            // drawn as "Programming" — and who the station sounds like on air is that, sitting
            // beside the `air.recast` this event's other half posts. A chip for one kind of event
            // would be a filter nobody would use.
            module: 'director',
            kind: 'persona.active',
            // The persona's own label, which is the station's own text about its own character.
            detail: `An operator put ${active.label} on air.`,
            data: { personaId: active.id, key: active.key },
            ...(this.actor() === undefined ? {} : { actorId: this.actor() as string }),
        });

        this.logger.info('personas: the station changed character', { key: active.key });
        return this.answer();
    }

    /**
     * Put back whichever of the station's own personas are missing.
     *
     * The operator asking for the thing `seed` refuses to do on its own. A boot that restored a
     * deleted persona would make deleting one inexpressible; a button that does it is somebody
     * saying what they want, and it is the only way a station that has been running since before a
     * persona was written can ever reach it.
     *
     * Nothing already here is touched, including a persona rewritten under a seeded key, and nothing
     * is put on air.
     */
    async restore(): Promise<PersonaList> {
        const written = await this.personas.restoreMissing(SEED_PERSONAS);
        this.logger.info('personas: an operator restored the station personas', { written: written.length, keys: written });

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

    /**
     * Turn a description into a persona, and hand it back UNSAVED.
     *
     * Nothing is written. The console opens the draft in the editor and the operator saves it through
     * the ordinary create route, which is what keeps this a way of filling in a form rather than a
     * second writer of the table — and what makes an answer that got the character slightly wrong an
     * edit instead of a delete.
     *
     * A model that is absent is an ordinary state and not a fault, so it is answered as a 503 with
     * the sentence `LlmService` already writes for it, rather than as a crash. The console keeps the
     * button and says why it will not work.
     */
    async generate(body: PersonaRequest): Promise<GeneratedPersona> {
        if (!this.llm.canGenerate()) throw httpError(503).withDetails({ message: this.llm.explainGenerator() });

        const model = this.config.get(PERSONA_MODEL_KEY, '').trim();
        const result = await this.llm.converse(
            {
                messages: personaPrompt(body.description),
                ...(model.length === 0 ? {} : { model }),
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                // The same call the break writer makes, and for a sharper reason. Inventing a
                // character is not a reasoning problem, and a model that thinks out loud here spends
                // the ceiling on deliberation and gets truncated mid-object — which costs the WHOLE
                // persona, because unlike a list of picks there is only one object to lose. Measured
                // on this station: without it the answer ran to all 4000 tokens and parsed to
                // nothing.
                reasoningEffort: 'low',
            },
            {
                // Nothing to look up: a character is invented rather than researched, and a tool round
                // trip here would spend another whole generation on nothing.
                tools: false,
                budgetMs: BUDGET_MS,
                maxWaitMs: MAX_WAIT_MS,
            },
        );

        const generated = readPersona(result.text);
        if (generated === undefined) {
            // The head of the answer rides the log line, because "the model did not answer with a
            // persona" is unactionable on its own: a model that refused, one that wrote prose and one
            // that hit its ceiling mid-object want three different fixes and are one message
            // otherwise. Truncated, since the whole answer belongs in a capture rather than a log.
            this.logger.info('personas: the model answered with nothing a persona could be read from', {
                tokens: result.usage?.outputTokens,
                finish: result.finishReason,
                answer: result.text.trim().slice(0, 300),
            });
            throw httpError(502).withDetails({
                message: 'the model did not answer with a persona. Try again, or describe the character differently',
            });
        }

        // The cost and the stopping reason ride the SUCCESS line too, not only the failure one. The
        // interesting failure here is no longer an answer that could not be read — it is a thin one:
        // a model that stopped after the samples leaves a persona with no markers and no phrasings,
        // which parses perfectly and is half a character. "It ran out of tokens" and "it decided it
        // was finished" want opposite fixes and are the same empty field otherwise.
        this.logger.info('personas: a model wrote a persona', {
            key: generated.draft.key,
            fields: Object.keys(generated.draft).length,
            markers: generated.draft.dictionMarkers?.length ?? 0,
            phrasings: (generated.draft.templates ?? '').split('\n').filter(line => line.trim().length > 0).length,
            droppedMarkers: generated.droppedMarkers.length,
            droppedTemplates: generated.droppedTemplates.length,
            tokens: result.usage?.outputTokens,
            finish: result.finishReason,
        });

        return {
            persona: toDraftView(generated.draft),
            droppedMarkers: [...generated.droppedMarkers],
            droppedTemplates: [...generated.droppedTemplates],
        };
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
            brevity: body.brevity,
            latitude: body.latitude,
            templates: text(body.templates),
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
            brevity: persona.brevity,
            latitude: persona.latitude,
            templates: persona.templates,
            diction: mutable(persona.diction),
            dictionMarkers: mutable(persona.dictionMarkers),
            quirks: mutable(persona.quirks),
            catchphrases: mutable(persona.catchphrases),
            avoid: mutable(persona.avoid),
            samples: mutable(persona.samples),
        }),
    };
}

/**
 * A generated draft as the editor takes it.
 *
 * The saved view minus `id` and `active`, which a draft has neither of. Written out rather than
 * derived from {@link toView} because the two answer different questions — one is a row and one is a
 * form's contents — and folding them together would mean inventing an id for something that is not
 * a persona yet.
 */
function toDraftView(draft: PersonaDraft): PersonaDraftView {
    return {
        key: draft.key,
        label: draft.label,
        style: draft.style,
        ...omitUndefined({
            djName: draft.djName,
            voice: draft.voice,
            background: draft.background,
            brevity: draft.brevity,
            latitude: draft.latitude,
            templates: draft.templates,
            diction: mutable(draft.diction),
            dictionMarkers: mutable(draft.dictionMarkers),
            quirks: mutable(draft.quirks),
            catchphrases: mutable(draft.catchphrases),
            avoid: mutable(draft.avoid),
            samples: mutable(draft.samples),
        }),
    };
}

const mutable = (values: readonly string[] | undefined): string[] | undefined => (values === undefined ? undefined : [...values]);

/** Drop the keys that are `undefined`, so an optional field is absent rather than explicitly empty. */
function omitUndefined<T extends Record<string, unknown>>(values: T): Partial<T> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}
