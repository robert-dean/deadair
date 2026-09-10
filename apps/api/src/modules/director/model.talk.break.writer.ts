import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { advisoryPolicy, speaksClean } from './advisory.policy.js';
import { LlmService } from '#modules/llm/llm.service.js';
import { captureWrites } from '#modules/render/script.history.settings.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import {
    breakPrompt,
    maxWordsFor,
    offeredPads,
    permittedYears,
    readAnswer,
    shownWithoutRecent,
    TALK_BREAK_SHAPE,
    writeDecline,
    writeTrim,
    type AnswerGuard,
    type PromptSettings,
} from './break.prompt.js';
import { resolveBreakWords } from './break.words.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import { timeClaimIn } from './clock.words.js';
import { BreakWriter, type BreakWriteRequest, type WriteDetail, type WrittenBreak, patienceFor } from './break.writer.js';
import { labelFor, TALK_BREAK_KIND } from './talk.break.writer.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

/**
 * A model writing the station's talk breaks, with the station's own words underneath it.
 *
 * Registered AHEAD of `TalkBreakWriter` rather than instead of it, so everything that can go wrong
 * here — no plugin, a plugin that is down, a model that rambles, a host answering at two tokens a
 * second — falls through the registry to a correct sentence. That is not belt and braces, it is the
 * design: **a slow model must cost a better sentence, never a silent station.**
 *
 * ## It does nothing at all until an operator asks
 *
 * `llm.breakWriter` is off by default, and with it off this declines before it has done anything.
 * A station with no model plugin declines too, because {@link LlmService.canGenerate} is an ordinary
 * question with an ordinary "no" — every fresh install is that station, and it talks perfectly well.
 *
 * ## Everything about it is bounded, and the bounds are tight on purpose
 *
 * A break is a sentence. It is worth a few seconds of a model's time and no more, because the thing
 * waiting for it is a slot in a running order that will be handed over whether or not the words
 * arrive. The write window (`BreakPlanner.ripen`) is what gives these bounds room to be this tight:
 * by the time a break is asked for, its slot is about a quarter of an hour away.
 */

/** What `segments.writer` records for anything written here. */
export const MODEL_WRITER = 'model';

/**
 * How long to wait for the model's SLOT before giving up and letting the floor write.
 *
 * **Gone, and replaced by `patienceFor` in `break.writer.ts`**, which derives it from when the break
 * is actually due. This was 10 seconds for every break, chosen when the only thing one could queue
 * behind was a three-minute refill, and it was wrong at both ends by the time anything else could
 * hold the model.
 *
 * Too short for a planted break, which is ripened `WRITE_AHEAD` items ahead of its slot and had
 * twenty-five minutes of headroom it was throwing away — it gave up after ten seconds behind a
 * twenty-five second production beat, every time, on a station that had all the time in the world.
 *
 * And too LONG for an `interrupt`, whose whole lead is twenty seconds: a welcome that queued for ten
 * of them had spent half its budget before it could start, and the floor it eventually fell to is
 * the thing that made the welcome possible at all.
 */

/**
 * How long the whole generation may take once it has the slot.
 *
 * Well under `LlmService.GENERATION_BUDGET_MS`, which is sized for a show. It has to cover
 * {@link MAX_OUTPUT_TOKENS} at whatever rate the host manages: measured at roughly fifteen tokens a
 * second on the station's own remote host, which puts a full-length answer near a minute. Past this
 * the floor's sentence is worth more than a better one arriving after the record it was about has
 * finished playing.
 */
export const BUDGET_MS = 120_000;

/**
 * A ceiling on the answer, in tokens.
 *
 * **A reasoning model spends this before it says anything**, and that is measured rather than
 * assumed: at 160 tokens, gpt-oss at low effort returned `outputTokens: 160` and an answer of `""`.
 * It used the entire allowance thinking and never emitted a visible word. The station did the right
 * thing — the guard saw nothing usable, the writer declined and the templates wrote the break — but
 * every break went that way, which is a model that is on and silent rather than a model that works.
 *
 * So this is sized for the THINKING plus the answer, not the answer alone. Forty words is about
 * sixty tokens of that; the rest is headroom for reasoning at low effort. It is not the thing that
 * stops a rambling break being aired: `readAnswer`'s word ceiling does that, cutting an over-long
 * answer back to its last whole sentence. This only stops the station PAYING for an essay of which it
 * would air the first forty words.
 */
export const MAX_OUTPUT_TOKENS = 800;

