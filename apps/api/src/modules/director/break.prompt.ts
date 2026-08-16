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
 * {@link userPrompt}, where no kind can opt out of it. What a shape may change is what the break IS:
 * one sentence, one opening, and any rule that is true of this kind and false of the one beside it.
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
    /**
     * Whether the rest of this broadcast's records are offered as something to refer back to.
     *
     * Off unless a shape asks for it, and the two kinds that decline are instructive. A WELCOME must
     * not have it for the same reason it has `showsPrevious: false` — an arriving listener did not
     * hear any of it, so a presenter reminiscing about the last half hour is talking to the room it
     * just lost. A BULLETIN must not have it because a list of records in front of a model that has
     * been asked to report the news is a list it will find a way to read out.
     *
     * What it is FOR is the ordinary link, where the failure it fixes is a station that sounds like
     * it walked in halfway through its own show: every break knew the record either side of it and
     * nothing before that, so nothing could ever be referred back to.
     */
    showsPlayed?: boolean;
    /** What the user turn opens with, before the records. Absent for a break that needs no framing. */
    opening?: (request: BreakWriteRequest) => string | undefined;
    /**
     * Rules this kind owes on top of the shared ones, rendered at the end of the same list.
     *
     * For a rule that is true of one kind and FALSE of another, which is a narrower thing than it
     * sounds: almost everything a break owes is owed by all of them, which is why the shared list is
     * as long as it is and why this is empty on most shapes. The one that forced it is "make one
     * point" — exactly right for a link between two records, and a licence to drop two thirds of a
     * bulletin if the news shape had to read it.
     */
    rules?: readonly string[];
}

/**
 * The shape of an ordinary talk break: the link between two records.
 *
 * The wording is exactly what this file said before there were shapes, moved rather than rewritten.
 */
