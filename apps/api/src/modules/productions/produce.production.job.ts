import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import type { LlmMessage, SpeechCue } from '@deadair/plugin-sdk';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { dayPart, stationZone, type RoughTime } from '#modules/director/clock.words.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { LlmService, type LlmConversation } from '#modules/llm/llm.service.js';
import { PersonaNotesRepository } from '#modules/personas/persona.notes.repository.js';
import { PersonaStoriesRepository } from '#modules/personas/persona.stories.repository.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import type { PersonaNotesForPrompt } from '#modules/personas/persona.note.js';
import type { PersonaStoryForPrompt } from '#modules/personas/persona.story.js';
import { spentCatchphrases } from '#modules/personas/persona.sheet.js';
import type { Persona } from '#modules/personas/persona.js';
import { ScriptHistoryRepository, type ScriptWrite } from '#modules/render/script.history.repository.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { padsIn } from '#modules/render/pad.cues.js';
import { PadRepository } from '#modules/render/pad.repository.js';
import { SegmentRepository, type PadHit, type Segment } from '#modules/render/segment.repository.js';
import { SpeechService } from '#modules/render/speech.service.js';
import { speakableScript } from '#modules/render/speakable.script.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { errorText } from '#modules/shared/error.text.js';
import { checkBeat, correctionNote } from './production.checks.js';
import { isDialogue, speakerOrder, turnWeights, type CastMember, type ProductionCast } from './production.cast.js';
import { ProductionCaster } from './production.caster.js';
import { cuesFor } from './production.cues.js';
import { planProduction, turnsFor } from './production.plan.js';
import { beatPrompt, outlinePrompt, runInFrom } from './production.prompt.js';
import { coerceOutline, priorityForSlot, type Production, type ProductionPass, type ProductionPlan } from './production.js';
import { firstPass, nextPass, runsPass } from './production.passes.js';
import { ProductionRepository } from './production.repository.js';

/**
 * How long before its slot a production stops being background work.
 *
 * Half an hour, which is roughly one refill plus the beats of a short programme: enough that a
 * production due imminently can finish, and short enough that one due tomorrow never competes with
 * anything on air.
 */
export const DEADLINE_MS = 30 * 60_000;

/** How long the outline may take once it has the model. One call, but a whole programme's worth. */
export const OUTLINE_BUDGET_MS = 120_000;

/** How long one beat may take. */
export const BEAT_BUDGET_MS = 120_000;

/**
 * How long to wait for the model slot before giving up on this pass.
 *
 * Generous, because nobody is waiting on a production the way they are on a break — and because a
 * pass that gives up is not a lost production: the row still says which pass it was on, and the job
 * is sent again.
 */
export const WAIT_MS = 60_000;

/**
 * How much output a call gets.
 *
 * **Sized for the REASONING, not for the words.** Reasoning tokens are spent out of this same
 * allowance before any text is emitted, and on this station's model that is the larger half by a
 * wide margin — measured on the first live run, a single 213-word beat produced 7,864 characters of
 * reasoning and then hit the ceiling with no text at all. The beat itself is perhaps 350 tokens.
 *
 * So these are generous on purpose, and the asymmetry is one-sided: unused allowance costs nothing,
 * while too little costs the whole production. This is the third time the same mistake has been
 * found in this tree (the fact verifier at 8 tokens, `MAX_OUTPUT_TOKENS` in the break writer, and
 * here), which is why it is written down rather than tuned quietly.
 *
 * `reasoningEffort: 'low'` is already set on the beat calls and does NOT make this unnecessary — the
 * 7,864 characters above were produced with it on.
 */
export const OUTLINE_OUTPUT_TOKENS = 8_000;
export const BEAT_OUTPUT_TOKENS = 8_000;

/**
 * How many times a beat that came back with nothing is asked again.
 *
 * One, and it is not the same thing as the `check` pass's re-draft: that one is about a beat being
 * WRONG, this is about a beat not existing. An empty answer is the model losing its allowance to
 * reasoning or the host hiccuping, and neither is a reason to throw away a programme that is
 * otherwise twenty beats long — which is what failing here does, since a production cannot air with
 * a hole in it.
 */
export const EMPTY_BEAT_RETRIES = 1;

/**
 * Kinds of production that are REPORTED rather than presented, and are shown no character memory.
 *
 * `showsNotebook`'s argument one source further out: a character reading the news and handed a list
 * of its own past sayings will read one out. A list of words rather than a setting because nobody
 * has asked for one — `segments.kind` is free text, so these are the two spellings a station would
 * reach for, and the day somebody uses a third this becomes a key in `production.settings.ts`.
 */
export const PLAIN_KINDS: readonly string[] = ['news', 'bulletin'];

/**
 * How many soundboard hits ONE PROGRAMME may carry.
 *
 * `MAX_PADS` is one per segment and a production is fifteen to twenty-five of them, so copying that
 * number straight across permits a drop on every single turn — which is precisely the failure it
 * exists to prevent, arriving through a door it does not cover. "A soundboard is funny once" is a
 * claim about a PROGRAMME rather than about a turn.
 *
 * Two rather than one, because a programme is long enough to have two moments in it, and low enough
 * that the second is still a punchline rather than a running gag. It is a CEILING and not a target:
 * most productions will hit none, because the offer only reaches a host with a board and the model
 * is asked to use it only where it would actually have reached for one.
 *
 * Enforced by WITHDRAWING the offer rather than by counting the answers, which is the only mechanism
 * available: each beat is its own model call and cannot see what the others wrote, so a budget in
 * the prompt would be a number nothing could honour. Once the count is spent the rule vanishes from
 * every prompt after it, exactly as `spentCatchphrases` withdraws a signature the programme has
 * already used.
 */
