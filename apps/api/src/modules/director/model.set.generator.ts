import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { TasteRepository, type StationTaste } from '#modules/catalog/taste.repository.js';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import { writeCapture } from '#modules/llm/llm.capture.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { advisoryPolicy, demandsClean } from './advisory.policy.js';
import { artistKey } from './rotation.keys.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';
import { readPicks, setPrompt, type TastePrompt } from './set.prompt.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * A model choosing what the station plays, with the catalog draw underneath it.
 *
 * Registered AHEAD of `CatalogSetGenerator` in `SetGeneratorChain` rather than instead of it, so
 * everything that can go wrong here — no plugin, a plugin that is down, a model that names records
 * the library has never heard of, a host answering at two tokens a second — is topped up by a draw
 * that cannot fail. That is not belt and braces, it is the design: **a slow model must cost a
 * duller hour, never a silent station.**
 *
 * Note what "topped up" means and how it differs from the break writer this is shaped on. A writer
 * either produced a sentence or it did not. This can produce SIX of fifteen and have done most of
 * the job, so the chain keeps those six and asks the floor for nine. A partial answer is a good
 * answer here.
 *
 * ## It does nothing at all until an operator asks
 *
 * `llm.setGenerator` is off by default. With it off this declines before it has done anything, and
 * so does a station with no model plugin, because {@link LlmService.canGenerate} is an ordinary
 * question with an ordinary "no".
 *
 * ## The brief is this binding's whole reason to exist
 *
 * {@link SetInputs.brief} is what the operator asked this broadcast to play, and acting on it is
 * something only a model can do — the floor draws from a weighted sample and has nowhere to put a
 * sentence. So a briefed station whose model is off, or slow, or naming records nothing can find,
 * still gets an hour of programming; it just gets the station's ordinary hour rather than the one
 * that was asked for. That is the same trade every other model binding here makes, and it is why
 * the brief is passed rather than enforced.
 *
 * ## Variety is a re-pick, not a tool filter
 *
 * `docs/todo/station-intelligence.md` §1 is explicit and counter-intuitive here: a model given
 * tools that already filter out the on-air artist returns a WORSE pool on a small library, so the
 * tools stay open and the answer is re-picked when it repeats. The window that is checked is
 * neighbouring slots rather than the current track alone — an exclusion remembering only the track
 * just played keeps returning to whoever ranks next highest, which is the same artist every *other*
 * slot rather than every slot.
 *
 * The window arrives free: {@link SetInputs.avoidSongKeys} is what the lineup already holds, and the
 * chain grows it as each generator answers.
 *
 * ## The breaker counts the right failure
 *
 * A run that searched honestly and came back with nothing is a fact about a thin library, and
 * counting it would let a small catalogue disable the model and advise changing it. What IS counted
 * is a run that made no tool call at all, which is a model failing to drive what it was given. That
 * distinction is why `LlmService.converse` reports `toolCallsMade`.
 *
 * ## Why it yields rather than competing
 *
 * `LlmGate` holds one generation at a time, and `ModelTalkBreakWriter` gives up on the queue after
 * ten seconds and lets the floor write. A refill is a background job nobody is waiting on, and a
 * break is a slot in a running order that will be handed over whether or not the words arrive — so
 * when the two want the model at once, this is the one that should lose.
 *
 * It says so now, as `background` on the call below, and that is a change from how this used to
 * work. The yielding was expressed only by bounding {@link BUDGET_MS}, which was never sufficient:
 * a bound of three minutes is still three minutes in front of a writer that waits ten seconds, and
 * 17 of the 24 `failed` script rows on 2026-08-16 were exactly that. A tier lets a break take the
 * model BACK rather than merely be ahead in a queue it never reaches the front of.
 *
 * **Do not widen `LlmGate` to a pool to avoid that trade.** It is a small change (`busy` becomes a
 * counter) and it is the wrong one: the model is one process with one set of weights on one GPU, so
 * a second app-side slot moves the queue to the server, where there is no `maxWaitMs` — and that
 * timeout is the entire mechanism by which a break falls through to a correct sentence. Widening
 * the gate would remove the thing that keeps a slow model from costing a silent station, while
 * looking like it was helping.
 */

