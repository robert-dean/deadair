/**
 * What the station asks a model for, and what it will accept back.
 *
 * Two pure functions and no I/O, so the interesting decisions here — which are all about what the
 * model must NOT do — are testable without a model. The binding that uses them is
 * `model.talk.break.writer.ts`.
 *
 * ## The one failure this is shaped around
 *
 * `docs/todo/station-intelligence.md` §9: a prompt asked to be concrete about music and shown no
 * track fields reaches into training data and describes a record that is not playing. The failure
 * is specific — it is not that a model invents facts, it is that it frames real facts as a CUE
 * ("coming up", "you just heard", "that was"). So the FRAMING is banned rather than the noun, since
 * a break about a record that may not name the record is not a break. And certainty is asked for
 * separately, because inventing a credit and mis-cueing a real record are independent failures and
 * one instruction covering both gets neither.
 *
 * ## The notes, and the second failure they bring
 *
 * A record now arrives with up to two short true sentences about it, chosen by the caller (see
 * `BreakTrack.facts`). They make the §9 rules above MORE necessary rather than less: a model handed
 * one real fact will happily hang a cue off it. They also bring a failure of their own, which is a
 * model reading a note out as it stands — "Active as a recording artist from 1948 to 2025" is a
 * real row here, and it is a database entry rather than something a person says. So the notes are
 * offered as raw material for one line, in the station's own voice, droppable.
 *
 * That instruction is in the USER turn rather than the system one, because the failure does not
 * exist for a station that has enriched nothing: with no notes there is nothing to read aloud
 * badly, and a rule about them would be a rule about nothing.
 */

import type { LlmMessage } from '@deadair/plugin-sdk';
import {
    characterFault,
    personaLines,
    personaVoiceReminder,
    spentCatchphrases,
    type CharacterFault,
    type PersonaSheet,
} from '#modules/personas/persona.sheet.js';
import type { BreakStory, BreakTrack, BreakWriteRequest } from './break.writer.js';

/**
 * What makes one KIND of break's prompt different from another's.
 *
 * The seam that keeps this file from growing a branch per kind. `BreakWriter` is already a registry
 * over kinds rather than one writer with parameters, on the argument that a fifth kind of break is a
 * fifth writer; a `greeting?: boolean` here would have been that same mistake made a second time,
 * one flag at a time, until the prompt builder was a switch statement.
 *
 * So a kind brings its own shape and the shared discipline stays here. Everything a break owes
 * whatever it is — the grounding rules, the persona sheet and its diction reminder, the word ceiling,
 * the notes rule, the recent-scripts rule, the clock instruction — is in {@link systemPrompt} and
 * {@link userPrompt}, where no kind can opt out of it. What a shape may change is what the break IS,
 * which is one sentence and one opening.
 *
 * Shapes live beside their writers, so this file imports the interface and none of them.
 */
export interface BreakPromptShape {
    /** What this sort of break is, in one sentence, in the system turn. */
    job: string;
    /**
     * Whether the record that has just finished is shown at all.
     *
     * Not every break is about what just played. A greeting is about somebody who has only now
     * arrived, so what they missed is not theirs to be back-announced — and showing it anyway is an
     * invitation for a model to cue a record its listener never heard.
     */
    showsPrevious: boolean;
    /** What the user turn opens with, before the records. Absent for a break that needs no framing. */
    opening?: (request: BreakWriteRequest) => string | undefined;
}

/**
 * The shape of an ordinary talk break: the link between two records.
 *
 * The wording is exactly what this file said before there were shapes, moved rather than rewritten.
 */
export const TALK_BREAK_SHAPE: BreakPromptShape = {
    job: 'You write one short spoken link between records. It is read aloud exactly as you write it.',
    showsPrevious: true,
};

/** How the station wants this break to sound, and how long it may run. */
export interface PromptSettings {
    /** What the station calls itself, from `stream.title`. */
    station?: string;
    /** What it calls its presenter: the active persona's name, or `station.djName` behind it. */
    dj?: string;
    /**
     * Who the station is right now, from `deadair.personas`.
     *
     * The `style` completes "You are …" in place of the station's own sentence, and the sheet's
     * facets are rendered between that and the rules. A station with no persona is unchanged, which
     * is the state every fresh install is in until it picks one.
     */
    persona?: PersonaCharacter;
    /** The ceiling, in words. See {@link DEFAULT_MAX_WORDS}. */
    maxWords?: number;
}

