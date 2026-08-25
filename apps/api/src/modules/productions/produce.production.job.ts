import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import { spentCatchphrases } from '#modules/personas/persona.sheet.js';
import type { Persona } from '#modules/personas/persona.js';
import { SegmentRepository, type Segment } from '#modules/render/segment.repository.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { errorText } from '#modules/shared/error.text.js';
import { checkBeat, correctionNote } from './production.checks.js';
import { isDialogue, speakerOrder, type ProductionCast } from './production.cast.js';
import { ProductionCaster } from './production.caster.js';
import { planProduction } from './production.plan.js';
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
        private readonly personas: PersonaRepository,
        private readonly caster: ProductionCaster,
        private readonly llm: LlmService,
        private readonly jobs: PgBossJobBroker,
        private readonly config: AppConfig,
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

        const answer = await this.llm.converse(
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
                }),
                maxOutputTokens: OUTLINE_OUTPUT_TOKENS,
                // Planning IS the reasoning problem here, unlike a break. Left at the model's own
                // default rather than pinned low, which is the one call in this file where thinking
                // buys something.
            },
            { budgetMs: OUTLINE_BUDGET_MS, maxWaitMs: WAIT_MS, tools: false, priority: this.priorityOf(claimed) },
        );

        // A model that gave nothing usable is not a failure of the production. The plan is already
        // computed, so the beats can be drafted from the brief alone — which is what a `quick`
        // production does by design.
        const outline = coerceOutline(parseJson(answer.text), 0);
        if (outline === undefined) {
            this.logger.info('productions: the model gave no usable outline, so the beats will be drafted from the brief', {
                production: claimed.id,
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

        const persona = await this.personas.presenting(claimed.personaId);
        const station = this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title);
        let runIn: string | undefined;
        // Everything written so far, for the spent-signature check. Held in memory rather than
        // re-read per beat: this loop is the only writer of them and it has just produced them.
        const written: string[] = [];

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
            // Which of this character's signatures the programme has already spent. The measured
            // failure without it: "I said what I said" in 23 of 24 beats, because the sheet offers
            // its catchphrases to every beat and no beat could see what the others had done.
            const spent = persona === undefined ? [] : spentCatchphrases(persona, written);
            // Built once so the retry below asks for exactly the same thing. A retry that rebuilt the
            // prompt would be a different question, and a beat that failed twice for two different
            // reasons is one nobody can diagnose.
            const ask = async (): Promise<string> =>
                (
                    await this.llm.converse(
                        {
                            messages: beatPrompt({
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
                                station,
                            }),
                            maxOutputTokens: BEAT_OUTPUT_TOKENS,
                            reasoningEffort: 'low',
                        },
                        { budgetMs: BEAT_BUDGET_MS, maxWaitMs: WAIT_MS, tools: false, priority: this.priorityOf(claimed) },
                    )
                ).text.trim();

            let script = await ask();

            // Asked again before the production is written off. A beat that came back empty is the
            // model having spent its allowance on reasoning rather than an answer, which is a bad
            // roll rather than a bad brief — and failing here throws away every beat already
            // written, since a production cannot air with a hole in it.
            for (let attempt = 0; script.length === 0 && attempt < EMPTY_BEAT_RETRIES; attempt++) {
                this.logger.info('productions: a beat came back empty, so it is being asked again', {
                    production: claimed.id,
                    beat: beat.ordinal,
                });
                script = await ask();
            }

            if (script.length === 0) {
                // Out of attempts. Not survivable the way a missing break is: another break is along
                // shortly and a programme with a hole in it is not a shorter programme.
                await this.productions.fail(claimed.id, `beat ${beat.ordinal + 1} came back empty twice`);
                return false;
            }

            await this.segments.plan({
                kind: claimed.kind,
                label: `${claimed.title} (${beat.ordinal + 1}/${plan.beats.length})`,
                script,
                writer: 'model',
                productionId: claimed.id,
                productionOrdinal: beat.ordinal,
                ...(persona?.voice === undefined ? {} : { voice: persona.voice }),
            });

            written.push(script);
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
        const persona = await this.personas.presenting(claimed.personaId);
        const station = this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title);
        let redrafted = 0;

        for (const [index, beat] of beats.entries()) {
            if (beat.script === undefined) continue;

            const runIn = index === 0 ? undefined : runInFrom(beats[index - 1]?.script ?? '');
            const problems = checkBeat({
                text: beat.script,
                words: plan.beats[index]?.words ?? beat.script.split(/\s+/).length,
                ordinal: beat.productionOrdinal ?? index,
                priorBeats: beats.slice(0, index).map(earlier => earlier.script ?? ''),
                // The same words this beat was handed, so a beat that recited them instead of
                // carrying on from them is caught.
                ...(runIn === undefined ? {} : { runIn }),
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
                        // Everything the programme says EXCEPT this beat: a re-draft must not be
                        // told its own signature is spent by its own first attempt, which would
                        // forbid the one line it is allowed to keep.
                        ...(spentOf(persona, beats, index).length === 0 ? {} : { spent: spentOf(persona, beats, index) }),
                        station,
                        correction: correctionNote(problems),
                    }),
                    maxOutputTokens: BEAT_OUTPUT_TOKENS,
                    reasoningEffort: 'low',
                },
                { budgetMs: BEAT_BUDGET_MS, maxWaitMs: WAIT_MS, tools: false, priority: this.priorityOf(claimed) },
            );

            const rewritten = answer.text.trim();
            // A re-draft that came back empty leaves the original in place. The first attempt passed
            // enough to be spoken, and a beat with problems is better than no beat at all — which is
            // the opposite of the drafting rule above, because there the alternative was a hole.
            if (rewritten.length === 0) continue;

            await this.segments.writeScript(beat.id, { script: rewritten, label: beat.label, writer: 'model' });
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
        const rough = planProduction(production.targetMs);
        const casting = await this.caster.cast(production, rough.beats.length);
        const dialogue = isDialogue(casting);

        // A monologue is planned exactly as it always was, so a station that casts nobody gets the
        // production it got before any of this: same band, same count, same word budgets.
        if (!dialogue) return { plan: rough, casting };

        // Twice, because the turn count is what the speakers are assigned across and the count comes
        // from the dialogue band rather than the monologue one it was just estimated in.
        const turns = planProduction(production.targetMs, { dialogue: true }).beats.length;
        const plan = planProduction(production.targetMs, { dialogue: true, speakers: speakerOrder(casting, turns) });

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
}

/**
 * Which of this character's signatures the rest of the programme has already used.
 *
 * The beat being re-drafted is excluded deliberately. Its own first attempt is about to be thrown
 * away, so counting it would tell the re-draft that a phrase is spent when the only thing that spent
 * it is the text being replaced.
 */
function spentOf(persona: Persona | undefined, beats: readonly Segment[], skip: number): string[] {
    if (persona === undefined) return [];

    const others = beats.filter((_, index) => index !== skip).map(beat => beat.script ?? '');
    return spentCatchphrases(persona, others);
}

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