export const MAX_PRODUCTION_PADS = 2;

export interface ProducePayload {
    /**
     * Which production to work on.
     *
     * Optional in the type and required in practice, like every other job payload here: a
     * registration is typed against a payload the broker may deliver as `{}`.
     */
    productionId?: string;
    /** Which pass to run. Absent means the first one this production's mode calls for. */
    pass?: ProductionPass;
}

/**
 * Run ONE pass of making a production, then send the job for the next.
 *
 * ## Why one job per pass
 *
 * Not one job for the whole production, and the three reasons are the whole argument for the shape.
 * pg-boss runs stay short, so `expiresIn` keeps meaning something and a wedged run is reclaimable. A
 * restart resumes, because the row says which pass finished and nothing is held in memory. And the
 * station's one model slot is genuinely FREE between passes — which is what makes the gate's tiers
 * work at all, since a tier that only applies between admissions needs there to be admissions. A
 * production wrapped in a single `gate.hold` would hold the model for the whole programme and every
 * break in that window would fall to its deterministic floor.
 *
 * ## Cancellation is asked about, never delivered
 *
 * A queue cannot cancel. Everything already sent will arrive, so this checks the row instead: the
 * claim refuses a settled production, and the long passes check again between beats. The gate's
 * withdrawal signal is the third place — a beat still queued for the model when somebody stops the
 * production leaves that queue rather than being admitted, generated and thrown away.
 */
@Injectable()
export class ProduceProductionJob extends PlainJob<ProducePayload> {
    constructor(
        private readonly productions: ProductionRepository,
        private readonly segments: SegmentRepository,
        // Everything the station writes is kept, and a production wrote nothing down until callers
        // arrived. It is what `/scripts` draws, what `llm.captureWrites` captures, and — through
        // `persona_key` — the only way a character accumulates anything from a programme.
        private readonly history: ScriptHistoryRepository,
        private readonly personas: PersonaRepository,
        // The rack a host reaches for. See {@link boardFor}: a caller never gets one.
        private readonly pads: PadRepository,
        // What a character has accumulated. Both are keyed by a persona KEY and know nothing about
        // breaks, so a caller who has rung before reaches them without a line of new storage.
        private readonly notes: PersonaNotesRepository,
        private readonly stories: PersonaStoriesRepository,
        private readonly caster: ProductionCaster,
        // What the engine can PERFORM, asked once per pass. A beat's own answer is stripped against
        // the same list it was offered, which is what keeps the two from disagreeing.
        private readonly speech: SpeechService,
        private readonly llm: LlmService,
        private readonly jobs: PgBossJobBroker,
        private readonly config: AppConfig,
        // Best-effort and never awaited, on `ActivityRecorder`'s own rule: nothing reads these rows
        // to decide anything, so a failed insert must never cost the station the thing it described.
        private readonly activity: ActivityRecorder,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: ProducePayload): Promise<void> {
        if (!payload?.productionId) {
            this.logger.warn('productions: a produce job was sent with nothing to produce', { job: this.context.id });
            return;
        }
        const { productionId } = payload;

        const existing = await this.productions.findById(productionId);
        if (existing === undefined) {
            this.logger.warn('productions: the production this job was for is gone', { production: productionId });
            return;
        }

        const pass = payload.pass ?? firstPass(existing.writingMode);
        // A mode changed under a production already being made. Stopping is the honest outcome: the
        // passes that ran ran, and guessing where it sits in a chain it was never started on is
        // worse than leaving it where an operator can see it.
        if (!runsPass(existing.writingMode, pass)) {
            this.logger.info('productions: this production no longer runs that pass, so it stops here', {
                production: productionId,
                pass,
                mode: existing.writingMode,
            });
            return;
        }

        try {
            const ran = await this.runPass(existing, pass);
            if (!ran) return;

            const next = nextPass(existing.writingMode, pass);
            if (next !== undefined) {
                await this.jobs.send('director.produce', { productionId, pass: next });
                return;
            }

            // Every pass is done, so the words exist and the beats are ready to be spoken. The
            // render jobs are sent per beat, which is what lets the speech gate interleave the
            // station's own work between them rather than being held for a whole programme.
            await this.render(productionId);
        } catch (error) {
            // A failure is recorded rather than thrown, for the reason every job in this tree does
            // it: an unhandled throw is a retry against a row that has already moved, and the reason
            // is what an operator actually needs.
            const reason = errorText(error);
            this.logger.warn(`productions: could not ${pass} a production (${reason})`, { production: productionId });
            await this.productions.fail(productionId, `${pass}: ${reason}`);
        }
    }

    /** One pass. Answers whether it actually ran, so a lost claim stops the chain rather than continuing it. */
    private async runPass(production: Production, pass: ProductionPass): Promise<boolean> {
        switch (pass) {
            case 'outline':
                return await this.outline(production);
            case 'draft':
                return await this.draft(production);
            case 'check':
                return await this.check(production);
        }
    }