/** The half of a persona a prompt uses: who they are, and how they speak. */
export interface PersonaCharacter extends PersonaSheet {
    /** Completes "You are …". */
    style: string;
}

/**
 * How long a break may run, in words.
 *
 * Forty is about fifteen seconds read aloud, which is a talk break rather than a monologue. Stated
 * to the model in seconds as well as words, because a model reasons about a spoken length better
 * than about a count, and enforced in {@link readAnswer} in words, because that is the half that
 * can actually be checked.
 */
export const DEFAULT_MAX_WORDS = 40;

/** Roughly how fast a voice reads, for turning a word ceiling into a length a model understands. */
const WORDS_PER_SECOND = 2.6;

/**
 * The conversation, oldest first, with the system prompt as the first turn.
 *
 * One system turn and one user turn. The system turn is who the station is and what a break may
 * never do; the user turn is this particular moment. Split that way so the rules read as standing
 * instructions rather than as something about these two records, which is what they are.
 */
export function breakPrompt(request: BreakWriteRequest, settings: PromptSettings, shape: BreakPromptShape): LlmMessage[] {
    return [
        { role: 'system', content: systemPrompt(settings, shape) },
        { role: 'user', content: userPrompt(request, settings, shape) },
    ];
}

function systemPrompt(settings: PromptSettings, shape: BreakPromptShape): string {
    const station = settings.station?.trim();
    const dj = settings.dj?.trim();
    const persona = settings.persona;
    const maxWords = settings.maxWords ?? DEFAULT_MAX_WORDS;
    const seconds = Math.round(maxWords / WORDS_PER_SECOND);

    // A persona replaces the role sentence rather than being appended to it, because "you are the
    // voice of a radio station" and "you are a pirate captain who runs one" are the same slot said
    // twice, and a model handed both hedges between them.
    const role =
        persona === undefined
            ? `You are the voice of a radio station${station ? ` called ${station}` : ''}${dj ? `, and your name is ${dj}` : ''}.`
            : `You are ${persona.style}${station ? `, on a station called ${station}` : ''}${dj ? `, and your name is ${dj}` : ''}.`;

    const lines = [
        role,
        // The sheet sits between the role and the rules, which leaves the grounding discipline in
        // the recency position it has always had.
        ...(persona === undefined ? [] : personaLines(persona)),
        shape.job,
        '',
        'Rules:',
        // The §9 pair, stated as two rules rather than one, because they fail independently.
        '- Only ever refer to the records listed below. Never name, cue, or allude to any other song, artist or album, even one you are sure about.',
        '- Say only what the notes below actually tell you. If you are not certain of something, leave it out rather than reaching for it.',
        // What a script physically is. A model given no shape here writes stage directions.
        `- Keep it under ${maxWords} words, around ${seconds} seconds spoken.`,
        '- Write only the words to be spoken. No stage directions, no speaker labels, no quotation marks around the whole thing, no emoji.',
        '- Write numbers, times and symbols the way they should be read out loud.',
        '- Do not greet the listener by name, promise anything you have not been told, or mention the time unless you are given it.',
    ];

    // AFTER the rules, and that position is the whole reason it exists. The failure it addresses is
    // caused BY the rules: a host reads seven careful instructions about naming records accurately
    // and answers them in careful, plain English. See `persona.sheet.ts`.
    const reminder = persona === undefined ? undefined : personaVoiceReminder(persona);
    if (reminder !== undefined) lines.push('', reminder);

    return lines.join('\n');
}