/**
 * The `deadair.settings` keys this binding reads.
 *
 * There is no persona key here any more. Who the station sounds like was one free-text setting and
 * is now a row in `deadair.personas`, read by the caller and handed over on the request — because a
 * character has to reach the phrasings and the voice as well as the prompt, and a setting could only
 * ever reach the prompt.
 */
export const MODEL_WRITER_KEYS = {
    enabled: 'llm.breakWriter',
    model: 'llm.breakModel',
} as const;

/**
 * OFF, so a fresh install writes its breaks from the phrasings and cannot be slow at it.
 *
 * Exported so `settings.registry.ts` declares the same value this reads, which is the arrangement
 * every other setting has: the registry is where a default is SHOWN and the module is where it is
 * used, and a literal in both is two places to change.
 */
export const MODEL_WRITER_DEFAULT = false;

@Injectable()
export class ModelTalkBreakWriter extends BreakWriter {
    readonly kind = TALK_BREAK_KIND;
    readonly name = MODEL_WRITER;

    /** What the last write cost and how it got there. See {@link detailOfLastWrite}. */
    private lastDetail?: WriteDetail;

    constructor(
        private readonly llm: LlmService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {
        super();
    }

    detailOfLastWrite(): WriteDetail | undefined {
        return this.lastDetail;
    }

    async write(request: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        this.lastDetail = undefined;

        // Both cheap, both silent, and both an ordinary state rather than a fault. Read per break
        // rather than held, so an operator turning the model on hears it on the next break.
        if (!settingIsOn(this.config, MODEL_WRITER_KEYS.enabled, MODEL_WRITER_DEFAULT)) return undefined;
        if (!this.llm.canGenerate()) {
            // At debug: a station with no model configured would otherwise say so every fourth
            // record, and `LlmService` already explains it once where it matters.
            this.logger.debug(`director: no model to write with (${this.llm.explainGenerator()})`);
            return undefined;
        }

        const model = this.config.get(MODEL_WRITER_KEYS.model, '').trim();
        // Held rather than passed inline, because the guard below has to be built from the SAME
        // settings: a persona's latitude decides the word ceiling, and the number the model is told
        // and the number it is refused at have to come from one `maxWordsFor` call over one object.
        const settings: PromptSettings = {
            station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
            // The persona's own name where it has one, and the station's behind it. A persona
            // that is a manner rather than a character has no reason to rename the presenter.
            dj: request.persona?.djName ?? this.config.get(TEMPLATE_KEYS.djName, ''),
            // Read per break like every other setting here, so an operator's change lands on
            // the next one rather than after a restart.
            cleanLanguage: speaksClean(advisoryPolicy(this.config)),
            // The station's own ceiling, read here rather than left to `DEFAULT_MAX_WORDS` — which
            // is now this setting's DEFAULT rather than the number itself, so the two cannot
            // disagree. It reaches the guard below through `maxWordsFor` off this same object, which
            // is the one rule that matters: what the model is told and what it is refused at have to
            // come from one call.
            maxWords: resolveBreakWords(this.config),
            ...(request.persona === undefined ? {} : { persona: request.persona }),
            // Carried across rather than read here, for the reason the persona is: the caller read
            // the notebook and rested what it took, so a writer that fetched its own would spend the
            // rotation a second time and show a different character to the guard than to the prompt.
            ...(request.notebook === undefined ? {} : { notebook: request.notebook }),
            // Carried across for the notebook's reason exactly: the caller chose ONE story and
            // rested it, so a writer that fetched its own would spend the rotation a second time and
            // offer this break a story the record of it says was never told.
            ...(request.story === undefined ? {} : { story: request.story }),
            // Carried across for the same reason, and the SHAPE is what decides whether any of it is
            // offered: this writer passes what the engine can do, and `TALK_BREAK_SHAPE` is what says
            // a link between two records is a place to do it.
            ...(request.reactions === undefined ? {} : { reactions: request.reactions }),
            // And the rack, on the same terms: the caller answers what this character has to hand
            // and `TALK_BREAK_SHAPE.allowsPads` is what says a link is where it may be used.
            ...(request.pads === undefined ? {} : { pads: request.pads }),
            // And the subject, on those same terms one more time: the caller says which one came
            // round and `TALK_BREAK_SHAPE.allowsPreoccupation` says a link is where it may be raised.
            ...(request.preoccupation === undefined ? {} : { preoccupation: request.preoccupation }),
        };
        // Named rather than defaulted: what this binding writes is a link between two records, and a
        // writer that said nothing about its shape would silently get that whatever it was.
        const messages = breakPrompt(request, settings, TALK_BREAK_SHAPE);

        const result = await this.llm.converse(
            {
                messages,
                ...(model.length === 0 ? {} : { model }),
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                // A talk break is not a reasoning problem, and on a host that spills its context
                // this is the difference between a break and a fall-through.
                reasoningEffort: 'low',
            },
            {
                // Nothing to look up: both records are already in the prompt. A tool round trip
                // here would buy a fact the station was not asked for at the cost of another whole
                // generation, and the one thing this must not do is be slow.
                tools: false,
                budgetMs: BUDGET_MS,
                // Derived from when this break is due rather than fixed: see `patienceFor`.
                maxWaitMs: patienceFor(request.airsAt),
                // Absent for every break that is going on air, which is the gate's own default.
                // Present only for a rehearsal, which must not outrank one.
                ...(request.priority === undefined ? {} : { priority: request.priority }),
            },
        );

        const guard: AnswerGuard = {
            // The prompt's own ceiling rather than the station's default, which for a persona with
            // latitude is a larger number. Refusing at 40 what was asked for at 70 would decline
            // every break the character wrote, silently, and look exactly like a model that is off.
            maxWords: maxWordsFor(settings, TALK_BREAK_SHAPE),
            // The records the shape says this break has to be about, which for a link is both of the
            // ones it was shown. Taken from the same two fields the prompt was built from, so a
            // break is only ever refused for failing to name something it was actually given.
            ...(TALK_BREAK_SHAPE.mustNameRecord === true ? { names: [request.previous, request.next] } : {}),
            // The same two records kept APART, so a cue can be judged against the side it is on.
            // Unconditional where `names` is gated on the shape, because cueing the wrong record is
            // wrong for any kind that has both — there is no shape that would want it excused — and
            // `misCuedIn` already answers nothing unless both are actually present.
            cues: {
                ...(request.previous === undefined ? {} : { previous: request.previous }),
                ...(request.next === undefined ? {} : { next: request.next }),
            },
            ...(request.persona === undefined ? {} : { persona: request.persona }),
            // The same list the prompt was built from, which is what keeps the spent-signature rule
            // a bargain rather than a trick: the model is refused only for repeating something it
            // was shown and told not to repeat.
            ...(request.recent === undefined ? {} : { recent: request.recent }),
            // The same daypart the prompt stated, so a script is refused for contradicting it only
            // where it was actually told. This is the kind of break that had never been told at all
            // — see `BreakPlanner.slotsFor` — which is why the talk break is where the word "tonight"
            // came out through twelve of thirty-nine consecutive MORNING breaks.
            ...(request.dayPart === undefined ? {} : { dayPart: request.dayPart }),
            // Beside the daypart and off the same instant: the words are what the prompt stated and
            // this is what the clock says, which is the half of the question a stretch cannot answer.
            ...(request.moment === undefined ? {} : { moment: request.moment }),
            // Built from `settings` rather than from `request`, so the guard is judging EXACTLY what
            // the prompt offered — the shape's veto included. A guard handed the raw request would
            // keep a pad hit in a kind of break whose shape refused to offer one, which is the same
            // class of disagreement `maxWordsFor` exists to prevent one field up.
            pads: offeredPads(settings, TALK_BREAK_SHAPE),
            // The dates this break was actually handed, from the same two records the prompt was
            // built from. Unconditional, like `cues` and for the same reason: an EMPTY permitted set
            // is the statement a factless break makes rather than a question left unasked, and it is
            // the one the prompt has been making in words all along — "the station knows nothing
            // about X beyond what is listed above". This is the answer side of that sentence.
            //
            // The talk break alone for now. It is the kind that carries the whole music path (749 of
            // the aired model breaks on this station against 121 for the next one), and a bulletin's
            // years belong to its stories rather than to a record, so `NEWS_SHAPE` would need its own
            // substrate here rather than this one.
            // The prompt itself is the third argument, and it is what keeps this a bargain: a
            // persona's story, background and preoccupations carry dates the station ASKED to hear,
            // and five of the aired breaks this was measured on are the paranormal host telling his
            // own seeded story, which opens on a year. See `permittedYears`.
            //
            // `recent` is stripped back out of it first, through `shownWithoutRecent`: it is quoted
            // verbatim into this same prompt's "You said these recently" block, and `recent` is
            // filled from every writer's scripts (including a kind with no year guard at all), so an
            // invented year sitting in one of those quoted scripts would otherwise be permitted here
            // on no more authority than having been echoed back.
            years: permittedYears([request.previous, request.next], request.moment, shownWithoutRecent(messages, request.recent)),
        };
        const script = readAnswer(result.text, guard);

        // Recorded whichever way it went, and BEFORE the answer is judged, so a model that produced
        // forty seconds of nothing leaves behind the same numbers as one that worked.
        this.lastDetail = {
            // What the host RESOLVED, not what the setting said. A station that never pinned a
            // model left this empty, so every row read "the plugin default" and the record could
            // not answer which model wrote anything. See `LlmConversation.model`.
            model: result.model,
            ...(result.usage === undefined ? {} : { usage: result.usage as Record<string, number> }),
            ...(captureWrites(this.config) ? { prompt: messages, raw: result.text } : {}),
        };

        if (script === undefined) {
            // Not a throw: a model that rambled or answered with nothing is the ordinary case this
            // whole arrangement exists to absorb. The registry turns it into the floor's sentence
            // and keeps the reason.
            //
            // The cases are told apart because they need different fixes and look identical from
            // the row: a model that stopped at the token ceiling having said NOTHING spent its whole
            // allowance thinking, which is a number to raise; one that said too much is a prompt to
            // tighten; and a script refused as not this character carries its own reason. Which one
            // it was is `writeDecline`'s answer, and most of them are something an operator can go
            // and change on the personas page — `character-trimmed` being the one that looks like a
            // sheet problem and is not.
            const words = result.text.trim().split(/\s+/).filter(Boolean).length;
            const declined = writeDecline(result.text, guard);
            // Onto the detail as well as into the log, so the reason reaches `script_history.reason`
            // and the question "how often is the model being refused, and for what" is a query
            // rather than a search through a rotating log.
            if (declined !== undefined) this.lastDetail = { ...this.lastDetail, reason: declined.reason };

            this.logger.info(
                // The one case the answer alone cannot explain: an empty answer that stopped at the
                // token ceiling is a model that thought until it ran out, not one with nothing to say.
                words === 0 && result.finishReason === 'length'
                    ? 'director: the model used its whole answer thinking and never spoke; raise the token ceiling'
                    : `director: ${declined?.reason ?? 'the model wrote nothing the station could say'}`,
                { finish: result.finishReason, words, tokens: result.usage?.outputTokens, persona: request.persona?.key, fault: declined?.fault },
            );
            return undefined;
        }

        // A break the station CUT rather than refused. Re-derived through `writeTrim` rather than
        // measured here, so the row and the log carry a number this writer did not invent, and put on
        // the detail so it reaches `script_history.reason` on a row whose outcome is `written`.
        const trimmed = writeTrim(result.text, guard);
        if (trimmed !== undefined) {
            this.lastDetail = { ...this.lastDetail, reason: trimmed.reason };
            this.logger.info(`director: ${trimmed.reason}`, { kept: trimmed.kept, dropped: trimmed.dropped, persona: request.persona?.key });
        }

        const claimsTime = timeClaimIn(script, request.clock, request.dayPart);

        return {
            script,
            // Never asked of the model. A label is for the console and the mount, so generating one
            // would be paying for something no listener hears — and the deterministic labeller
            // already names the break for the records it sits between.
            label: labelFor(request),
            // Told what the next record is means allowed to name it, so assume it did. Over-stamping
            // costs a break the order drifted under, which is the safe direction; under-stamping
            // airs a promise nobody checked, which is the direction the claim exists to close.
            claimsNext: request.next !== undefined,
            // The same posture, mirrored: told what the previous record was means allowed to
            // back-announce it, so assume it did for the same reason `claimsNext` does.
            claimsPrevious: request.previous !== undefined,
            // Stamped only when the answer really carries the words it was given, which is the
            // opposite posture to `claimsNext` above and deliberately so. There, over-stamping
            // costs at most a break the order drifted under. Here the words either appear or they
            // do not, so there is nothing to assume: a model that ignored the instruction, or
            // paraphrased it into something with a different lifetime, has made no claim this
            // station can honour and must not be given one.
            //
            // Both offers rather than the clock alone, since a break may name the half of the day
            // without ever naming the hour — and "this morning" spoken at ten past twelve is the
            // same broken promise the clock check exists for, arriving through the other field.
            ...(claimsTime === undefined ? {} : { claimsTime }),
        };
    }
}