    /**
     * Decide the shape, and write down the arithmetic beside it.
     *
     * **The plan is computed here rather than asked for**, and the outline is asked to fill exactly
     * that many beats. A model that decides its own beat count gives one story one beat, which is how
     * one story in a ten-minute show came to be asked for about 1300 spoken words.
     */
    private async outline(production: Production): Promise<boolean> {
        const claimed = await this.productions.claim(production.id, 'planned', 'outlining');
        if (claimed === undefined) return false;

        const { plan, casting } = await this.shape(claimed);

        const ask = async () =>
            await this.llm.converse(
            {
                messages: outlinePrompt({
                    kind: claimed.kind,
                    title: claimed.title,
                    ...(claimed.brief === undefined ? {} : { brief: claimed.brief }),
                    beats: plan.beats.length,
                    wordsPerBeat: plan.beats[0]?.words ?? 0,
                    // No persona: the outline decides what the programme is ABOUT, and the beats
                    // decide who is saying it. See `outlinePrompt` for what handing it the sheet
                    // actually produced. The CAST is a different thing and is sent — who has each
                    // turn is already decided, and content planned without knowing that is content
                    // the wrong person has to say.
                    ...(isDialogue(casting) ? { speakers: plan.beats.map(beat => ({ ordinal: beat.ordinal, who: casting[beat.speaker ?? 0]! })) } : {}),
                    station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
                    // Here as well as on every beat, because a throughline is an instruction each
                    // beat then obeys: a plan written around the end of a long day cannot be undone
                    // by a rule in the beat prompt saying it is the morning.
                    dayPart: this.whenItAirs(claimed).words,
                }),
                maxOutputTokens: OUTLINE_OUTPUT_TOKENS,
                // Planning IS the reasoning problem here, unlike a break. Left at the model's own
                // default rather than pinned low, which is the one call in this file where thinking
                // buys something.
            },
            { budgetMs: OUTLINE_BUDGET_MS, maxWaitMs: WAIT_MS, tools: false, priority: this.priorityOf(claimed) },
        );

        // Asked again before giving up, which is worth one call and is not free. The measured reason
        // this pass fails is the one model slot being busy — "waited 60000ms for the model and it is
        // still busy" — so a second ask may hit the same wall; it costs another `LlmGate` wait on a
        // background-priority call and nothing on the air path. Measured live: 8 of 12 productions
        // aired with no outline at all.
        let outline = coerceOutline(parseJson((await ask()).text), 0);
        if (outline === undefined) {
            this.logger.info('productions: the outline came back unusable, so it is being asked again', { production: claimed.id });
            outline = coerceOutline(parseJson((await ask()).text), 0);
        }

        // Still a model that gave nothing usable, which is not a failure of the production: the plan
        // is already computed, so the beats can be drafted from the brief alone — which is what a
        // `quick` production does by design.
        //
        // What is new is SAYING so. Degrading quietly to `quick` at `info` level meant two thirds of
        // this station's phone-ins were written with no throughline and no beat map, each turn blind
        // to every other, and nothing anywhere said that had happened — a programme where nothing
        // answers anything looks exactly like a model that is simply not very good.
        if (outline === undefined) {
            this.logger.info('productions: the model gave no usable outline, so the beats will be drafted from the brief', {
                production: claimed.id,
            });
            void this.activity.record({
                module: 'render',
                kind: 'production.unplanned',
                detail:
                    `"${claimed.title}" is being written without an outline: the model could not plan it, twice. Each beat will be written on ` +
                    'its own, so it will read as a run of separate pieces rather than one programme.',
                data: { production: claimed.id, kind: claimed.kind },
            });
            return await this.productions.savePlan(claimed.id, plan, 'outlining', 'drafting', casting);
        }

        return await this.productions.saveOutline(claimed.id, outline, plan, 'drafting', casting);
    }

    /**
     * Write every beat, in order, each one carrying on from the last.
     *
     * Sequential rather than parallel, and that is the point rather than a limitation: beat 4 is
     * written from the actual last words of beat 3, so there is nothing to parallelise. The model is
     * one slot anyway.
     */
    private async draft(production: Production): Promise<boolean> {
        const from = production.state === 'planned' ? 'planned' : 'drafting';
        const claimed = await this.productions.claim(production.id, from, 'drafting');
        if (claimed === undefined) return false;

        // A `quick` production has no outline pass, so it arrives here with neither a plan nor a
        // cast and both are decided now.
        const shaped = claimed.plan === undefined ? await this.shape(claimed) : { plan: claimed.plan, casting: claimed.casting };
        const plan: ProductionPlan = shaped.plan;
        if (claimed.plan === undefined) await this.productions.savePlan(claimed.id, plan, 'drafting', 'drafting', shaped.casting);

        // Empty for a production made before there was a cast at all, which `sheets` then answers by
        // resolving the presenter — every beat is theirs, exactly as it was.
        const casting = shaped.casting ?? [];
        // One read per character rather than one per beat. A production is up to twenty-four beats
        // and the sheet does not change while it is being written.
        const sheets = await this.sheets(claimed, casting);
        const engine = await this.performable();
        const station = this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title);
        // Once for the production rather than once per beat: a programme does not cross into a
        // different part of the day while it is being written, and if one did, beats disagreeing
        // with each other would be worse than all of them being an hour stale.
        const airs = this.whenItAirs(claimed);
        let runIn: string | undefined;
        let previous: number | undefined;
        // Everything written so far, PER SPEAKER, for the spent-signature check. Per speaker because
        // a shared list tells the host its catchphrase is spent by a caller who never used it — and
        // because a caller who has said one thing has not used up their own.
        const written = new Map<number, string[]>();

        // What the programme has spent off its soundboard, across every speaker. One count for the
        // whole thing rather than one per character, because a listener hears a PROGRAMME: two hosts
        // taking two drops each is four drops in ten minutes however it is divided up.
        const hits: PadHit[] = [];