function userPrompt(request: BreakWriteRequest, settings: PromptSettings, shape: BreakPromptShape): string {
    const parts: string[] = [];

    const opening = shape.opening?.(request);
    if (opening !== undefined) parts.push(opening);

    // A kind that does not look backwards never sees the record behind it, rather than seeing it and
    // being told not to mention it: a model shown a record will find a way to cue it.
    const previous = shape.showsPrevious ? request.previous : undefined;

    if (previous) parts.push(`The record that has just finished:\n${describe(previous)}`);
    if (request.next) parts.push(`The record coming up next:\n${describe(request.next)}`);

    // Both absent is a legitimate moment — the top of an order with nothing behind it — and the
    // rules above are what stop it being filled with a record from nowhere.
    if (parts.length === 0) parts.push('You have no records to talk about. Say something brief that identifies the station and nothing more.');

    if (previous && !request.next) {
        // Said explicitly, because a model handed one record will reach for a second. This is the
        // same withholding the deterministic writer does by choosing a phrasing with no `next` in
        // it, and the reason the caller left the next record out is that it could not be trusted.
        parts.push('You have not been told what plays next. Do not say what is coming up.');
    }

    // Asked of what the model can actually SEE: a rule about reading notes aloud is a rule about
    // nothing when the only record carrying any was withheld by the shape.
    if (hasFacts(previous, request.next)) {
        // Only when there are notes, because the thing this guards against cannot happen without
        // them. Two failures: reading a database line out as it stands ("Active as a recording
        // artist from 1948 to 2025" is a real row in this install's enrichment), and treating a
        // true fact as a licence to cue whatever it mentions. Working one in is WANTED rather than
        // required — a break that used none of them is still a break, and one that used two is a
        // listing.
        parts.push(
            'The notes are things the station knows to be true. They are raw material, not lines to read out: ' +
                'work at most one of them in, in your own words, and leave out any that would sound like a database read aloud. ' +
                'Anything a note mentions that is not one of the records above is background, never something to cue or play.',
        );
    }

    // A bulletin's substrate, and the strictest rules in this file sit on it. Rendered whenever the
    // request carries stories rather than behind a flag on the shape, exactly as the clock and the
    // recent scripts are: what the prompt says is a function of what the moment holds.
    if (request.stories && request.stories.length > 0) {
        parts.push(['The stories to report, in this order:', ...request.stories.map(describeStory)].join('\n'));
        // The one place a model is told it may not paraphrase. Every other rule here is about a
        // record, where the worst case is an awkward sentence about music; here the worst case is
        // the station stating something false as news in a confident voice, which no listener can
        // check and no later break can take back. So: no detail that is not written down, no
        // consequences, no opinion, and nothing joined into one story that arrived as two.
        parts.push(
            'Read these as news. Say only what each story actually says: do not add detail, do not explain what it means, ' +
                'do not say what will happen next, and do not merge two stories into one. ' +
                "The summaries are the publisher's own wording — use them to know what happened, not as lines to read out. " +
                'If a story is unclear, leave it out rather than guessing at it. Do not say how you feel about any of it.',
        );
    }

    if (request.recent && request.recent.length > 0) {
        parts.push(
            ['You said these recently. Do not reuse their opening or their shape:', ...request.recent.map(script => `- ${script}`)].join('\n'),
        );

        // The moment-dependent half of the catchphrase rule, and it is here rather than in the sheet
        // for the reason everything is here rather than there: which signatures are spent is a fact
        // about tonight, and the system turn is who the station is. The sheet says "at most one, and
        // not every time"; this is the sentence that makes "not every time" mean something, and
        // `characterFault` refuses a script that ignores it.
        //
        // The invitation matters as much as the refusal. Told only what it may not say, a model
        // reaches for the nearest other thing the sheet gave it, which is a sample line — the
        // failure one rule over. Told to make a new one, it does the character rather than quoting
        // it, and the station gets a signature that is genuinely its own.
        const spent = settings.persona === undefined ? [] : spentCatchphrases(settings.persona, request.recent);
        if (spent.length > 0) {
            parts.push(
                `You have already said ${spent.map(phrase => `"${phrase}"`).join(' and ')} recently. Do not say ${spent.length === 1 ? 'it' : 'any of them'} again now. ` +
                    'If you want a line to go out on, make up a new one of your own in the same voice.',
            );
        }
    }

    if (request.clock) {
        // The exact words rather than a time, and an instruction to use them verbatim. A model
        // asked to say what time it is will invent its own phrasing, and the station has no way to
        // tell how long an invented one stays true — whereas these words come with their own expiry
        // and the answer can simply be searched for them. Wanting it rather than requiring it: a
        // break that came out without the time is still a break, and it just makes no claim.
        parts.push(
            `It is ${request.clock.words}. Work that in, using exactly the words "${request.clock.words}" ` +
                'and no other way of saying the time. Do not give an exact time and do not name the minutes.',
        );
    }

    const station = settings.station?.trim();
    if (station) parts.push(`The station is called ${station}. You may say so, but you do not have to every time.`);

    parts.push('Write the link now.');
    return parts.join('\n\n');
}

