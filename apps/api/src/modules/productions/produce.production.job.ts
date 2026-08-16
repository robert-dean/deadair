import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { errorText } from '#modules/shared/error.text.js';
import { checkBeat, correctionNote } from './production.checks.js';
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
 * Sized with headroom for REASONING, which is spent out of this same allowance before any text is
 * emitted. That is not a hypothetical: the fact verifier ran with `maxOutputTokens: 8` for its whole
 * life and never once reached an answer, because low-effort reasoning alone exceeded it. A beat of
 * 260 words is perhaps 350 tokens of text, and the rest of this is room to think first.
 */
export const OUTLINE_OUTPUT_TOKENS = 4_000;
export const BEAT_OUTPUT_TOKENS = 2_000;

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

        const plan = planProduction(claimed.targetMs);
        const persona = await this.personas.presenting(claimed.personaId);

        const answer = await this.llm.converse(
            {
                messages: outlinePrompt({
                    kind: claimed.kind,
                    title: claimed.title,
                    ...(claimed.brief === undefined ? {} : { brief: claimed.brief }),
                    beats: plan.beats.length,
                    wordsPerBeat: plan.beats[0]?.words ?? 0,
                    ...(persona === undefined ? {} : { persona }),
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
            return await this.productions.savePlan(claimed.id, plan, 'outlining', 'drafting');
        }

        return await this.productions.saveOutline(claimed.id, outline, plan, 'drafting');
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

        // A `quick` production has no outline pass, so it arrives here with no plan either.
        const plan: ProductionPlan = claimed.plan ?? planProduction(claimed.targetMs);
        if (claimed.plan === undefined) await this.productions.savePlan(claimed.id, plan, 'drafting', 'drafting');

        const persona = await this.personas.presenting(claimed.personaId);
        const station = this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title);
        let runIn: string | undefined;

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
            const answer = await this.llm.converse(
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
                        station,
                    }),
                    maxOutputTokens: BEAT_OUTPUT_TOKENS,
                    reasoningEffort: 'low',
                },
                { budgetMs: BEAT_BUDGET_MS, maxWaitMs: WAIT_MS, tools: false, priority: this.priorityOf(claimed) },
            );

            const script = answer.text.trim();
            if (script.length === 0) {
                // Not survivable the way a missing break is. A production with a hole in the middle
                // is not a shorter production, so the whole thing stops here and says why.
                await this.productions.fail(claimed.id, `beat ${beat.ordinal + 1} came back empty`);
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

            const problems = checkBeat({
                text: beat.script,
                words: plan.beats[index]?.words ?? beat.script.split(/\s+/).length,
                ordinal: beat.productionOrdinal ?? index,
                priorBeats: beats.slice(0, index).map(earlier => earlier.script ?? ''),
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
                        ...(index === 0 ? {} : { runIn: runInFrom(beats[index - 1]?.script ?? '') }),
                        ...(persona === undefined ? {} : { persona }),
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