        for (const beat of plan.beats) {
            // Between beats rather than only at the start: a production is minutes of work, which is
            // exactly long enough for somebody to change their mind halfway through it.
            if (await this.productions.isCancelled(claimed.id)) {
                this.logger.info('productions: this production was cancelled part way through, so the rest is not written', {
                    production: claimed.id,
                    at: beat.ordinal,
                });
                return false;
            }

            const outlineBeat = claimed.outline?.beats[beat.ordinal];
            const at = beat.speaker ?? 0;
            const speaker = casting[at];
            const persona = sheets.get(at);
            const mine = written.get(at) ?? [];
            const reactions = cuesFor(speaker?.role, engine);
            // The board in front of this speaker, or nothing. Resolved per beat rather than once,
            // because the offer is withdrawn the moment the programme spends its ceiling and a cast
            // can put a caller in the middle of it.
            const board = await this.boardFor(claimed, speaker, persona, hits.length);
            // Which of this character's signatures the programme has already spent. The measured
            // failure without it: "I said what I said" in 23 of 24 beats, because the sheet offers
            // its catchphrases to every beat and no beat could see what the others had done.
            const spent = persona === undefined ? [] : spentCatchphrases(persona, mine);
            // Built once so the retry below asks for exactly the same thing, and held so the history
            // row can carry it: a retry that rebuilt the prompt would be a different question, and a
            // beat that failed twice for two different reasons is one nobody can diagnose.
            const prompt = beatPrompt({
                kind: claimed.kind,
                title: claimed.title,
                ...(claimed.brief === undefined ? {} : { brief: claimed.brief }),
                ordinal: beat.ordinal,
                words: beat.words,
                ...(claimed.outline === undefined ? {} : { outline: claimed.outline }),
                ...(outlineBeat === undefined ? {} : { beat: outlineBeat }),
                ...(runIn === undefined ? {} : { runIn }),
                ...(persona === undefined ? {} : { persona }),
                ...(spent.length === 0 ? {} : { spent }),
                ...(speaker === undefined ? {} : { speaker }),
                ...(previous === undefined || casting[previous] === undefined ? {} : { previousSpeaker: casting[previous]! }),
                // Their first turn on the call, which is where a caller says hello and nowhere else
                // does.
                ...(mine.length === 0 ? { firstTurn: true } : {}),
                // The programme's own ending, which is where the call is wound up. `speakerOrder`
                // guarantees this turn is the host's — that is what the odd turn count is for.
                ...(beat.ordinal === plan.beats.length - 1 ? { lastTurn: true } : {}),
                // Who else is on the programme, for the two turns that have to acknowledge it. Read
                // off the cast rather than off the run-in, because the opening beat has no run-in
                // and is exactly the turn that needs to know somebody is holding.
                ...(guestOf(casting) === undefined ? {} : { guest: guestOf(casting)! }),
                ...(reactions.length === 0 ? {} : { reactions }),
                ...(board.names.length === 0 ? {} : { pads: board.names }),
                ...(await this.remembers(claimed, speaker, mine.length === 0)),
                station,
                dayPart: airs.words,
            });

            const ask = async () =>
                await this.llm.converse(
                    { messages: prompt, maxOutputTokens: BEAT_OUTPUT_TOKENS, reasoningEffort: 'low' },
                    { budgetMs: BEAT_BUDGET_MS, maxWaitMs: WAIT_MS, tools: false, priority: this.priorityOf(claimed) },
                );

            const label = `${claimed.title} (${beat.ordinal + 1}/${plan.beats.length})`;
            // One row per ATTEMPT, which is `script_history`'s own rule: an empty answer and the
            // retry after it are two things that happened, and a store that kept only the winner
            // would report a model that failed half the time as one that never did.
            const attempts: ScriptWrite[] = [];
            let script = '';

            // Asked again before the production is written off. A beat that came back empty is the
            // model having spent its allowance on reasoning rather than an answer, which is a bad
            // roll rather than a bad brief — and failing here throws away every beat already
            // written, since a production cannot air with a hole in it.
            for (let attempt = 0; script.length === 0 && attempt <= EMPTY_BEAT_RETRIES; attempt++) {
                if (attempt > 0) {
                    this.logger.info('productions: a beat came back empty, so it is being asked again', {
                        production: claimed.id,
                        beat: beat.ordinal,
                    });
                }

                const answer = await ask();
                // Speakable, which a beat has never been. The engine reads what it is given, so a
                // stage direction is a word in the audio — the first live call-in aired an album
                // title with the asterisks still round it. The strip spares exactly the cues this
                // speaker was offered.
                script = speakable(answer.text, reactions, board.names);
                attempts.push(this.attemptOf(claimed, { label, script, speaker, answer, messages: prompt }));
            }

            if (script.length === 0) {
                // Out of attempts. Not survivable the way a missing break is: another break is along
                // shortly and a programme with a hole in it is not a shorter programme. The attempts
                // are still written down: a production that failed is exactly when somebody wants to
                // read what the model actually said.
                await this.remember(attempts);
                await this.productions.fail(claimed.id, `beat ${beat.ordinal + 1} came back empty twice`);
                return false;
            }

            // Resolved and RESTED before the row exists, on the break path's own terms: the board is
            // in hand here and nowhere downstream, and a renderer resolving `[sfx:…]` for itself
            // would have to ask who is presenting now rather than who spoke this turn.
            const beatPads = await this.hits(board.name, script);
            hits.push(...beatPads);

            const planned = await this.segments.plan({
                kind: claimed.kind,
                label,
                script,
                pads: beatPads,
                writer: 'model',
                productionId: claimed.id,
                productionOrdinal: beat.ordinal,
                // The SPEAKER's voice and the SPEAKER's persona, which is what makes a conversation
                // audible rather than one voice reading both parts. The cast is what is stamped
                // rather than the sheet, because the cast is what was decided and the sheet may have
                // been edited since.
                ...(speaker?.voice === undefined ? {} : { voice: speaker.voice }),
                ...(speaker?.personaId === undefined ? {} : { personaId: speaker.personaId }),
            });

            await this.remember(attempts.map(attempt => ({ ...attempt, segmentId: planned.id })));

            written.set(at, [...mine, script]);
            previous = at;
            runIn = runInFrom(script);
        }

