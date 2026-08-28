import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { ScriptHistoryRepository } from '#modules/render/script.history.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { distilPrompt, readNotes, verified, verifyPrompt, MAX_SCRIPTS, MIN_SCRIPTS, type ModelNote } from './persona.notes.model.js';
import { PersonaNotesRepository, type PersonaNoteWrite } from './persona.notes.repository.js';
import { PersonaRepository } from './persona.repository.js';

/**
 * The distil pass's settings, keyed like every other model-driven feature.
 *
 * Off by default, and that is honest rather than cautious: this is the only pass on the station that
 * writes something the operator has to look at, so turning it on is accepting a queue as well as
 * some background generations.
 */
export const PERSONA_NOTES_KEYS = {
    enabled: 'llm.personaNotes',
    model: 'llm.personaNotesModel',
} as const;

/** OFF. A notebook an operator fills in by hand works perfectly well; this only adds to it. */
export const PERSONA_NOTES_DEFAULT = false;

/** How long this waits to get IN to the one model slot. `FactExtractionService`'s value and reason. */
export const MODEL_WAIT_MS = 5_000;

/**
 * The tier this takes the model at.
 *
 * `background`, explicitly, because `LlmGate` defaults a silent caller to `air` and a caller that
 * says nothing is therefore declaring a deadline it does not have. `fact.extraction.service.ts`
 * records what that mistake actually cost when it was made there — a briefed refill preempted by a
 * walk over articles, and an hour of ordinary rotation with nothing saying why.
 */
export const MODEL_PRIORITY = 'background' as const;

/** How long one character's distillation may take once it has the slot. */
export const MODEL_BUDGET_MS = 120_000;

/** How long a verification may take. Far shorter: it is a yes or a no about two short strings. */
export const VERIFY_BUDGET_MS = 30_000;

/** Room for the thinking that happens before the one word. See `VERIFY_OUTPUT_TOKENS` in the fact pass. */
export const VERIFY_OUTPUT_TOKENS = 512;

/** One pass, for the job's log line and the activity row. */
export interface DistilSummary {
    /** Characters looked at, including the ones whose window was too thin to read. */
    considered: number;
    /** Characters actually read. */
    read: number;
    /** Notes written straight into use, which are the checked `said` ones. */
    active: number;
    /** Notes waiting on the operator, which are the `trait` ones nothing can verify. */
    suggested: number;
    failed: number;
}

const empty = (): DistilSummary => ({ considered: 0, read: 0, active: 0, suggested: 0, failed: 0 });

/**
 * Reading a character's own history back to it.
 *
 * ## Everything about it declines quietly
 *
 * The setting is off, there is no model plugin, the slot is busy with a break, the window is too
 * thin, the answer came back unparseable: all five leave a notebook exactly as it was and a
 * character still outstanding for the next run. None of them costs the station anything on air,
 * which is what makes it safe to point at a slow local model.
 *
 * ## It reaches forward into Render, and that is a resolution rather than a lifecycle order
 *
 * `PersonasModule` is registered before `RenderModule` in `modules.ts`, which orders start-up and
 * shutdown rather than what may be injected. `PersonaRehearsalService` next door already reaches
 * into the director's registrations at request time for the same reason, and this resolves later
 * still: it runs off a cron job.
 *
 * ## What it does NOT do is judge
 *
 * A `said` note is checked against the words the station broadcast and then goes into use; a `trait`
 * note is an inference and is proposed. Nothing here decides whether a break was any good, because
 * nothing in the station records that — see `docs/todo/break-ratings.md` and the note on
 * `ScriptHistoryRepository.writtenBy`, which is where the one clause goes when it does.
 */