/**
 * One record, as the model is shown it.
 *
 * "Notes" rather than "facts", because the rule in the system turn already calls them that and the
 * two have to name the same thing for either to mean anything.
 */
function describe(track: BreakTrack): string {
    const lines = [`- Title: ${track.title}`, `- Artist: ${track.artist}`];
    if (track.facts && track.facts.length > 0) lines.push('- Notes:', ...track.facts.map(fact => `  - ${fact}`));
    return lines.join('\n');
}

/**
 * One story, as the model is shown it.
 *
 * The headline first and on its own line, because it is the part that may be read more or less as
 * it stands — it is a published sentence somebody else already stands behind. The summary is
 * labelled as background rather than as copy, which is what the rule beside it then leans on.
 */
function describeStory(story: BreakStory): string {
    const lines = [`- Headline: ${story.headline}`];
    if (story.summary) lines.push(`  Background: ${story.summary}`);
    // Deliberately not offered as something to say. Attribution is a station's own decision — some
    // read it, some never do — and a model shown a publisher's name will credit it in a sentence
    // the operator never asked for.
    return lines.join('\n');
}

/** Whether either record came with anything to say about it. */
const hasFacts = (previous: BreakTrack | undefined, next: BreakTrack | undefined): boolean =>
    (previous?.facts?.length ?? 0) > 0 || (next?.facts?.length ?? 0) > 0;

/** What a model's answer has to survive to become a script. */
export interface AnswerGuard {
    maxWords?: number;
    /**
     * The character it was asked to write in, checked against what came back.
     *
     * A sheet that named no markers, no samples, no catchphrases and no forbidden wording makes no
     * checkable claim and so passes everything. See {@link characterFault}.
     */
    persona?: PersonaSheet;
    /**
     * The last few things the station said, exactly as the prompt was shown them.
     *
     * Read only to decide which signature phrases are spent, and it has to be the same list the
     * prompt carried: a script refused for a repetition it was never warned about is the trick
     * question the markers used to be, and the whole bargain here is that the station asks for
     * something before it refuses a script for not doing it.
     */
    recent?: readonly string[];
}

/**
 * A model's answer, tidied into something speakable, or nothing.
 *
 * Everything here is a thing a model does that a listener would hear as wrong rather than as
 * creative: a script wrapped in quotation marks, a `[warmly]` at the front, a `DJ:` label, a
 * paragraph where a link was asked for. Cheap to strip and impossible to un-hear.
 *
 * Answers `undefined` when what is left is not worth speaking, which the registry treats as this
 * writer having declined — and the floor underneath then says something correct instead.
 */