        return await this.productions.moveTo(claimed.id, 'checking', 'drafting');
    }

    /**
     * Judge every beat without a model, and re-draft the ones that failed something. Once.
     *
     * At most one re-draft per beat, which is why `checkBeat` answers a LIST: the single correction a
     * beat gets has to carry everything wrong with it.
     */
    private async check(production: Production): Promise<boolean> {
        const claimed = await this.productions.claim(production.id, 'checking', 'checking');
        if (claimed === undefined) return false;

        const beats = await this.segments.beatsOf(claimed.id);
        const plan = claimed.plan ?? planProduction(claimed.targetMs);
        const casting = claimed.casting ?? [];
        const sheets = await this.sheets(claimed, casting);
        const engine = await this.performable();
        const station = this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title);
        const airs = this.whenItAirs(claimed);
        let redrafted = 0;

        for (const [index, beat] of beats.entries()) {
            if (beat.script === undefined) continue;

            const at = plan.beats[index]?.speaker ?? 0;
            const speaker = casting[at];
            const persona = sheets.get(at);
            const previousAt = index === 0 ? undefined : (plan.beats[index - 1]?.speaker ?? 0);
            const reactions = cuesFor(speaker?.role, engine);
            const runIn = index === 0 ? undefined : runInFrom(beats[index - 1]?.script ?? '');
            const problems = checkBeat({
                text: beat.script,
                words: plan.beats[index]?.words ?? beat.script.split(/\s+/).length,
                ordinal: beat.productionOrdinal ?? index,
                priorBeats: beats.slice(0, index).map(earlier => earlier.script ?? ''),
                // Whether an opening is out of place is a question about the SPEAKER, not about the
                // ordinal: a caller being put on air greets somebody, in the middle of a programme,
                // and that is the one place it is right.
                ...(speaker === undefined ? {} : { role: speaker.role }),
                ...(firstTurnOf(plan, index, at) ? { firstTurn: true } : {}),
                // The same words this beat was handed, so a beat that recited them instead of
                // carrying on from them is caught.
                ...(runIn === undefined ? {} : { runIn }),
                dayPart: airs,
            });
            if (problems.length === 0) continue;

            if (await this.productions.isCancelled(claimed.id)) return false;

            const answer = await this.llm.converse(
                {
                    messages: beatPrompt({
                        kind: claimed.kind,
                        title: claimed.title,
                        ...(claimed.brief === undefined ? {} : { brief: claimed.brief }),
                        ordinal: beat.productionOrdinal ?? index,
                        words: plan.beats[index]?.words ?? 200,
                        ...(claimed.outline === undefined ? {} : { outline: claimed.outline }),
                        ...(claimed.outline?.beats[index] === undefined ? {} : { beat: claimed.outline.beats[index]! }),
                        ...(runIn === undefined ? {} : { runIn }),
                        ...(persona === undefined ? {} : { persona }),
                        // Everything THIS SPEAKER says EXCEPT this beat: a re-draft must not be told
                        // its own signature is spent by its own first attempt, which would forbid the
                        // one line it is allowed to keep — and must not be told somebody else's is.
                        ...(spentOf(persona, mineExcept(beats, plan, at, index)).length === 0
                            ? {}
                            : { spent: spentOf(persona, mineExcept(beats, plan, at, index)) }),
                        ...(speaker === undefined ? {} : { speaker }),
                        ...(previousAt === undefined || casting[previousAt] === undefined ? {} : { previousSpeaker: casting[previousAt]! }),
                        ...(firstTurnOf(plan, index, at) ? { firstTurn: true } : {}),
                        // The same two facts the draft was given. A re-draft asked for anything less
                        // would answer the correction and lose the rule that shaped the turn.
                        ...(index === beats.length - 1 ? { lastTurn: true } : {}),
                        ...(guestOf(casting) === undefined ? {} : { guest: guestOf(casting)! }),
                        ...(reactions.length === 0 ? {} : { reactions }),
                        // EXACTLY what this beat already hit, and never the whole board.
                        //
                        // Re-offering the rack would let the check pass add drops the drafting pass
                        // budgeted against, in a loop that cannot see the other beats' rows — while
                        // offering nothing at all would have `speakable` strip the cue and the
                        // rewrite would lose the sound in silence. Offering back what is on the row
                        // is the only option that is neither: this turn may keep its drop or drop it,
                        // and cannot invent one. A re-draft is fixing a problem, and the soundboard
                        // is not what was wrong with it.
                        ...(beat.pads.length === 0 ? {} : { pads: beat.pads.map(hit => hit.name) }),
                        station,
                        dayPart: airs.words,
                        correction: correctionNote(problems),
                    }),
                    maxOutputTokens: BEAT_OUTPUT_TOKENS,
                    reasoningEffort: 'low',
                },
                { budgetMs: BEAT_BUDGET_MS, maxWaitMs: WAIT_MS, tools: false, priority: this.priorityOf(claimed) },
            );

            const rewritten = speakable(
                answer.text,
                reactions,
                beat.pads.map(hit => hit.name),
            );
            // A re-draft that came back empty leaves the original in place. The first attempt passed
            // enough to be spoken, and a beat with problems is better than no beat at all — which is
            // the opposite of the drafting rule above, because there the alternative was a hole.
            if (rewritten.length === 0) continue;

            // The persona and the voice go back on with the words. `writeScript` nulls `personaId`
            // when it is not passed and leaves `voice` alone only when it is not offered, so a
            // re-drafted turn that forgot either would come out of the check pass in the presenter's
            // character with the caller's voice on it — or with no character at all, which is what a
            // recast reads as an ordinary break to rewrite.
            await this.segments.writeScript(beat.id, {
                script: rewritten,
                label: beat.label,
                writer: 'model',
                // Whichever of them the rewrite actually kept. `writeScript` resets this column when
                // it is not passed, so a re-draft that said nothing would take a drop off a turn that
                // still asks for one — and the row is what the render path reads to decide what to
                // join.
                pads: beat.pads.filter(hit => padsIn(rewritten).includes(hit.name)),
                ...(speaker?.personaId === undefined ? {} : { personaId: speaker.personaId }),
                ...(speaker?.voice === undefined ? {} : { voice: speaker.voice }),
            });
            redrafted += 1;
        }

        if (redrafted > 0) this.logger.info('productions: re-drafted beats that failed a check', { production: claimed.id, redrafted });
        return await this.productions.moveTo(claimed.id, 'rendering', 'checking');
    }

    /**
     * Send every beat to be spoken.
     *
     * One render job per beat rather than one for the production, on the same argument as the passes:
     * the speech engine is one slot, and a production that held it for a whole programme would make
     * every break in that window wait. Per beat, the station slots in between them.
     */
    private async render(productionId: string): Promise<void> {
        const moved = await this.productions.moveTo(productionId, 'rendering', ['checking', 'drafting']);
        if (!moved) return;

        const beats = await this.segments.beatsOf(productionId);
        for (const beat of beats) await this.jobs.send('render.segment', { segmentId: beat.id });

        this.logger.info('productions: a production is written and its beats are being spoken', { production: productionId, beats: beats.length });
    }

    /**
     * One attempt at a turn, as the station's own record of it.
     *
     * The SPEAKER's key rather than the presenter's, which is the whole of caller memory: the distil
     * pass groups by it, so a caller's turns become the caller's notes and the host's become the
     * host's. `previous` and `next` stay absent deliberately — they are the records a break sits
     * between, and a turn sits between two turns.
     */
    private attemptOf(
        production: Production,
        beat: { label: string; script: string; speaker?: CastMember; answer: LlmConversation; messages: LlmMessage[] },
    ): ScriptWrite {
        const empty = beat.script.length === 0;

        return {
            kind: production.kind,
            writer: 'model',
            outcome: empty ? 'failed' : 'written',
            ...(empty ? { reason: 'the model answered with nothing that could be spoken' } : { script: beat.script, label: beat.label }),
            ...(beat.speaker?.personaKey === undefined ? {} : { personaKey: beat.speaker.personaKey }),
            ...(beat.answer.usage === undefined ? {} : { usage: beat.answer.usage as unknown as Record<string, number> }),
            // An evening of prompt tuning rather than a default, exactly as the break path has it.
            ...(captureWrites(this.config) ? { prompt: beat.messages, raw: beat.answer.text } : {}),
        };
    }

    /**
     * Write down what was written, or carry on without it.
     *
     * Best-effort for `ActivityRecorder`'s reason one table over: nothing reads these rows to decide
     * anything, and a failed insert must never cost the station the programme it was describing.
     */
    private async remember(attempts: readonly ScriptWrite[]): Promise<void> {
        if (attempts.length === 0) return;

        try {
            await this.history.recordAll(attempts);
        } catch (error) {
            this.logger.warn(`productions: a turn was written but not recorded (${errorText(error)})`);
        }
    }

    /**
     * What this speaker has accumulated, for the prompt: their notebook, and one of their stories.
     *
     * Both come from `deadair.persona_notes` and `deadair.persona_stories`, which are keyed by a
     * persona KEY and know nothing about breaks — so a caller who has rung before reaches them the
     * moment a production writes any history at all. The read RESTS what it takes (`markUsed`, the
     * story's own stamp), which is why it happens once per speaker per turn rather than per attempt.
     *
     * Withheld from a plainly-reported kind, which is `showsFacts`' argument one source further out:
     * a character reading the news and handed a list of its own past sayings will read one out, and
     * it is worse than a discography note because nothing about it is even trying to be true today.
     * A list of words rather than a setting because nobody has asked for one; when somebody does,
     * this is where it goes.
     *
     * Best-effort throughout: a notebook that could not be read costs the notebook and never the
     * turn.
     */
    /**
     * The soundboard in front of this speaker, and the board's own name for resolving what they hit.
     *
     * Four vetoes, and each is a different kind of thing.
     *
     * **A CALLER never gets one**, which is the fiction rather than a limitation: the board is the
     * station's, in the studio, in front of the presenter, and somebody on a telephone is somewhere
     * else. A sound on their turn would mean either that they keep a soundboard at home — a specific
     * comedic premise rather than a default — or that the station played it over the call, which is
     * the HOST's action happening inside a beat the host does not own, and there is no row for that.
     *
     * **A PLAIN kind never gets one**, on `remembers`' argument one field over and `NEWS_SHAPE`'s one
     * module over: a newsreader who hits an air horn after a story has done something worse than sigh
     * over it.
     *
     * **A programme that has spent its ceiling gets none for the rest of its length.** See
     * {@link MAX_PRODUCTION_PADS} for why withdrawal is the enforcement rather than a budget in the
     * prompt.
     *
     * And a character with no `soundboard`, or one naming a board the library holds nothing on, has
     * nothing to offer — two absences that must not be told apart, because both are a presenter with
     * nothing to reach for.
     *
     * Best-effort like everything else read here: a rack that could not be read costs the programme
     * its drops and never a beat.
     */
    private async boardFor(
        production: Production,
        speaker: CastMember | undefined,
        persona: Persona | undefined,
        spent: number,
    ): Promise<{ name?: string; names: readonly string[] }> {
        // `undefined` is a production with no cast at all, where the presenter says every word — so
        // it is the host, and only an explicit `caller` is refused.
        if (speaker?.role === 'caller') return { names: [] };
        if (PLAIN_KINDS.includes(production.kind.trim().toLowerCase())) return { names: [] };
        if (spent >= MAX_PRODUCTION_PADS) return { names: [] };

        const name = persona?.soundboard;
        if (name === undefined) return { names: [] };

        try {
            const rack = await this.pads.onSet(name);
            return rack.length === 0 ? { names: [] } : { name, names: rack.map(pad => pad.name) };
        } catch (error) {
            this.logger.debug(`productions: could not read the soundboard (${errorText(error)})`);
            return { names: [] };
        }
    }

    /**
     * What a written beat actually hit, resolved against the board that offered it, and RESTED.
     *
     * `WriteBreakJob.hits`' twin and held to its rules: a name that resolves to nothing is dropped
     * rather than failing the beat, and the rest happens at SELECTION, which is the inaccuracy
     * `chooseFacts` documents — a production that is later cancelled has still spent its drops.
     */
    private async hits(board: string | undefined, script: string): Promise<PadHit[]> {
        if (board === undefined) return [];

        const names = padsIn(script);
        if (names.length === 0) return [];

        try {
            const found: PadHit[] = [];
            for (const name of names) {
                const pad = await this.pads.named(board, name);
                if (pad === undefined) continue;

                found.push({ name, padId: pad.id });
                await this.pads.markUsed(pad.id);
            }
            return found;
        } catch (error) {
            this.logger.warn(`productions: could not resolve a soundboard hit (${errorText(error)})`);
            return [];
        }
    }

    private async remembers(
        production: Production,
        speaker: CastMember | undefined,
        firstTurn: boolean,
    ): Promise<{ notebook?: PersonaNotesForPrompt; story?: PersonaStoryForPrompt; preoccupation?: string }> {
        const key = speaker?.personaKey;
        if (key === undefined || PLAIN_KINDS.includes(production.kind.trim().toLowerCase())) return {};

        // The subject this character brought to the programme, decided at CAST time and read here on
        // every one of their turns — which is what makes it the same subject all the way through.
        // It joins the notebook rather than getting a method of its own because the guard above is
        // the whole of what it needs, and a second copy of `PLAIN_KINDS` is a second thing to keep
        // in step: a bulletin handed a standing subject of the presenter's will work it into the
        // news, which is why `NEWS_SHAPE` leaves `allowsPreoccupation` off at the other end. Nothing
        // is spent by reading it, so unlike the two below it is free on every turn.
        const subject = speaker?.preoccupation === undefined ? {} : { preoccupation: speaker.preoccupation };

        const notebook = { ...subject, ...(await this.notebookOf(key)) };
        // A story is offered on a speaker's FIRST turn alone, and only to somebody who rang in. It
        // is the most interesting thing in a prompt by a distance, so offering it on every turn is
        // a caller who tells the same anecdote three times in four minutes — and the presenter's
        // own stories belong to the talk break, where the operator's `storytelling` rung and the
        // `story` band already decide when one is told.
        if (!firstTurn || speaker?.role !== 'caller') return notebook;

        return { ...notebook, ...(await this.storyOf(key)) };
    }

    /** This character's notebook, rested as it is read. */
    private async notebookOf(personaKey: string): Promise<{ notebook?: PersonaNotesForPrompt }> {
        try {
            const { notes, ids } = await this.notes.forPrompt(personaKey);
            if (notes.trait.length === 0 && notes.said.length === 0) return {};

            await this.notes.markUsed(ids);
            return { notebook: notes };
        } catch (error) {
            this.logger.warn(`productions: a turn was written without its character's notebook (${errorText(error)})`);
            return {};
        }
    }

    /** One of this character's stories, rested as it is read. */
    private async storyOf(personaKey: string): Promise<{ story?: PersonaStoryForPrompt }> {
        try {
            const found = await this.stories.forPrompt(personaKey);
            if (found === undefined) return {};

            await this.stories.markTold(found.id);
            return { story: found.story };
        } catch (error) {
            this.logger.warn(`productions: a turn was written without its character's story (${errorText(error)})`);
            return {};
        }
    }

    /**
     * What the installed engine can actually perform, or nothing.
     *
     * Asked once per pass rather than per beat: it is a round trip to the speech server, and the
     * answer does not change while a production is being written. Never throws, on `SpeechService`'s
     * own rule — a cue is a flourish, and an engine that could not be asked about one must cost the
     * station a plainer programme rather than the programme.
     */
    private async performable(): Promise<readonly SpeechCue[]> {
        try {
            return await this.speech.cues();
        } catch {
            return [];
        }
    }

    /**
     * Each cast member's sheet, by their place in the cast.
     *
     * One read per character rather than one per beat, and the CAST is what it reads from rather
     * than `presenting`: who was cast is what the production decided, possibly hours ago, and
     * resolving the presenter again per pass would put a station that changed host halfway through
     * two characters into one programme.
     *
     * A member whose persona has since been deleted simply has no sheet, which is the same state as
     * a station presenting as nobody: the turn is written plainly and still goes out.
     */
    private async sheets(production: Production, casting: ProductionCast): Promise<Map<number, Persona>> {
        const sheets = new Map<number, Persona>();

        for (const [at, member] of casting.entries()) {
            if (member.personaId === undefined) continue;
            const persona = await this.personas.find(member.personaId);
            if (persona !== undefined) sheets.set(at, persona);
        }

        // A production made before there was a cast at all. The presenter says all of it, which is
        // what every production did until callers arrived.
        if (casting.length === 0) {
            const presenting = await this.personas.presenting(production.personaId);
            if (presenting !== undefined) sheets.set(0, presenting);
        }

        return sheets;
    }

    /**
     * How long this production is, how it is divided, and who says each part.
     *
     * One step because the three answers depend on each other in a ring that has to be broken
     * somewhere: how many turns there are decides how many callers are worth casting, and whether
     * anybody was cast decides which word band the turns are planned in. It is broken by planning
     * TWICE — once to find out roughly how many parts there are, and again once the cast is known —
     * which costs two pieces of arithmetic and no round trips.
     *
     * The alternative was letting the caster ask for the roster and the planner ask for the cast,
     * which is the same ring with a database read inside it.
     */
    private async shape(production: Production): Promise<{ plan: ProductionPlan; casting: ProductionCast }> {
        // The estimate is in the DIALOGUE band, and it has to be: what the caster is being asked is
        // how many TURNS there would be if somebody rang in, and a turn is a third of a beat. The
        // first live run of this made the mistake — a three-minute call-in estimated as 2 monologue
        // beats, which is below the floor for casting anybody, so a phone-in was made with nobody on
        // the phone and nothing said why. If nobody is cast the number is simply discarded.
        const turns = turnsFor(production.targetMs);
        const casting = await this.caster.cast(production, turns);

        // A monologue is planned exactly as it always was, so a station that casts nobody gets the
        // production it got before any of this: same band, same count, same word budgets.
        if (!isDialogue(casting)) return { plan: planProduction(production.targetMs), casting };

        const speakers = speakerOrder(casting, turns);
        // Weighted rather than split evenly, which is the other half of what made a phone-in sound
        // like two people trading paragraphs: the host asks in about twenty words and the caller
        // answers in about forty. See `turnWeights`.
        const plan = planProduction(production.targetMs, { dialogue: true, speakers, weights: turnWeights(casting, speakers) });

        return { plan, casting };
    }

    /**
     * What this production's work is worth at the model, right now.
     *
     * Earliest deadline: background while its slot is far off, and on-air work as it approaches. The
     * number is real — somebody chose the slot — which is why this needs no aging rule.
     */
    private priorityOf(production: Production) {
        return priorityForSlot(production.scheduledFor, Date.now(), DEADLINE_MS);
    }

    /**
     * What half of the day this production goes out in.
     *
     * Its SLOT where a band commissioned it, and now where nothing did — the standing call-in rule
     * writes no `scheduledFor` because such a production airs when it is ready rather than at an
     * instant somebody chose, and "when it is ready" is minutes from here. That approximation is
     * safe at this resolution and would not be at the hour's: a daypart's window is hours wide,
     * where `roughTime`'s is seven or eight minutes, which is why only the daypart is sent.
     *
     * The one thing it cannot get right is a production drafted either side of a boundary, which is
     * an hour or two of the day rather than the whole of it, and costs one wrong word rather than a
     * programme.
     */
    private whenItAirs(production: Production): RoughTime {
        return dayPart(production.scheduledFor ?? Date.now(), stationZone(this.config));
    }
}