export const TALK_BREAK_SHAPE: BreakPromptShape = {
    job: 'You write one short spoken link between records. It is read aloud exactly as you write it.',
    showsPrevious: true,
    // The one kind that is presenting a SHOW rather than an arrival or a bulletin, so it is the one
    // that has anything to refer back to.
    showsPlayed: true,
    // The one rule here that ASKS FOR LESS, and it is what buys a character room to exist. Measured:
    // the word ceiling is not what bounds a break — 2 of 137 answers reached it and the median came
    // in at 28 words — so a break is short because the model stops, and what it spends those 28
    // words on is the whole question. It was spending them on content: both titles, both artists and
    // a note read out, with a marker at the front and a signature at the end, which is a listing with
    // decoration rather than somebody talking.
    //
    // The second half says what the saved words are FOR, and it is here because asking for less
    // turned out to be only half a rule. Every instruction this prompt carries points downwards — do
    // not name a record you were not given, you need not mention both, make one point — and a model
    // reading all of them writes the shortest correct thing it can: the five model breaks this
    // station has captured came in at 11, 13, 20, 27 and 29 words against a ceiling of 40, so it is
    // stopping at half its allowance with nothing telling it what the other half is for. This is not
    // permission to run long, which the ceiling still refuses; it is the one instruction in the list
    // that points at the voice rather than at the content.
    rules: [
        'Make one point, and make it the way only you would. A break is a single thought said well, not everything you know about both ' +
            'records: the words you save by leaving one of them out are yours to spend on saying it like yourself.',
    ],
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
    /**
     * Whether the presenter has to keep it broadcast-clean.
     *
     * Named for what it asks of the WRITER rather than for the setting behind it: a model is being
     * told how to speak, not what a `track_sources` row is marked. So a caller that wants a clean
     * script for some other reason can ask for one without pretending to have a content policy.
     *
     * On when `rotation.advisory` is anything but `prefer-explicit`, because a clean track list
     * narrated by a DJ who swears is the same failure with an extra step. Note the asymmetry with
     * the record side, and it is deliberate: `prefer-clean` is only a lean about WHICH COPY to play
     * because most catalogue has no clean twin to choose, whereas a presenter always has the choice
     * of their own words. There is nothing for a preference to fall back to here.
     *
     * The answer is NOT checked against this. The floor under every model writer is a template the
     * operator wrote, so it is clean by construction, and a model that ignores the rule costs one
     * break rather than a policy breach. A word list would be a permanent, locale-bound maintenance
     * surface bought for very little.
     */
    cleanLanguage?: boolean;
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
        // Conditional and near the end, because it is the one rule here that is about the station's
        // own policy rather than about what a break IS. Both halves are needed: a model told only
        // not to swear will still quote an explicit title or lyric back, which is the same words
        // arriving by a route the first half does not cover.
        ...(settings.cleanLanguage
            ? ['- This station is broadcast-clean. No profanity or crude language, and do not quote an explicit lyric or title word for word.']
            : []),
        // Last in the list, because a rule true of this kind alone should not push the shared ones
        // further from the end than they already are.
        ...(shape.rules ?? []).map(rule => `- ${rule}`),
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

    if (previous && request.next) {
        // Shown two records, a model names two records, and at 28 words naming both leaves room for
        // nothing else — which is why what came back was a credit line with a marker on the front.
        // Permission rather than instruction: the station's own phrasings already work this way (a
        // template whose optional chunk was dropped mentions one record and is a perfectly good
        // break), and the model was the only writer that had never been told it could.
        //
        // It costs nothing downstream. `claimsNext` over-stamps deliberately — told what plays next
        // means allowed to name it, so a break that chose not to is stamped anyway and at worst
        // loses itself to a drift it never promised anything about.
        parts.push(
            'You do not have to mention both records. One of them, handed over the way only you would say it, is better than both said flatly.',
        );
    }

    // Asked of what the model can actually SEE: a rule about reading notes aloud is a rule about
    // nothing when the only record carrying any was withheld by the shape.
    if (hasFacts(previous, request.next)) {
        // Only when there are notes, because the thing this guards against cannot happen without
        // them. Two failures: reading a database line out as it stands ("Active as a recording
        // artist from 1948 to 2025" is a real row in this install's enrichment), and treating a
        // true fact as a licence to cue whatever it mentions.
        //
        // The optionality is stated FIRST and in as many words, because "work at most one of them
        // in" was read as an instruction to work one in: notes reached 108 of 137 captured prompts
        // and the answers recite them, which is where "Mastodon kicked off in Atlanta in
        // two-hundred-eighty-two" and "Juggernaut of Justice, crafted by Bob Marlette" came from. A
        // model that spends a third of a 28-word break on a fact it was shown has spent it on the
        // one part of the break no listener needed and the character could not survive.
        parts.push(
            'The notes are things the station knows to be true, offered in case one is worth saying. ' +
                'You do not have to use any of them, and most breaks are better without one: a note earns its place only if you can ' +
                'say it as yourself. Never more than one, never read out as it stands, never a date or a credit for its own sake. ' +
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
            'Read these as news. Give each story a sentence of what actually happened, taken only from the text under its headline — ' +
                'a bulletin that reads out headlines and nothing else has told the listener nothing. ' +
                'Say only what each story actually says: do not add detail, do not explain what it means, ' +
                'do not say what will happen next, and do not merge two stories into one. ' +
                "The text is the publisher's own wording — use it to know what happened, not as lines to read out. " +
                'Where a story has no text under it, read its headline and move on rather than filling the gap. ' +
                'If a story is unclear, leave it out rather than guessing at it. Do not say how you feel about any of it.',
        );
    }

    // What the show has played, for a kind that is presenting one. OFFERED, and the wording of that
    // is the whole of this block: the measured failure of handing a model material is that the model
    // gets through it. "Work at most one of them in" read as an instruction to work one in, which is
    // why the notes rule two blocks up says "You do not have to use any of them" — and a list of
    // titles is that hazard one size larger, because a list is the one shape a model will simply
    // read out. So it says what the list is FOR (there is a show behind this record) and then says
    // plainly that using it is optional, and "make one point" in the rules is what holds the line.
    const played = shape.showsPlayed === true ? (request.played ?? []) : [];
    if (played.length > 0) {
        parts.push(
            [
                'Earlier in the show you played these, most recent first:',
                ...played.map(record => `- ${record.title} by ${record.artist}`),
                'This is here so you know there is a show behind this record, not a list to get through. ' +
                    'Refer back to one of them only if you have something to say about it. You do not have to mention any of them.',
            ].join('\n'),
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
 * it stands — it is a published sentence somebody else already stands behind. What follows is
 * labelled as the story rather than as copy, which is what the rule beside it then leans on.
 *
 * The article where there is one and the teaser otherwise, never both: they overlap almost entirely
 * (a teaser is usually the article's own first sentence), and showing a model the same fact twice
 * under two labels is how one sentence gets read out as two stories.
 */
function describeStory(story: BreakStory): string {
    const lines = [`- Headline: ${story.headline}`];
    const told = story.body ?? story.summary;
    if (told) lines.push(`  Story: ${told}`);
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
    const script = tidyAnswer(text);
    if (script === undefined) return undefined;

    // A ceiling rather than a trim: cutting a script mid-sentence is a worse thing to air than the
    // floor's correct line, and a model that has run long has usually misunderstood the job rather
    // than merely overshot.
    if (runsLong(script, guard)) return undefined;

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
 * The tidying half of {@link readAnswer}: an answer as speakable words, or nothing.
 *
 * Split out so {@link writeDecline} can tell an answer that was empty from one that was too long
 * without re-running the checks in a different order and reporting something that did not happen.
 */
function tidyAnswer(text: string): string | undefined {
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
    return script.length === 0 ? undefined : script;
}

/** Whether a tidied script is past the guard's ceiling. */
const runsLong = (script: string, guard: AnswerGuard): boolean => script.split(/\s+/).length > (guard.maxWords ?? DEFAULT_MAX_WORDS);

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
const FAULT_REASONS: Record<WriteFault, string> = {
    'nothing-said': 'the model answered with nothing the station could say',
    'ran-long': 'the model wrote past the word ceiling, and a script cut mid-sentence is worse than the phrasing underneath it',
    'quoted-sample': 'the model read one of the persona’s own sample lines back rather than writing in its voice',
    'spent-catchphrase': 'the model reached for a signature the station had just used',
    'avoided-wording': 'the model used wording the persona forbids',
    'out-of-character': 'the model wrote a line the station could say, but not in its own voice',
};

/**
 * Every way an answer can be refused: the four character faults, plus the two that come first.
 *
 * The two are separated because they want opposite things done about them and the row could not tell
 * them apart: a 203-word bulletin was reported as the model having "nothing to say here", which sent
 * an operator looking at a persona sheet for a ceiling that was in the way of a bulletin the prompt
 * had asked for.
 */
export type WriteFault = CharacterFault | 'nothing-said' | 'ran-long';

/**
 * Why a raw answer was refused, for a writer that wants to say so, or `undefined` when it was not.
 *
 * In {@link readAnswer}'s own order, which is what makes the reason the thing that actually happened
 * rather than the first thing this function happened to test: an empty answer is never a character
 * problem, and a script the station was never going to say is not worth asking whether it was in
 * character.
 *
 * It answers with the sentence as well as the fault because both destinations matter and neither is
 * the other: the fault is what a log line can be counted by, and the sentence is what reaches
 * `script_history.reason` and a person reading the console. Deriving them in one place is what stops
 * the row and the log disagreeing about the same break.
 */
export function writeDecline(text: string, guard: AnswerGuard): { fault: WriteFault; reason: string } | undefined {
    const reasoned = (fault: WriteFault) => ({ fault, reason: FAULT_REASONS[fault] });

    const speakable = tidyAnswer(text);
    if (speakable === undefined) return reasoned('nothing-said');
    if (runsLong(speakable, guard)) return reasoned('ran-long');

    const fault = faultIn(speakable, guard);

    return fault === undefined ? undefined : reasoned(fault);
}

/** Drop a pair of marks that wraps the entire text, and only then. */
function stripWrapping(text: string, open: string, close: string): string {
    if (!text.startsWith(open) || !text.endsWith(close) || text.length < 2) return text;

    const inner = text.slice(open.length, -close.length);
    return inner.includes(close) && !inner.endsWith(close) ? text : inner.trim();
}