export function readAnswer(text: string, guard: AnswerGuard = {}): string | undefined {
    const maxWords = guard.maxWords ?? DEFAULT_MAX_WORDS;

    let script = text.trim();

    // A reasoning model that was told not to think out loud and did anyway. Take what follows the
    // last one rather than dropping the answer: the words after it are usually the actual script.
    script = script.replace(/^[\s\S]*<\/think>/i, '').trim();

    // Anything before a speaker label on the first line: "DJ:", "Host:", "Announcer:".
    script = script.replace(/^\s*[A-Z][A-Za-z ]{0,20}:\s*(?=[A-Z"'“])/, '');

    // Stage directions, wherever they are: [warmly], (laughs), *sighs*.
    script = script
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\*[^*]*\*/g, ' ')
        // A narrow list, and matched on the stem so "laughs" and "sighing" count. Parentheses are
        // deliberately NOT stripped wholesale: "(Don't Fear) The Reaper" is a title, and a
        // parenthetical inside a sentence is ordinary speech.
        .replace(/\((?:[^()]*\b(?:laugh|sigh|pause|beat|music|sfx|voice|warmly|softly|upbeat|chuckl)\w*[^()]*)\)/gi, ' ');

    // Quotation marks around the WHOLE thing, which is a model quoting itself rather than a script
    // containing a quote. Only when they wrap everything, so a quoted lyric inside a line survives.
    script = stripWrapping(script, '"', '"');
    script = stripWrapping(script, '“', '”');
    script = stripWrapping(script, "'", "'");

    script = script.replace(/\s{2,}/g, ' ').trim();
    if (script.length === 0) return undefined;

    // A ceiling rather than a trim: cutting a script mid-sentence is a worse thing to air than the
    // floor's correct line, and a model that has run long has usually misunderstood the job rather
    // than merely overshot.
    if (script.split(/\s+/).length > maxWords) return undefined;

    // A correct sentence that is not this character speaking, which is the failure a persona is
    // asked for and the one a model handed a page of content rules actually makes — in flat plain
    // English, in a lifted sample line, in a signature the station used four records ago, or in
    // wording the sheet forbids. Declined rather than re-drafted: the floor underneath speaks in
    // the same character, so the station gets an in-character line at once instead of paying for a
    // second generation to maybe get one.
    if (faultIn(script, guard) !== undefined) return undefined;

    return script;
}

/**
 * Why a cleaned script is not the persona speaking, or `undefined` when it is.
 *
 * The same judgement {@link readAnswer} makes, exported so a writer can log WHICH of the four faults
 * it was without re-deriving it and drifting from what actually happened. A guard carrying no
 * persona answers `undefined`: a station that made no claim, rather than one that passed.
 */
export function faultIn(script: string, guard: AnswerGuard): CharacterFault | undefined {
    if (guard.persona === undefined) return undefined;

    return characterFault(guard.persona, script, guard.recent === undefined ? {} : { recent: guard.recent });
}

/**
 * What an operator should go and change, per fault.
 *
 * Four sentences rather than one, because the four are not variations on "the model missed": a spent
 * signature is the station working exactly as designed and wants nothing done about it, a quoted
 * sample is a sheet whose examples are too magnetic for the model in front of them, forbidden
 * wording is worth reading a capture for, and a flat plain-English line is markers or diction wanting
 * work. Only the last two are usually a fault of the sheet at all.
 */
const FAULT_REASONS: Record<CharacterFault, string> = {
    'quoted-sample': 'the model read one of the persona’s own sample lines back rather than writing in its voice',
    'spent-catchphrase': 'the model reached for a signature the station had just used',
    'avoided-wording': 'the model used wording the persona forbids',
    'out-of-character': 'the model wrote a line the station could say, but not in its own voice',
};

/**
 * Why a raw answer was refused as not-this-character, for a writer that wants to say so.
 *
 * Runs the guard WITHOUT the persona first, which does the tidying and applies the word ceiling: an
 * answer that does not survive that was never a character problem, and asking why it is out of
 * character would answer a question about a line the station was never going to say. So `undefined`
 * here means "not a character fault" and never "no fault".
 *
 * It answers with the sentence as well as the fault because both destinations matter and neither is
 * the other: the fault is what a log line can be counted by, and the sentence is what reaches
 * `script_history.reason` and a person reading the console. Deriving them in one place is what stops
 * the row and the log disagreeing about the same break.
 */
export function characterDecline(text: string, guard: AnswerGuard): { fault: CharacterFault; reason: string } | undefined {
    const speakable = readAnswer(text, { maxWords: guard.maxWords ?? DEFAULT_MAX_WORDS });
    if (speakable === undefined) return undefined;

    const fault = faultIn(speakable, guard);

    return fault === undefined ? undefined : { fault, reason: FAULT_REASONS[fault] };
}

/** Drop a pair of marks that wraps the entire text, and only then. */
function stripWrapping(text: string, open: string, close: string): string {
    if (!text.startsWith(open) || !text.endsWith(close) || text.length < 2) return text;

    const inner = text.slice(open.length, -close.length);
    return inner.includes(close) && !inner.endsWith(close) ? text : inner.trim();
}