/**
 * One answer as words an engine may be handed, or an empty string.
 *
 * An empty answer and one that was nothing but a stage direction are the same thing to the loop
 * above — a beat that has to be asked for again — so this flattens `undefined` to `''` rather than
 * making every call site carry the distinction.
 */
/**
 * One answer as words an engine may be handed.
 *
 * The pads are passed for the same reason the reactions are: `speakableScript` strips every
 * bracketed run it was not told to spare, so a beat whose board was never mentioned here loses its
 * drop between the model answering and the row being written — silently, with the cue gone before
 * anything could resolve it.
 */
const speakable = (text: string, reactions: readonly SpeechCue[], pads: readonly string[] = []): string =>
    speakableScript(text, { perform: reactions, pads }) ?? '';

/**
 * Which of this character's signatures the rest of the programme has already used.
 *
 * The beat being re-drafted is excluded by the caller, deliberately. Its own first attempt is about
 * to be thrown away, so counting it would tell the re-draft that a phrase is spent when the only
 * thing that spent it is the text being replaced.
 */
function spentOf(persona: Persona | undefined, scripts: readonly string[]): string[] {
    return persona === undefined ? [] : spentCatchphrases(persona, scripts);
}

/**
 * This speaker's OTHER turns, which is what a signature is spent by.
 *
 * Per speaker rather than per programme: a shared list tells the host its catchphrase is spent by a
 * caller who never said it, and tells a caller who has spoken once that they have used up a phrase
 * somebody else used.
 */
