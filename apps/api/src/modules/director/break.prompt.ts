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
 * ## Facts it does not have yet
 *
 * There is a section per record for what the station knows about it, and today it renders empty:
 * nothing fetches enrichment. It is shaped now so that filling it later is a paragraph rather than
 * a rewrite, and so the §9 rules can be written once to cover both cases — with no facts the model
 * has nothing to be concrete about and must not reach for any, and with facts it uses them without
 * turning them into a cue.
 */

import type { LlmMessage } from '@deadair/plugin-sdk';
import type { BreakTrack, BreakWriteRequest } from './break.writer.js';

/** How the station wants this break to sound, and how long it may run. */
export interface PromptSettings {
    /** What the station calls itself, from `stream.title`. */
    station?: string;
    /** What it calls its presenter, from `station.djName`. */
    dj?: string;
    /** The operator's own line about who the station sounds like, from `llm.breakPersona`. */
    persona?: string;
    /** The ceiling, in words. See {@link DEFAULT_MAX_WORDS}. */
    maxWords?: number;
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
export function breakPrompt(request: BreakWriteRequest, settings: PromptSettings = {}): LlmMessage[] {
    return [
        { role: 'system', content: systemPrompt(settings) },
        { role: 'user', content: userPrompt(request, settings) },
    ];
}

function systemPrompt(settings: PromptSettings): string {
    const station = settings.station?.trim();
    const dj = settings.dj?.trim();
    const persona = settings.persona?.trim();
    const maxWords = settings.maxWords ?? DEFAULT_MAX_WORDS;
    const seconds = Math.round(maxWords / WORDS_PER_SECOND);

    const lines = [
        `You are the voice of a radio station${station ? ` called ${station}` : ''}${dj ? `, and your name is ${dj}` : ''}.`,
        'You write one short spoken link between records. It is read aloud exactly as you write it.',
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

    if (persona) lines.push('', 'The station describes its presenter this way, and you should sound like it:', persona);

    return lines.join('\n');
}

function userPrompt(request: BreakWriteRequest, settings: PromptSettings): string {
    const parts: string[] = [];

    if (request.previous) parts.push(`The record that has just finished:\n${describe(request.previous)}`);
    if (request.next) parts.push(`The record coming up next:\n${describe(request.next)}`);

    // Both absent is a legitimate moment — the top of an order with nothing behind it — and the
    // rules above are what stop it being filled with a record from nowhere.
    if (parts.length === 0) parts.push('You have no records to talk about. Say something brief that identifies the station and nothing more.');

    if (request.previous && !request.next) {
        // Said explicitly, because a model handed one record will reach for a second. This is the
        // same withholding the deterministic writer does by choosing a phrasing with no `next` in
        // it, and the reason the caller left the next record out is that it could not be trusted.
        parts.push('You have not been told what plays next. Do not say what is coming up.');
    }

    if (request.recent && request.recent.length > 0) {
        parts.push(
            ['You said these recently. Do not reuse their opening or their shape:', ...request.recent.map(script => `- ${script}`)].join('\n'),
        );
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
 * Title and artist today. The `facts` line is where enrichment goes when it lands, which is why
 * this is a function rather than a template literal at the call site.
 */
function describe(track: BreakTrack): string {
    const lines = [`- Title: ${track.title}`, `- Artist: ${track.artist}`];
    return lines.join('\n');
}

/** What a model's answer has to survive to become a script. */
export interface AnswerGuard {
    maxWords?: number;
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

    return script;
}

/** Drop a pair of marks that wraps the entire text, and only then. */
function stripWrapping(text: string, open: string, close: string): string {
    if (!text.startsWith(open) || !text.endsWith(close) || text.length < 2) return text;

    const inner = text.slice(open.length, -close.length);
    return inner.includes(close) && !inner.endsWith(close) ? text : inner.trim();
}