@Injectable()
export class PersonaDistilService {
    constructor(
        private readonly personas: PersonaRepository,
        private readonly notes: PersonaNotesRepository,
        private readonly scripts: ScriptHistoryRepository,
        private readonly llm: LlmService,
        private readonly activity: ActivityRecorder,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * One pass over every character this station has.
     *
     * Every character rather than only the one on air, because a persona that presents Tuesday
     * mornings accumulates just as much as the default one and would otherwise never be read.
     */
    async run(stop?: AbortSignal): Promise<DistilSummary> {
        const summary = empty();

        // Read per pass rather than held, so an operator turning it on gets it on the next run.
        if (!settingIsOn(this.config, PERSONA_NOTES_KEYS.enabled, PERSONA_NOTES_DEFAULT)) return summary;
        if (!this.llm.canGenerate()) {
            this.logger.debug(`personas: no model to read a character with (${this.llm.explainGenerator()})`);
            return summary;
        }

        for (const persona of await this.personas.list()) {
            if (stop?.aborted) break;
            summary.considered++;

            try {
                const read = await this.distil(persona.key, persona.label, persona.style, stop);
                if (read === undefined) continue;

                summary.read++;
                summary.active += read.active;
                summary.suggested += read.suggested;
            } catch (error) {
                // Includes the gate's own timeout, which is the station using its model for something
                // that matters more rather than a failure of this pass. Either way the watermark is
                // untouched and the scripts are read again next time.
                summary.failed++;
                this.logger.warn(`personas: could not read "${persona.key}" back (${errorText(error)})`);
            }
        }

        // One row carrying a count rather than one per note, on `StationLineup.markAiring`'s rule —
        // and only when something is actually WAITING, because the feed is where an operator learns
        // there is a queue and a pass that proposed nothing is not news.
        if (summary.suggested > 0) {
            void this.activity.record({
                // `director`, like `PersonasService.setActive` beside it: who the station is
                // presenting as is a programming fact, and the feed's five modules are about where
                // an operator would look rather than about which folder the code is in.
                module: 'director',
                kind: 'persona.notesProposed',
                detail:
                    summary.suggested === 1
                        ? 'The station noticed something about one of its characters and is waiting to be told whether it is right.'
                        : `The station noticed ${summary.suggested} things about its characters and is waiting to be told whether they are right.`,
                data: { suggested: summary.suggested, active: summary.active, characters: summary.read },
            });
        }

        return summary;
    }

    /**
     * One character, read and then checked. `undefined` when the window was too thin to read.
     *
     * The watermark moves on what was READ rather than on what was kept, so a window that produced
     * nothing is not read again — the whole reason `persona_note_passes` exists. It is moved after
     * the notes are written rather than before, which is the same crash-ordering call
     * `pronunciation.mining.service.ts` makes: written-first re-reads and the unique index
     * recognises the duplicate, marked-first loses the observation for good.
     */
    private async distil(
        personaKey: string,
        label: string,
        style: string,
        stop?: AbortSignal,
    ): Promise<{ active: number; suggested: number } | undefined> {
        const since = await this.notes.readThrough(personaKey);
        const said = await this.scripts.writtenBy(personaKey, since, MAX_SCRIPTS);

        // Too thin to see a habit in. The watermark is deliberately NOT moved, so the window keeps
        // filling; `ran_at` still moves, which is how this is distinguishable from never having run.
        if (said.length < MIN_SCRIPTS) {
            await this.notes.markRead(personaKey, since);
            return undefined;
        }

        const model = this.config.get(PERSONA_NOTES_KEYS.model, '').trim();
        const scripts = said.map(row => row.script);
        const started = Date.now();

        const answer = await this.llm.converse(
            { messages: distilPrompt({ label, style }, scripts), ...(model.length === 0 ? {} : { model }), reasoningEffort: 'low' },
            { budgetMs: MODEL_BUDGET_MS, maxWaitMs: MODEL_WAIT_MS, tools: false, priority: MODEL_PRIORITY },
        );

        const found = readNotes(answer.text, scripts);
        const writes: PersonaNoteWrite[] = [];

        for (const note of found) {
            if (stop?.aborted) break;

            const write = await this.judge(personaKey, note, said, model);
            if (write !== undefined) writes.push(write);
        }

        const written = await this.notes.addAll(writes);
        await this.notes.markRead(personaKey, said.at(-1)?.at);

        const active = writes.filter(write => write.state === 'active').length;
        const suggested = writes.length - active;

        // The numbers rather than a verdict, for the reason the fact pass logs its own: "the model
        // stopped noticing anything" and "the verifier started refusing everything" are two different
        // questions and neither can be asked of figures nobody gathered. `written` is below
        // `writes.length` whenever the unique index caught a note this character already holds, which
        // is the ordinary case on a settled station rather than a fault.
        this.logger.info('personas: a model read a character back', {
            persona: personaKey,
            scripts: scripts.length,
            noted: found.length,
            kept: writes.length,
            written,
            durationMs: Date.now() - started,
            finish: answer.finishReason,
            ...(answer.usage === undefined ? {} : { tokens: answer.usage.totalTokens ?? answer.usage.outputTokens }),
        });

        return { active, suggested };
    }

    /**
     * What state a note goes in, or nothing if it does not go in at all.
     *
     * The asymmetry `persona.notes.model.ts` argues, applied. A `trait` is an inference across
     * scripts that nothing can entail, so it is proposed and the operator decides. A `said` is a
     * claim about one line the station broadcast, which is exactly the narrow question the verifier
     * answers well — and one it fails is dropped without comment, because a false note about what
     * this character has already said is the station misremembering itself out loud.
     */
    private async judge(
        personaKey: string,
        note: ModelNote,
        said: readonly { id: string; script: string }[],
        model: string,
    ): Promise<PersonaNoteWrite | undefined> {
        if (note.kind === 'said' && !(await this.supported(note.note, note.quote, model))) return undefined;

        // Which attempt the quote came from, for the console's link back. Best-effort: the quote has
        // already been checked against the whole corpus, so failing to attribute it to one row is a
        // missing reference rather than a reason to drop a verified note — and `source_quote` is the
        // half that has to survive the nightly sweep anyway.
        const from = said.find(row => row.script.includes(note.quote));

        return {
            personaKey,
            kind: note.kind,
            note: note.note,
            state: note.kind === 'said' ? 'active' : 'suggested',
            origin: 'model',
            sourceQuote: note.quote,
            ...(from === undefined ? {} : { sourceScriptId: from.id }),
        };
    }

    /**
     * Whether the quoted line really states the note, asked of a conversation told nothing else.
     *
     * A separate call rather than a second question in the first, which is the whole mechanism: a
     * model asked to observe and then to check its own observations in the same breath approves
     * them. This one has never seen the other breaks and does not know whose they are.
     *
     * A failure answers `false`, and an EMPTY answer says so at warn — the verifier being broken
     * must not become the route by which unchecked notes reach the prompt, and it must not look like
     * an honest disagreement about every one either. Both halves are the fact pass's, and the second
     * is there because the first alone hid a broken verifier on this station for months.
     */
    private async supported(note: string, quote: string, model: string): Promise<boolean> {
        try {
            const answer = await this.llm.converse(
                {
                    messages: verifyPrompt(note, quote),
                    ...(model.length === 0 ? {} : { model }),
                    maxOutputTokens: VERIFY_OUTPUT_TOKENS,
                    reasoningEffort: 'low',
                },
                { budgetMs: VERIFY_BUDGET_MS, maxWaitMs: MODEL_WAIT_MS, tools: false, priority: MODEL_PRIORITY },
            );

            if (answer.text.trim().length === 0) {
                this.logger.warn('personas: the verifier answered nothing, so this note was dropped; check the model and VERIFY_OUTPUT_TOKENS');
                return false;
            }

            return verified(answer.text);
        } catch (error) {
            this.logger.debug(`personas: could not check a note (${errorText(error)})`);
            return false;
        }
    }
}