function mineExcept(beats: readonly Segment[], plan: ProductionPlan, speaker: number, skip: number): string[] {
    return beats.flatMap((beat, index) => (index === skip || (plan.beats[index]?.speaker ?? 0) !== speaker ? [] : [beat.script ?? '']));
}

/** Whether this is the first the listener has heard of this speaker, which is where a caller says hello. */
function firstTurnOf(plan: ProductionPlan, index: number, speaker: number): boolean {
    return !plan.beats.slice(0, index).some(beat => (beat.speaker ?? 0) === speaker);
}

/**
 * Who the host is talking TO on this programme, or nobody at all.
 *
 * The first caller in the cast, which is the one the host opens by bringing in and closes by seeing
 * off. A programme with two of them still has one opening and one ending, and the second caller
 * arrives the way any caller does — on their own first turn, which `firstTurn` already marks.
 */
const guestOf = (cast: ProductionCast): CastMember | undefined => cast.find(member => member.role === 'caller');

/**
 * A model's answer as JSON, or `undefined`.
 *
 * Tolerant of the wrapping a local model puts around it — a fence, a preface, reasoning in front —
 * for the same reason `readClaims` is: none of that is a reason to lose an answer that is otherwise
 * exactly right.
 */
function parseJson(answer: string): unknown {
    const trimmed = answer.trim();
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    const body = fenced?.[1]?.trim() ?? trimmed;

    // The outermost object, so a preface before it is skipped rather than breaking the parse.
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;

    try {
        return JSON.parse(body.slice(start, end + 1));
    } catch {
        return undefined;
    }
}