/** What `SetGenerator.name` reports for anything chosen here. */
export const MODEL_GENERATOR = 'model';

/**
 * How long to wait for the model's SLOT before giving up.
 *
 * Generous where the break writer's is not, and the asymmetry is the point: nobody is waiting on a
 * refill, so queueing behind a break is free. It is bounded at all only so a wedged gate cannot
 * leave a job running until the process restarts.
 */
export const MAX_WAIT_MS = 60_000;

/**
 * How long the whole conversation may take once it has the slot.
 *
 * This used to be the number that decided how long a talk break could be degraded to the
 * deterministic writer, because a break arriving mid-refill waited ten seconds and gave up. **It is
 * no longer that number**: a break now preempts this, so the worst a refill costs one is however
 * long the model takes to notice its signal and stop.
 *
 * What the bound is still for is this job's own sake — a wedged generation must not run until the
 * process restarts — and as the ceiling on how long a refill may spend before the chain gives up on
 * it. Three minutes is roughly one refill's worth of searching and answering on the station's own
 * remote host.
 */
export const BUDGET_MS = 180_000;

/**
 * How many rounds of searching the model gets before it must answer.
 *
 * Higher than `LlmService.MAX_TOOL_STEPS` because a break writer needs no tools at all, while one
 * search is not enough to programme an hour. The last step is asked without tools, so this is
 * rounds of searching plus one to answer.
 *
 * **Lowered from eight after the first live run**, which used every one of them. Each round leaves
 * its whole result set in the conversation, so the eighth search is reasoned about with seven
 * searches' worth of library listing in front of it — and on a host whose context spills VRAM that
 * is what pushed the answer itself past the token ceiling. Fewer, larger searches beat more,
 * smaller ones here.
 */
export const MAX_TOOL_STEPS = 5;

/**
 * A ceiling on the answer, in tokens. Two dozen records of JSON is small; the headroom is reasoning.
 *
 * **Raised from 2,000 once the searches started returning enough to programme from**, which is the
 * ordering worth remembering: the ceiling was comfortable while a search answered ten rows and a
 * model had little to weigh, and started truncating answers as soon as it had thirty and a brief it
 * could act on. It bit hardest on the best runs. A truncated answer is no longer catastrophic —
 * `readPicks` reads complete objects one at a time — but it still costs whatever the model had left
 * to say, and the records it names last are the ones it thought hardest about.
 */
export const MAX_OUTPUT_TOKENS = 6_000;

/**
 * How many of the operator's likes and dislikes, per kind, are read for the prompt.
 *
 * Small on purpose. Every line of these lists is context the model then has less room to think in,
 * on a host where that is the difference between an answer and a run that finishes on `length`, and
 * a taste block longer than the search results it is meant to steer would be steering nothing. A
 * station with more opinions than this is not shown the rest, and `station_taste` is how a model
 * that wants the whole list asks for it.
 */
export const TASTE_SHOWN = 15;

/**
 * How many of the library's styles are shown.
 *
 * Sized against the reader's context rather than against completeness, exactly like
 * {@link TASTE_SHOWN}. The live library carries around 350 distinct tags and the tail of that is
 * styles two records happen to have been given; forty covers everything anyone would programme an
 * hour from, on one line, and the model can always search a word that is not on the list.
 */
export const STYLES_SHOWN = 40;

/** How much of an unreadable answer is logged. Enough to see the shape, not enough to flood a line. */
const ANSWER_LOG_CHARS = 400;

