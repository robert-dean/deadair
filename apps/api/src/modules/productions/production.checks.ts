/**
 * What is wrong with a drafted beat, judged without a model.
 *
 * The `polished` mode's third pass, and it is arithmetic on purpose. A model asked whether its own
 * draft is any good says yes — the same reason `fact.model.ts` verifies a claim in a SEPARATE
 * conversation that has never seen the article — and everything worth catching here is measurable
 * anyway: a beat that repeats an earlier one, one that came back at half the length it was asked
 * for, one that re-introduces a programme already in progress.
 *
 * ## It answers a LIST, most important first
 *
 * Not a boolean, and not the first problem it finds. A beat is re-drafted at most once, so the one
 * correction it gets has to carry everything wrong with it — fixing the length and being told about
 * the repetition on a second pass that never comes is worse than useless.
 *
 * Ordered because the correction is read by a model with finite attention: the problems that change
 * what the beat SAYS come before the ones that change how long it is.
 *
 * ## Of a speaker's character, it judges only the wording they never use
 *
 * This used to say character and diction were not judged here because a production inherits
 * `readAnswer` and `characterFault` by going through the same writers. It does not: a production has
 * its own writing path and not one of those runs on a beat. What that cost was measured on the
 * conspiracy host's first live call, where his caller picked up the host's dialect ("I reckon") from
 * the turns in front of him, with the words on nobody's list.
 *
 * So the speaker's `avoid` list is read here, through the same `avoidedWording` a break uses, and
 * only the phrase-shaped half of it can ever match. The marker floor is still NOT applied: a beat is
 * a turn in a conversation rather than a break, and refusing a caller's reply for lacking his words
 * is a judgement nobody has measured.
 */

import { withoutCues } from '@deadair/plugin-sdk';
import type { CastRole } from './production.cast.js';
import { withoutRecordNames } from '#modules/director/break.prompt.js';
import { contradictsDayPart, namesWrongTimeOfDay, type RoughTime } from '#modules/director/clock.words.js';
import { unofferedWeather } from '#modules/director/weather.figures.js';
import { avoidedWording } from '#modules/personas/persona.sheet.js';
import { withoutPads } from '#modules/render/pad.cues.js';
import { expectedWords, MAX_WORDS } from './production.plan.js';

/**
 * How far outside its budget a beat may come back before that is worth a re-draft.
 *
 * Wide, and deliberately: the budget is an instruction about pace rather than a contract, and a beat
 * ten percent long is a beat that had something to say. What these catch is the beat that came back
 * as a sentence, and the one that ran away.
 */
export const MIN_RATIO = 0.45;
export const MAX_RATIO = 1.8;

/**
 * How much three-word-sequence overlap with an earlier beat counts as repeating it.
 *
 * Trigrams rather than whole sentences, because a model repeating itself rarely does so word for
 * word — it re-states the same point in slightly different words, which shares its phrases without
 * sharing a single line.
 */
export const DUPLICATE_OVERLAP = 0.35;

/**
 * Markup a beat should never contain, because a beat is SPOKEN.
 *
 * Not a style preference: the speech engine reads what it is given, so a model that emphasised a
 * word as `*yikes*` has written an asterisk into the audio. Measured on a live run, where the
 * presenter's own exclamations came back wrapped in them.
 *
 * Deliberately narrow. An apostrophe, a dash and a question mark are all ordinary speech; these five
 * are the ones that only exist to be looked at.
 */