/**
 * The `deadair.settings` keys this binding reads.
 *
 * There is no persona key here any more. What the station plays was one free-text setting and is
 * now the `music` line of the persona on air, read by the caller and handed over on the inputs —
 * so choosing a character changes what it programmes as well as how it talks, which is what makes
 * putting one on air a single decision rather than three.
 */
export const MODEL_GENERATOR_KEYS = {
    enabled: 'llm.setGenerator',
    model: 'llm.setModel',
} as const;

@Injectable()
export class ModelSetGenerator extends SetGenerator {
    readonly name = MODEL_GENERATOR;

    constructor(
        private readonly llm: LlmService,
        private readonly taste: TasteRepository,
        private readonly tracks: TracksRepository,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {
        super();
    }

    async generate(inputs: SetInputs): Promise<TrackPick[]> {
        if (inputs.count <= 0) return [];

        // Both cheap, both silent, and both an ordinary state rather than a fault. Read per refill
        // rather than held, so an operator turning the model on gets it on the next one.
        if (!this.config.get(MODEL_GENERATOR_KEYS.enabled, false)) return [];
        if (!this.llm.canGenerate()) {
            this.logger.debug(`director: no model to programme with (${this.llm.explainGenerator()})`);
            return [];
        }

        const model = this.config.get(MODEL_GENERATOR_KEYS.model, '').trim();
        const messages = setPrompt(
            { count: inputs.count, avoid: describeAvoided(inputs), ...(inputs.brief === undefined ? {} : { brief: inputs.brief }) },
            {
                station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
                ...(inputs.persona?.music === undefined ? {} : { music: inputs.persona.music }),
                taste: await this.describeTaste(),
                styles: await this.describeStyles(),
                // Only the hard rule, and only as advice. `PickResolver` enforces it whatever the
                // model does; this is here so a briefed refill does not spend half its picks on
                // records that will be dropped. See `SetPromptSettings.cleanOnly`.
                cleanOnly: demandsClean(advisoryPolicy(this.config)),
            },
        );

        const started = Date.now();
        const result = await this.llm.converse(
            {
                messages,
                ...(model.length === 0 ? {} : { model }),
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                // The same call `ModelTalkBreakWriter` makes, for the same MEASURED reason, and it
                // was not obvious that programming an hour would want it too: choosing records
                // looks far more like a reasoning problem than writing a link does.
                //
                // It is not, and the first live run proved it. At `high` this searched eight times,
                // spent 14,377 tokens over 85 seconds, finished on `length` and emitted an empty
                // answer -- the model used its entire visible allowance thinking and never said a
                // word. That is the identical failure recorded on `MAX_OUTPUT_TOKENS` in the break
                // writer. The work here is recall and filtering, which the tool does; what is left
                // for the model is choosing between rows it has been handed.
                reasoningEffort: 'low',
            },
            // `background` is what makes this yield rather than compete: nobody is waiting on a
            // refill, so it queues behind every break AND is told to stop when one arrives while it
            // holds the model. Losing a refill mid-answer costs nothing that lasts — the chain asks
            // the next pass for whatever is still missing, and `CatalogSetGenerator` is underneath
            // it either way.
            { budgetMs: BUDGET_MS, maxWaitMs: MAX_WAIT_MS, maxToolSteps: MAX_TOOL_STEPS, priority: 'background' },
        );

        const named = readPicks(result.text, inputs.count);
        const picks = spaceOwnArtists(named);

        // Logged whichever way it went, and with the numbers rather than a verdict. "The model got
        // slower" and "the model stopped searching" are questions that can only be asked of figures
        // gathered before anybody suspected they mattered — the same argument `WriteAttempt`
        // records a duration for every writer rather than only a slow one.
        this.logger.info('director: a model programmed part of the running order', {
            // What it was told to programme, where the numbers are. "Why did it choose these" is
            // otherwise a question about a prompt nothing kept.
            ...(inputs.brief === undefined ? {} : { brief: inputs.brief }),
            asked: inputs.count,
            named: picks.length,
            searches: result.toolCallsMade,
            durationMs: Date.now() - started,
            finish: result.finishReason,
            ...(result.usage === undefined ? {} : { tokens: result.usage.totalTokens ?? result.usage.outputTokens }),
        });

        // Said whether or not anything came back, because a run that answered SHORT because it ran
        // out of room is the one failure here that looks exactly like a model with nothing to say.
        // It cost a live run eleven jazz records and was diagnosable only by noticing that the two
        // it did name were spelled like fragments of JSON.
        if (result.finishReason === 'length') {
            this.logger.warn('director: the model ran out of room before it finished answering; some of its choices were lost', {
                asked: inputs.count,
                named: picks.length,
                limit: MAX_OUTPUT_TOKENS,
            });
        }

        // Everything the model saw and everything it said, while the operator has the switch on.
        //
        // The same switch the break writers fill `script_history`'s two capture columns from, and
        // for the same evening: this is prompt tuning, not a record.
        //
        // To a FILE, and that is the second attempt. It was one log line with the transcript in a
        // field, which the log store truncated at 512 characters — so the first capture of the
        // failure it was written for arrived as two rules of the system prompt and an ellipsis.
        // What stays here is the pointer, which is all a log line should have been carrying.
        //
        // A zero-pick run is what this was added for and it deliberately captures every run anyway:
        // the useful comparison when a refill declines is against the one before it that worked,
        // and a capture that starts once something has already gone wrong never has that.
        if (captureWrites(this.config)) {
            const path = await writeCapture(
                this.config,
                this.logger,
                {
                    kind: 'set',
                    context: {
                        asked: inputs.count,
                        named: picks.length,
                        searches: result.toolCallsMade,
                        finish: result.finishReason,
                        ...(inputs.brief === undefined ? {} : { brief: inputs.brief }),
                        ...(model.length === 0 ? {} : { model }),
                    },
                    transcript: result.transcript,
                    // The transcript stops before the answer, so the two are kept side by side.
                    answer: result.text,
                },
                Date.now(),
            );
            if (path !== undefined) this.logger.info('director: kept what the model was shown', { file: path, named: picks.length });
        }

        if (picks.length === 0) {
            if (result.toolCallsMade === 0) {
                // The one failure worth naming as the model's own. A run that searched and found
                // nothing is a thin library and is not this; a run that never searched and answered
                // anyway is a model not driving what it was given, and it will do it again.
                this.logger.warn('director: the model chose nothing and never searched the library; it is not using its tools');
            } else {
                // It searched and still produced nothing this could read. Without the answer itself
                // that is undiagnosable — a model that found nothing, one that answered in prose and
                // one that spent its whole allowance thinking are the same empty list from here, and
                // they need three different fixes. Truncated because the destination is a log line.
                this.logger.warn('director: the model searched but named no records this could read', {
                    finish: result.finishReason,
                    said: result.text.trim().slice(0, ANSWER_LOG_CHARS),
                });
            }
        }

        return picks;
    }

    /**
     * The words the library answers to, as prompt lines, or nothing.
     *
     * Read per refill rather than held, on the same argument as {@link describeTaste} and with more
     * force: the vocabulary moves as the enrichment pass reaches records, so a station that just
     * catalogued an artist should be able to programme them on the next hour.
     *
     * The count rides in the text (`heavy metal (240)`) rather than being formatted in the prompt,
     * because the prompt half is a pure function and giving it a shape to render would make it own a
     * decision this side already made.
     *
     * `cleanOnly` is passed for the same reason `SetPromptSettings.cleanOnly` exists: a station that
     * may only play positively-clean copies must not be handed a style it cannot fill.
     */
    private async describeStyles(): Promise<string[] | undefined> {
        let vocabulary: { style: string; records: number }[];
        try {
            vocabulary = await this.tracks.styleVocabulary(STYLES_SHOWN, demandsClean(advisoryPolicy(this.config)));
        } catch (error) {
            // Same trade as {@link describeTaste}: this makes a search better and enforces nothing,
            // so a read that failed costs the steering and never the set. The model falls back to
            // guessing a style word, which is what it did before this existed.
            this.logger.warn(`director: could not read the library's styles; programming without them (${errorText(error)})`);
            return undefined;
        }

        return vocabulary.map(entry => `${entry.style} (${entry.records})`);
    }

    /**
     * The operator's taste, as prompt lines, or nothing.
     *
     * Read per refill rather than held, like every other setting here: an operator who likes a
     * record now expects it to count on the next hour, not after a restart.
     *
     * A read that fails costs the steering and not the set. This is advice — the dislikes are
     * enforced in `PickResolver` from the ratings as they stand at resolution — so a station whose
     * catalog read threw still cannot air a forbidden record. Losing the whole refill over a list
     * that only makes it better would be the wrong trade.
     */
    private async describeTaste(): Promise<TastePrompt | undefined> {
        let taste: StationTaste;
        try {
            taste = await this.taste.taste(TASTE_SHOWN);
        } catch (error) {
            this.logger.warn(`director: could not read what the operator likes; programming without it (${errorText(error)})`);
            return undefined;
        }

        const named = (set: StationTaste['likedTracks']): string[] => set.shown.map(entry => `"${entry.title}" by ${entry.artist}`);
        return {
            likedArtists: taste.likedArtists.shown.map(entry => entry.name),
            dislikedArtists: taste.dislikedArtists.shown.map(entry => entry.name),
            likedTracks: named(taste.likedTracks),
            dislikedTracks: named(taste.dislikedTracks),
        };
    }
}

/**
 * The records the lineup already holds, as something a model can read.
 *
 * The keys are normalized for comparison and unreadable as prose, so what goes in the prompt is a
 * reconstruction rather than the key itself: `artist:title` is what `songKey` builds, and splitting
 * it back is exact because `normalizeKey` leaves the separator alone.
 *
 * A key that does not split is skipped rather than shown raw. It would still be a real record in
 * the model's context that no tool returned, which is the one thing this prompt is shaped to avoid,
 * and showing it mangled buys nothing.
 */
function describeAvoided(inputs: SetInputs): string[] {
    const described: string[] = [];

    for (const key of inputs.avoidSongKeys ?? []) {
        const separator = key.indexOf(':');
        if (separator <= 0 || separator === key.length - 1) continue;

        described.push(`"${key.slice(separator + 1)}" by ${key.slice(0, separator)}`);
    }
    return described;
}

/**
 * Re-pick when the model put one artist on its own heels.
 *
 * The §1 rule, applied to the answer rather than to the tools. It is a REORDER and never a drop:
 * the model chose these records and dropping one for its neighbour's sake would cost the station a
 * track over something that a swap fixes.
 *
 * The same shape as `spaceArtists` in `rotation.rules.ts` and deliberately not that function, which
 * takes candidates carrying keys and a rating. Here there is nothing but a name yet — resolution
 * has not happened — so this works on the picks themselves. `PickResolver` spaces again afterwards
 * on what actually survived, which is the pass that has the final word.
 */
function spaceOwnArtists(picks: readonly TrackPick[]): TrackPick[] {
    const pending = [...picks];
    const spaced: TrackPick[] = [];
    let previous: string | undefined;

    while (pending.length > 0) {
        // The first pick by anyone other than whoever was just placed; the head when every
        // remaining record is by them, because nothing can be done about that and stalling is
        // worse.
        const index = pending.findIndex(pick => artistKey([pick.artist]) !== previous);
        const [next] = pending.splice(index < 0 ? 0 : index, 1);

        spaced.push(next!);
        previous = artistKey([next!.artist]);
    }
    return spaced;
}