const MARKUP = /(\*\*?|^#{1,6}\s|^\s*[-*]\s|`|_[A-Za-z])/m;

/**
 * A beat cueing a record as the next thing on air, which no beat can do truthfully: a production is
 * written before it is placed, so nothing it is handed says what follows it. See `NO_RECORD_PLAYING`
 * in `production.prompt.ts` for the banter whose "this next song" was a record nobody played.
 *
 * Only the frames that cannot be about anything but a record. "Coming up", "up next" and "here's"
 * are ordinary conversation in a programme, and a refusal here costs the beat its one re-draft.
 */
const CUES_NEXT_RECORD = /\b(?:this|the) next (?:song|record|track|tune|cut)\b/i;

/**
 * One capitalised word of a title or a name: "Blue", "Motörhead", "AC/DC", "Guns'n'Roses", and the
 * abbreviations that end in a full stop ("Dr. Dre", "Mr. Roboto"), which would otherwise end the run.
 */
const NAME_WORD = "(?:(?:Mr|Mrs|Ms|Dr|St)\\.|[\\p{Lu}\\d][\\p{L}\\d'’/&-]*)";

/** The small words a title or a band name keeps lowercase inside it: "Ace of Spades", "Echo and the Bunnymen". */
const NAME_LINK = '(?:of|the|a|an|in|on|to|and|for|me|my|you|your|with|at|from|is|it|n|&)';

/** A run of capitalised words, joined by nothing but spaces and the small words above. */
const NAME_RUN = `${NAME_WORD}(?:\\s+(?:${NAME_LINK}\\s+)*${NAME_WORD})*`;

/**
 * "Blue Monday by New Order": a title, a lowercase "by", and who made it, each a run of capitalised
 * words, optionally quoted. The other half of {@link CUES_NEXT_RECORD}, since the live banter named
 * its invented record bare in two of its three turns, with no frame in front of it.
 */
const TITLE_BY_ARTIST = new RegExp(`["“]?(${NAME_RUN})["”]?,?\\s+by\\s+(${NAME_RUN})`, 'gu');

/** The words that say a record has just played: "that was", "that's been", "you just heard". */
// Not "that has been": nearly always a relative clause ("a quartet that has been rather consistent
// since the “Call of Duty” EP"), measured on the station's own breaks, where "that's been" is not.
const BACK_FRAME = "(?:[Tt]hat (?:was|one was)|[Tt]hat['’]s been|(?:[Yy]ou|[Ww]e) (?:just|have just|['’]ve just) heard)";

/** The frames that can only be about something heard, for the shape that looks further along the sentence. */
const HEARD_FRAME = "(?:[Yy]ou|[Ww]e) (?:just|have just|['’]ve just) heard";

/**
 * The ways a script says what just played, each with the groups that name a record or an artist.
 *
 * The other direction of {@link CUES_NEXT_RECORD}: a programme knows the record before it no better
 * than the one after. What makes a frame a back-announce rather than "that was close" is a NAME, so
 * every shape here needs one, and the shapes are the ones the station's own talk breaks use:
 *
 * - **"That was Blue Monday"**: a capitalised run straight after the frame, optionally quoted, and
 *   optionally opening with a bracket ("That was (I Can't Get No) Satisfaction").
 * - **"That was honeybee, from Olivia Rodrigo"**: a title in any case, then a comma and a credit. The
 *   comma is what makes it a credit: "that was a gift from God" has none.
 * - **"That was the deadmau5 “Animal Rights”"**: a quoted title a few words after the frame.
 * - **"we just heard that totally rad stuff from ZZ Top"**: a credit later in the sentence, after a
 *   frame that can only be about something heard. "That was a postcard from Paris" is not one.
 * - **"that Iron Maiden, that was bloody powerful"**: an act named in front of the frame.
 *
 * What a frame is followed by with no name ("that was heavy", "that was a choice") is not asked:
 * across the station's talk breaks it was a reaction or an opinion far more often than a record, and
 * the prompt rule is what answers it.
 */
const BACK_ANNOUNCES: readonly RegExp[] = [
    new RegExp(`\\b${BACK_FRAME}\\s+["“‘']?(?<name>(?:\\([^)]{1,40}\\)\\s+)?${NAME_RUN})`, 'gu'),
    new RegExp(`\\b${BACK_FRAME}\\s+(?<title>[^.!?,;:"“”]{1,60}),\\s+from\\s+(?<name>${NAME_RUN})`, 'gu'),
    new RegExp(`\\b${BACK_FRAME}\\s+[^.!?"“”]{0,30}?["“](?<title>[^"”]{2,60})["”]`, 'gu'),
    new RegExp(`\\b${HEARD_FRAME}\\s+[^.!?]{0,40}?\\bfrom\\s+(?<name>${NAME_RUN})`, 'gu'),
    new RegExp(`\\b[Tt]hat\\s+(?<name>${NAME_RUN})(?:\\s+one)?,\\s+that(?:,\\s+that)?\\s+(?:was|one was)\\b`, 'gu'),
];

/**
 * A back-announce frame with no name after it: "that was heavy", "you just heard", "that one was loud".
 *
 * A reaction to a record as if one had just played, which the prompt rule forbids in as many words and
 * the named shapes above cannot see. Two things keep it from reading ordinary English as one.
 *
 * - **"That was" must OPEN a clause**: the start of a sentence, after a comma or a dash, or after a
 *   word a presenter reacts with ("well", "wow", "man"). A relative clause has none of those in
 *   front of it: the one production beat on the live station with "that was" in it said "an
 *   instrumental bridge that was omitted for air play". "You just heard" is about audio wherever it
 *   is, so it counts anywhere.
 * - **A clause about a PERSON is somebody's story** ("that was me singing", "that was the worst week
 *   of my year"), so a first- or second-person word, or the name of somebody on the programme, in the
 *   clause stands it down. The clause ends at the next comma or dash, because what follows is filler:
 *   "that was bloody heavy, I mean" is about a record, and its "I" is not.
 *
 * - **A reaction at the top of a turn that answers somebody is a reply to THEM** ("That was so close,
 *   Wayne"), since the beat prompt tells that turn to answer what was just said before anything
 *   else. See {@link REACTION_WORDS}.
 */
const BARE_BACK_ANNOUNCE = new RegExp(
    `(?:(?:^|[.!?…,;:—–]["”’]?|\\s-)\\s*(?:(?:well|oh|wow|man|so|and|yeah|like|perhaps|maybe|honestly|seriously)[,!]?\\s+)?(?<clause>(?:that|that one)\\s+was|that['’]s\\s+been)` +
        `|(?<heard>(?:you|we)\\s+(?:just|have\\s+just|['’]ve\\s+just)\\s+heard))\\b(?<rest>[^.!?]{0,60})`,
    'giu',
);

/**
 * How far into a turn that answers somebody a bare reaction is read as a reply to them.
 *
 * The first sentence or two, which is where the beat prompt asks for the answer ("Answer what was
 * just said to you before you say anything else"). Further in, the turn has moved on to its own
 * point, and "that was heavy" there is about a record again. Only the BARE frame is excused: a named
 * one ("That was Blue Monday, Wayne") names a record wherever it is.
 */
export const REACTION_WORDS = 20;

/** Words that make the rest of a clause about a person rather than a record. */
const ABOUT_A_PERSON = /\b(?:i|i['’]m|me|my|mine|we|us|our|you|your|yours|he|him|his|she|her|they|them|their)\b/iu;

/**
 * Capitalised words a back-announce frame is followed by that are never a record: the calendar, and
 * the station's own vocabulary. "That was Monday" is a day, and the beat that says it is about one.
 */
const NOT_A_RECORD = new Set([
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
    'i',
    'me',
    'you',
    'him',
    'her',
    'them',
    'us',
    'it',
    'god',
    'mom',
    'mum',
    'dad',
]);

/** How much of the run-in a beat may echo before it is reciting rather than continuing. */
export const RUN_IN_ECHO_WORDS = 6;

/** What one beat is judged against. */
export interface BeatCheckInput {
    /** The drafted words. */
    text: string;
    /** About how many spoken words it was asked for. */
    words: number;
    /** Where it comes, from 0. Beat 0 is the only one allowed to open the programme. */
    ordinal: number;
    /**
     * Whether a caller or the presenter is speaking, for a production with a cast.
     *
     * The {@link OPENING} check is about the PROGRAMME being introduced twice, which is a thing only
     * the presenter can do. A caller saying hello is not a programme introducing itself.
     */
    role?: CastRole;
    /**
     * This is the first the listener has heard of this speaker.
     *
     * A caller's first turn is where they are put on air, and greeting somebody there is what the
     * prompt asked for. Refusing it would be the check marking a beat down for following its own
     * instruction, which is the bargain every guard in this tree keeps.
     */
    firstTurn?: boolean;
    /** The beats already written, for the repetition check. */
    priorBeats?: readonly string[];
    /**
     * The speaker's own `avoid` list, from their sheet.
     *
     * Per speaker, because the words are: a caller forbidden the host's dialect is not forbidding the
     * host it.
     */
    avoid?: readonly string[];
    /**
     * The half of the day this beat was told it was going out in.
     *
     * The same `RoughTime` the prompt was built from, so a beat is judged for contradicting only
     * what it was actually told — the bargain every check in this tree keeps. Absent asks nothing.
     *
     * Note where this does and does not run. `checkBeat` is the `check` pass, which only `polished`
     * mode has, so on a station writing `outlined` productions the daypart is prevention alone. That
     * is deliberate rather than an oversight: the alternative is a second model call per beat on a
     * host that is already timing productions out, and the prompt is where the daypart does most of
     * its work anyway.
     */
    dayPart?: RoughTime;
    /**
     * When this beat goes out and where the station is, for the half {@link dayPart} cannot judge.
     *
     * A daypart is a STRETCH, and a beat can name a POINT inside one and still be hours wrong:
     * "midday" is the afternoon at ten past twelve and the afternoon at half past four. The same
     * split, and the same pair of fields, as `AnswerGuard`. See `namesWrongTimeOfDay`.
     *
     * It carries the note above about where this runs, unchanged: on an `outlined` station there is
     * no check pass, so what a beat is TOLD is the whole of the defence.
     */
    moment?: { at: number; zone: string };
    /**
     * The words this beat was handed to carry on from.
     *
     * Checked because handing a model a quotation makes it read the quotation: beats opened by
     * reciting the previous one's last sentence word for word. The whole-beat overlap check cannot
     * catch it — one sentence in two hundred words is well under the duplicate threshold — so the
     * run-in is compared against the OPENING specifically.
     */
    runIn?: string;
    /**
     * The records the host brought to the call, whose names are taken out before the weather is
     * looked for, so a countdown host talking about "Sunny" is naming a record rather than the sky.
     */
    records?: readonly { title: string; artist: string }[];
    /**
     * What the programme was handed in words: the brief and the notes. A record named in either is
     * one it was given, so naming it is the programme rather than an invention. See
     * {@link recordNobodyGave}.
     */
    handed?: readonly string[];
    /**
     * The names of the people on the programme and of the station, so "brought in by Wayne" is not
     * read as a record by Wayne.
     */
    names?: readonly string[];
    /**
     * This turn answers somebody else on the programme, so a bare reaction at the top of it ("That was
     * weird, Wayne") is a reply to what they just said rather than to a record. See
     * {@link REACTION_WORDS}.
     */
    answering?: boolean;
    /**
     * Whatever on this call may have raised the weather before this beat: the brief an operator
     * typed and the callers' earlier turns. See {@link skyNobodyGave}.
     */
    raised?: readonly string[];
    /**
     * The station's language when it is not English. The four checks that read English words, the
     * two about the time of day, the one about the weather and the one about a programme introducing
     * itself twice, stand down.
     */
    language?: string;
}

/** A beat that opens a programme, so the check knows an opening is only wrong out of place. */
const OPENING = /\b(welcome (back )?to|you're listening to|this is .{0,40}\bpodcast\b|in this (episode|programme|program)|hello and welcome)\b/i;

/**
 * Read a drafted beat and answer with what is wrong, most important first.
 *
 * An empty array means it is good enough to keep. Nothing here throws: a beat that arrived as
 * nonsense is a beat with problems, not an exception.
 */
export function checkBeat(input: BeatCheckInput): string[] {
    const problems: string[] = [];
    const text = input.text.trim();

    // Nothing else is worth reporting: there are no words to judge. This is a real answer rather
    // than a defensive one — a model that spends its whole output allowance on reasoning returns
    // exactly this, which is observable in this station's own logs.
    if (text.length === 0) {
        return ['The beat came back empty. Write it as continuous spoken prose, with no headings, stage directions or bullet points.'];
    }

    // First of the problems that change what the beat SAYS, and so ahead of every length complaint:
    // a beat that told the listener it was the wrong half of the day is wrong at any length.
    const english = input.language === undefined;

    const named = english ? contradictsDayPart(text, input.dayPart) : undefined;
    if (named !== undefined) {
        problems.push(
            `This beat calls it "${named}" when it goes out ${input.dayPart!.words}. Say nothing about the part of the day except that one, ` +
                'and do not reach for the hour, the light or the weather to set a scene you were not given.',
        );
    }

    // The same complaint about a word a daypart cannot judge, and phrased about the CLOCK rather
    // than about the stretch, because that is what makes it wrong: the beat may well have the half
    // of the day right.
    const hour = english ? namesWrongTimeOfDay(text, input.moment?.at, input.moment?.zone) : undefined;
    if (hour !== undefined) {
        problems.push(
            `This beat says "${hour}", which is hours from when it goes out. Say nothing about the time of day except what you were told, ` +
                'and do not reach for a mealtime or an hour to set a scene you were not given.',
        );
    }

    // Still about what the beat SAYS, so ahead of every length complaint. Named rather than described,
    // because a model told only that it used a forbidden word cannot tell which one.
    const forbidden = avoidedWording({ avoid: input.avoid ?? [] }, text);
    if (forbidden.length > 0) {
        problems.push(
            `This beat says ${forbidden.map(word => `"${word}"`).join(', ')}, which this speaker never says. Say the same thing in your own words without it.`,
        );
    }

    // Still about what the beat SAYS. Named for the forbidden words' reason: a model told only that
    // it described the weather cannot tell which sentence did it.
    const sky = skyNobodyGave(input, text);
    if (sky !== undefined) {
        problems.push(
            `This beat says "${sky}", but you were given no weather to report and do not know what it is doing outside. ` +
                'Say nothing about the weather, and do not reach for it to set a scene.',
        );
    }

    // Still about what the beat SAYS: a record it was never handed, cued or named.
    problems.push(...recordFaults({ ...input, text }));

    const spoken = countWords(text);
    const target = expectedWords(input.words);

    if (spoken < Math.round(target * MIN_RATIO)) {
        problems.push(
            `The beat is too short: ${spoken} spoken words against a target of about ${input.words}. Develop it further rather than summarising it.`,
        );
    } else if (spoken > Math.round(input.words * MAX_RATIO)) {
        problems.push(`The beat is far too long: ${spoken} spoken words against a target of about ${input.words}. Tighten it to the target.`);
    }

    // Beat 0 is the opening, so an opening there is correct. Anywhere else it is a model that
    // forgot it was in the middle of something — which is what makes a production sound like
    // several short programmes played back to back rather than one. A caller arriving is excused:
    // being put on air mid-programme is exactly when a greeting belongs, and the prompt asked for
    // one.
    // A studio guest arriving is excused on the same terms: brought on mid-programme, and asked to say hello.
    if (english && input.ordinal > 0 && !(input.role !== undefined && input.role !== 'host' && input.firstTurn === true) && OPENING.test(text)) {
        problems.push('This beat is mid-programme but it introduces the programme again. Cut the greeting and pick it up in progress.');
    }

    if (input.runIn !== undefined && echoesRunIn(input.runIn, text)) {
        problems.push(
            'This beat begins by repeating the words it was told to carry on from. Those have already been said: start after them, with something new.',
        );
    }

    if (MARKUP.test(text)) {
        problems.push(
            'This beat contains formatting — asterisks, hashes, backticks or bullet points. It is read aloud exactly as written, so write it as plain spoken prose.',
        );
    }

    const overlap = Math.max(0, ...(input.priorBeats ?? []).map(prior => trigramOverlap(prior, text)));
    if (overlap >= DUPLICATE_OVERLAP) {
        problems.push(
            'This beat repeats an earlier one almost word for word. Say something new: a different angle, different phrasing, and no re-stating what has already been covered.',
        );
    }

    return problems;
}

/**
 * The weather a presenter's beat described when nobody gave the call any, or `undefined`.
 *
 * The break writers' `unoffered-weather` question asked of a production, through the same
 * `unofferedWeather` and with the record names out first for the same reason. No production prompt
 * is ever handed a weather reading, so there is no reading to exempt a beat: the prompt's one
 * sentence asking a beat not to reach for the weather was the whole of the defence, and a host will
 * still put the caller on with "sunny out there".
 *
 * The PRESENTER only, which is the host on a call and whoever speaks a production with no cast. A
 * caller is somebody somewhere else, and "it's pouring down here" is the caller's own afternoon
 * rather than the station describing the sky over its listeners. A GUEST is held to it like the host,
 * because a guest is in the studio, under the same sky as the station. Once a caller or the brief has
 * raised the weather, the host answering it is following the conversation rather than inventing a
 * scene, so that stands the check down for the rest of the call.
 */
function skyNobodyGave(input: BeatCheckInput, text: string): string | undefined {
    if (input.language !== undefined || input.role === 'caller') return undefined;
    if ((input.raised ?? []).some(earlier => unofferedWeather(withoutCues(earlier)) !== undefined)) return undefined;

    // Cues and pads out first: a drop called `[sfx:thunderstorm]` is a sound, not a forecast.
    return unofferedWeather(withoutRecordNames(withoutPads(withoutCues(text)), { names: input.records ?? [] }));
}

/** What {@link recordFaults} reads: the beat, and what the programme was handed. */
export type RecordCheckInput = Pick<BeatCheckInput, 'text' | 'records' | 'handed' | 'names' | 'language' | 'answering'>;

/**
 * The records a beat cued or named without being handed them, as corrections, most telling first.
 *
 * The one part of {@link checkBeat} the DRAFT pass runs as well, so a production in a mode with no
 * check pass is still held to it. Every other check here is a matter of quality and waits for the
 * mode that pays for one; this is a matter of truth, since a record named is a record a listener
 * waits for and never hears, and the draft pass is the only pass every mode has.
 */
export function recordFaults(input: RecordCheckInput): string[] {
    if (input.language !== undefined) return [];
    const problems: string[] = [];

    // Quoted for the forbidden words' reason: a model told only that it cued a record cannot tell where.
    const cue = CUES_NEXT_RECORD.exec(withoutCues(input.text))?.[0];
    if (cue !== undefined) {
        problems.push(
            `This beat says "${cue}", but nothing plays under a programme and you were not told what comes after it. ` +
                'Do not introduce or name a record as coming up.',
        );
    }

    // The other direction: a record said to have just played, which the programme knows no better.
    const announced = backAnnounced(input, input.text);
    if (announced !== undefined) {
        problems.push(
            `This beat says "${announced.said}", but nothing plays under a programme and you were not told what played before it. ` +
                'Do not say what just played, and name no record you were not handed.',
        );
    }

    // A frame with nothing named after it, asked only when no named shape was found: one correction a
    // reaction, since the named one above already says everything this would.
    const reacted = announced === undefined ? bareBackAnnounce(input, input.text) : undefined;
    if (reacted !== undefined) {
        problems.push(
            `This beat says "${reacted}" as if a record had just played, but nothing plays under a programme. ` +
                'Do not react to a record or say what just played.',
        );
    }

    // The same fault without the frame: a record named outright that nobody handed the programme.
    // Left out when it is the record just back-announced, which the correction above already names.
    const invented = recordNobodyGave(input, input.text);
    if (invented !== undefined && (announced === undefined || !invented.includes(announced.record))) {
        problems.push(
            `This beat names "${invented}", a record you were not given. Nothing plays under a programme, so name no record, song or artist you were not handed.`,
        );
    }

    return problems;
}

/**
 * A record named as "Title by Artist" that the programme was never handed, or `undefined`.
 *
 * No beat knows the record either side of it (`NO_RECORD_PLAYING` in `production.prompt.ts`), so a
 * record it names that is not among the ones it was handed, the countdown host's records, the brief
 * or the notes, is one the model chose. Measured live on 2026-10-20: "Blue Monday by New Order" in
 * three turns of one banter, between two other records.
 *
 * It refuses narrowly, on the bargain every check here keeps, since a refusal costs a beat its one
 * re-draft. Both sides must be capitalised and "by" must not be, so "blown away by Wayne" and a
 * shouted line are not read as records. A one-word "title" opening a sentence is English rather than
 * a record ("Inspired by Wayne"), and an "artist" who is somebody on the programme or the station
 * itself is a person doing something rather than a credit. Anything that shares a title or an artist
 * with what the programme was handed is a record it was given.
 */
function recordNobodyGave(input: RecordCheckInput, text: string): string | undefined {
    const spoken = withoutPads(withoutCues(text));
    const { given, person } = handedTo(input);

    for (const match of spoken.matchAll(TITLE_BY_ARTIST)) {
        const [, title, artist] = match as unknown as [string, string, string];
        const before = spoken.slice(0, match.index).trimEnd();
        if (!title.includes(' ') && (before.length === 0 || /[.!?:;]["”]?$/.test(before))) continue;
        if (person(artist)) continue;
        if (given(title) || given(artist)) continue;
        // Named back as the record alone, without the "this is" in front of it or a quote mark caught at either end.
        return `${title.replace(/^(?:It|This|That|Here)\s+(?:is|was)\s+/, '')} by ${artist}`.replace(/^['‘]|['’]$/g, '').replace(/['’](?= by )/, '');
    }

    return undefined;
}

/**
 * A record said to have just played that the programme was never handed, or `undefined`: the words
 * that said it, and the title or name in them, so the bare-credit check can tell it is the same one.
 *
 * Refused on {@link recordNobodyGave}'s terms, and every shape in {@link BACK_ANNOUNCES} is vetted
 * the same way. A capitalised name must not be shouted (Garth's turns are in capitals by design, and
 * "THAT WAS AMAZING" is not a record), somebody on the programme ("that was Wayne"), a day, a month
 * or a pronoun; and neither the name nor the title may be anything the programme was handed.
 */
function backAnnounced(input: RecordCheckInput, text: string): { said: string; record: string } | undefined {
    const spoken = withoutPads(withoutCues(text));
    const { given, person } = handedTo(input);

    const found = BACK_ANNOUNCES.flatMap(pattern => [...spoken.matchAll(pattern)]).sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
    for (const match of found) {
        const name = match.groups?.name?.replace(/^\(/u, '');
        const title = match.groups?.title?.trim();
        if (name !== undefined && (name === name.toUpperCase() || NOT_A_RECORD.has(name.toLowerCase()) || person(name) || given(name))) continue;
        if (title !== undefined && given(title)) continue;
        // Quote marks out, except an apostrophe inside a word, so "that's" and "Can't" keep theirs.
        const said = match[0]
            .replace(/["“”‘]|(?<![\p{L}])'|'(?![\p{L}])/gu, '')
            .replace(/\s+/gu, ' ')
            .replace(/[\s,.;:]+$/u, '')
            .trim();
        return { said, record: title ?? name ?? said };
    }

    return undefined;
}

/**
 * A frame with no name after it, as the words that said it, or `undefined`. See
 * {@link BARE_BACK_ANNOUNCE} for what makes one, and what it stands down for.
 */
function bareBackAnnounce(input: RecordCheckInput, text: string): string | undefined {
    const spoken = withoutPads(withoutCues(text));
    const { person } = handedTo(input);

    for (const match of spoken.matchAll(BARE_BACK_ANNOUNCE)) {
        if (input.answering === true && countWords(spoken.slice(0, match.index)) < REACTION_WORDS) continue;
        const frame = match.groups?.clause ?? match.groups?.heard ?? '';
        // The clause alone, up to the next comma or dash: what comes after it is filler ("that was
        // bloody heavy, I mean") or the next thought, and an "I" in it is not what the clause is about.
        const clause = (match.groups?.rest ?? '').split(/[,;:—–]/u)[0] ?? '';
        if (ABOUT_A_PERSON.test(clause)) continue;
        if (clause.split(/\s+/u).some(word => word.length > 0 && person(word))) continue;
        // The frame and the clause, which is enough for a model to find the sentence.
        return `${frame}${clause}`.trim().split(/\s+/u).slice(0, 8).join(' ');
    }

    return undefined;
}

/**
 * What a programme may name, as two questions: whether a title or an artist is among what it was
 * handed, and whether a name is somebody on it (or the station) rather than a credit.
 */
function handedTo(input: RecordCheckInput): { given: (part: string) => boolean; person: (name: string) => boolean } {
    const known = [...(input.records ?? []).flatMap(record => [record.title, record.artist]), ...(input.handed ?? [])].map(entry =>
        entry.toLowerCase(),
    );
    const people = (input.names ?? []).map(name => name.toLowerCase());

    return {
        given: part => known.some(entry => entry.includes(part.toLowerCase())),
        person: name => {
            const lower = name.toLowerCase();
            return people.some(one => lower === one || lower.startsWith(`${one} `) || lower.startsWith(`${one}'`) || lower.startsWith(`${one}’`));
        },
    };
}

/**
 * The correction appended to a beat's prompt for its one re-draft.
 *
 * "Rewrite it from scratch" rather than "fix these", because a model handed its own draft and a list
 * of complaints edits around them and keeps the shape that produced them — which is exactly what
 * fails again on a beat that was too short or that repeated an earlier one.
 */
export function correctionNote(problems: readonly string[]): string {
    return [
        'Your previous attempt at this beat had problems. Rewrite it from scratch and fix them:',
        ...problems.map(problem => `- ${problem}`),
    ].join('\n');
}

/**
 * Whether a beat opens by reciting what it was handed rather than continuing from it.
 *
 * Compares the END of the run-in against the START of the beat, which is where the echo happens: a
 * model picks the quotation up and reads it before saying anything of its own. Anywhere else in the
 * beat is the ordinary duplicate check's business.
 */
function echoesRunIn(runIn: string, text: string): boolean {
    const tail = words(runIn);
    const head = words(text).slice(0, tail.length + RUN_IN_ECHO_WORDS);
    if (tail.length < RUN_IN_ECHO_WORDS || head.length < RUN_IN_ECHO_WORDS) return false;

    // Any run of RUN_IN_ECHO_WORDS from the run-in appearing in the beat's opening is an echo.
    for (let at = 0; at + RUN_IN_ECHO_WORDS <= tail.length; at++) {
        const run = tail.slice(at, at + RUN_IN_ECHO_WORDS).join(' ');
        if (head.join(' ').includes(run)) return true;
    }
    return false;
}

/** A text as lowercase words, with punctuation dropped so an echo cannot hide behind it. */
const words = (text: string): string[] =>
    text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);

/** Spoken words in a chunk of text. */
export function countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * How much of the shorter text's three-word sequences appear in the longer one, from 0 to 1.
 *
 * Against the SHORTER side deliberately: a 40-word beat entirely lifted from a 200-word one shares
 * only a fifth of the longer text's phrases, and judging it that way would miss the case worth
 * catching. Two texts with nothing to compare answer 0 rather than dividing by zero.
 */
export function trigramOverlap(left: string, right: string): number {
    const one = trigrams(left);
    const two = trigrams(right);
    const smaller = one.size <= two.size ? one : two;
    const larger = one.size <= two.size ? two : one;
    if (smaller.size === 0) return 0;

    let shared = 0;
    for (const gram of smaller) if (larger.has(gram)) shared += 1;

    return shared / smaller.size;
}

/** Every three-word sequence in a text, normalized so punctuation and case do not hide a repeat. */
function trigrams(text: string): Set<string> {
    const words = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);

    const grams = new Set<string>();
    for (let index = 0; index + 2 < words.length; index++) grams.add(`${words[index]} ${words[index + 1]} ${words[index + 2]}`);

    return grams;
}

/** Re-exported so a caller judging a beat needs one import rather than two. */
export { MAX_WORDS };
