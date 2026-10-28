/**
 * What the station will accept back from a model: the guards {@link readAnswer} and {@link faultIn}
 * run over a written break before it is spoken, and the readers they share ({@link misCuedIn},
 * {@link yearsIn}, {@link permittedYears}).
 *
 * Split out of `break.prompt.ts`, which keeps what the station ASKS for. See that file's header for
 * the failure both halves are shaped around.
 */
import { SUBJECT_ECHO_WORDS } from '#modules/lyrics/lyric.subject.js';
import { isSpeechDelivery, sentencesOf, sentencesWithin, withoutCues, type LlmMessage, type SpeechDelivery } from '@deadair/plugin-sdk';
import { withoutPads } from '#modules/render/pad.cues.js';
import { afterThinking, speakableScript } from '#modules/render/speakable.script.js';
import {
    characterFault,
    runOf,
    subjectsVisited,
    type CharacterContext,
    type CharacterFault,
    type PersonaSheet,
} from '#modules/personas/persona.sheet.js';
import type { SpokenWeather } from '#modules/weather/weather.words.js';
import { claimedHomeIn } from '#modules/shared/station.home.js';
import { inventedFigure, unofferedWeather } from './weather.figures.js';
import type { BreakTrack } from './break.writer.js';
import { contradictsDayPart, namesWrongSky, namesWrongTimeOfDay, type RoughTime } from './clock.words.js';
import { spoken } from './talk.break.writer.js';
import { bareWords, NOT_A_HABIT, PRESENTER_CUES, DEFAULT_MAX_WORDS } from './break.prompt.js';

/**
 * The record a script actually named, or `undefined` when it named none of them.
 *
 * Generous on purpose, and the generosity is the design rather than a weakness. What this is
 * catching is a break that mentions no record whatsoever — thirty-nine were measured and roughly
 * three quarters were that — and NOT a break that got a title slightly wrong. A strict comparison
 * here would refuse a presenter calling "(Don't Fear) The Reaper" the Reaper, which is what a
 * presenter calls it, and every refusal costs the station the model's sentence.
 *
 * So a record counts as named when the script carries its title, its title with any parenthetical
 * taken off, or the artist's name. Compared as bare words for {@link echoedSample}'s reason: a curly
 * apostrophe, a capital and a comma are not the difference between naming a record and not.
 *
 * Or the artist the way a presenter actually SAYS it, which is {@link shortArtistNames}: "that
 * Stones track", "White Stripes is up next", "that Petty track" were all refused as naming neither
 * record while naming one plainly.
 *
 * And both sides are read a second time as they are said ({@link asSaid}), so "Booker T and the MGs" names Booker T. &
 * the M.G.s. The written form is tried as well rather than replaced, so nothing that matched before
 * stops matching.
 */
export function namedRecordIn(script: string, records: readonly (BreakTrack | undefined)[], language?: string): BreakTrack | undefined {
    const says = language === undefined ? saysName : saysNameInflected;
    const readings = [script, asSaid(script)].map(text => ({
        spoken: ` ${bareWords(text)} `,
        capitalised: ` ${bareWords(capitalisedOnly(text))} `,
    }));

    return records.find(record => {
        if (record === undefined) return false;
        const said = { ...record, title: asSaid(record.title), artist: asSaid(record.artist) };
        return [record, said].some(
            (form, index) =>
                identifiersOf(form).some(candidate => says(readings[index]!.spoken, candidate)) ||
                shortArtistNames(form.artist).some(candidate => says(readings[index]!.capitalised, candidate)),
        );
    });
}

/**
 * A name the way it is SAID rather than written: an ampersand as "and", and the dots taken out of an
 * abbreviation, so "M.G.s" is "MGs" and "Booker T." is "Booker T".
 *
 * Measured on the live station on 15 October: every rehearsal runs Green Onions by Booker T. & the
 * M.G.s into Ain't No Sunshine, and 4 of 7 of one persona's were refused as naming neither record for
 * "Booker T and the MGs". {@link bareWords} drops the `&` outright and turns each dot into a word
 * break, so the record read `booker t the m g s` and the script `booker t and the mgs`. A presenter
 * writing the band as it is spoken is naming it, and a refusal there costs the model's whole break.
 *
 * Applied to the script and to the record alike, so it is only a change of spelling: "and" between
 * two names is never a name by itself, and a dotted abbreviation is only ever joined into the letters
 * it already had. Kept out of `bareWords` itself because {@link withoutRecordNames} walks the text by
 * the same word boundaries `bareWords` draws and would cut the wrong span.
 */
const asSaid = (text: string): string =>
    text.replace(/\s*&\s*/g, ' and ').replace(/(?<![\p{L}\p{N}'])(?:\p{L}\.)+\p{L}*/gu, abbreviation => abbreviation.replaceAll('.', ''));

/**
 * The shorter names an artist goes by on air: without a leading "The", and by the last word alone.
 *
 * "The Rolling Stones" is "the Stones", "The White Stripes" is "White Stripes" and "Tom Petty" is
 * "Petty", and a check that wanted the whole name refused all three. Both are kept to what can
 * stand as a name: a short form that is a grammar word or under four letters is dropped, which is
 * what keeps "The Who" from being named by every question a presenter asks.
 *
 * Matched only against the CAPITALISED words of a script (see {@link capitalisedOnly}), because a
 * short form is very often an ordinary word as well: "Doors" names The Doors and "both doors open at
 * eight" names nothing. A capital is how the written script says which one it means.
 */
const shortArtistNames = (artist: string): string[] => {
    const full = bareWords(artist);
    const unprefixed = full.replace(/^the /, '');
    const words = unprefixed.split(' ');
    const forms = [unprefixed, words.length > 1 ? (words.at(-1) ?? '') : ''];

    return [...new Set(forms)].filter(form => form !== full && form.length >= MIN_SHORT_NAME_LENGTH && !NOT_A_HABIT.has(form));
};

/** How short a shortened artist name may be and still count as naming them. See {@link shortArtistNames}. */
const MIN_SHORT_NAME_LENGTH = 4;

/**
 * A script with every word that does not open on a capital replaced by a `0`, which {@link bareWords}
 * keeps as a word, so two capitalised words that were not side by side never become a name. See
 * {@link shortArtistNames}.
 */
const capitalisedOnly = (script: string): string => script.replace(/[\p{L}\p{N}][\p{L}\p{N}‘’ʼ′']*/gu, word => (/^\p{Lu}/u.test(word) ? word : '0'));

/**
 * Whether some bare words name a record, counting the possessive as the name.
 *
 * **"Iron Maiden's Run to the Hills" is how a presenter names a record**, and `bareWords` keeps the
 * apostrophe, so a plain `" iron maiden "` search never matches it: what is in the text is
 * `iron maiden's`. {@link misCuedIn} worked this out for itself and handled it inline; the check
 * above did not, and the two have been disagreeing about what naming a record means ever since.
 *
 * Measured on the live station, on every break it has ever refused for naming neither of the records
 * it was shown: of 51, only 8 genuinely named neither. **27 of the remaining 43 named a record in
 * the possessive** and were refused for it — "Bon Jovi's debut single, Runaway", "The Smashing
 * Pumpkins' Bullet with Butterfly Wings", "Megadeth's Hangar 18" — which makes this the single
 * largest cause of that refusal, ahead of anything about a persona sheet.
 *
 * Both endings, because English has two: `'s` for the singular and a bare `'` after a plural, and a
 * roster of bands is full of the second. One helper for both callers so they cannot drift apart
 * again, which is the whole reason this is not two inline expressions.
 */
const saysName = (spoken: string, candidate: string): boolean =>
    spoken.includes(` ${candidate} `) || spoken.includes(` ${candidate}'s `) || spoken.includes(` ${candidate}' `);

/**
 * {@link saysName} for a station that is not English, where a name takes endings English does not
 * give it: the German genitive writes "Metallicas neues Album" with no apostrophe at all. So the name
 * counts followed by any short ending, which is looser than English needs and only as loose as the
 * question is: this is asking whether a break named a record at all, not whether it spelled it.
 */
const saysNameInflected = (spoken: string, candidate: string): boolean =>
    new RegExp(`(?:^|\\s)${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\p{L}{0,2}|'s|')(?=\\s|$)`, 'u').test(spoken);

/**
 * The words that identify one record in a script: its title, its title with any aside taken off,
 * its title as it is READ, and its artist.
 *
 * The parenthetical is stripped as an ALTERNATIVE rather than instead: "Pink Moon" has none and is
 * unaffected, and a title that is entirely parenthetical falls back to the whole thing. Compared as
 * bare words for {@link echoedSample}'s reason: a curly apostrophe, a capital and a comma are not
 * the difference between naming a record and not.
 *
 * The read title is the one {@link describe} shows the model, so it has to count: without it a break
 * saying "Tornado Of Souls" for "Tornado Of Souls - 2004 Remix", and not the artist, named the record
 * it was shown and was refused for naming neither.
 */
const identifiersOf = (record: BreakTrack): string[] =>
    [record.title, record.title.replace(/\([^)]*\)/g, ' '), spoken(record.title), record.artist]
        .map(bareWords)
        .filter(candidate => candidate.length > 0);

/**
 * How many words after a cue phrase still count as part of the cue.
 *
 * Eight, which covers "that was Iron Maiden's Run to the Hills" with room to spare and stops well
 * short of the next sentence. A window is what keeps this a check on the CUE rather than on the
 * whole break: a script may perfectly well back-announce one record and then mention the other
 * later, and only the words attached to the frame say which one it is claiming played.
 */
const CUE_WINDOW_WORDS = 8;

/**
 * The ways a script says a record has just played, as bare words.
 *
 * Deliberately the plain ones. A frame nobody writes catches nothing, and a frame that is ordinary
 * English somewhere else ("that's the thing about b-sides") costs a refusal only if the WRONG
 * record's name is sitting right behind it, which is the whole of what makes this safe.
 */
const BACK_ANNOUNCE_FRAMES = [
    'that was',
    "that's",
    'that is',
    'those were',
    'you just heard',
    'we just heard',
    'you were listening to',
    'just played',
    'just spun',
];

/** The irregular past tenses a presenter reaches for about a record, beside every regular `-ed`. */
const PAST_TENSES = [
    'hit',
    'slid',
    'spun',
    'rang',
    'blew',
    'came',
    'went',
    'took',
    'ran',
    'tore',
    'shook',
    'broke',
    'lit',
    'flew',
    'swung',
    'sang',
    'left',
    'gave',
    'made',
    'brought',
];

/**
 * The words that, straight AFTER a record's name, say it has just played: "Mississippi Queen just hit
 * the speakers".
 *
 * The name-first half of {@link BACK_ANNOUNCE_FRAMES}, added after 25 September, when two breaks in
 * twenty minutes did exactly this about the record still to come: `Talk break: Thrasher into
 * Mississippi Queen` ("Mississippi Queen just hit the speakers", never mentioning Thrasher) and a
 * weather break going into Lovefool ("Lovefool just slid into the mix"). Every frame above puts the
 * cue in FRONT of the name, so neither was read at all.
 *
 * "Just" alone is not enough: "Lovefool, just the thing for a Friday" is a forward line with the comma
 * gone. So it has to be followed by a past tense, which is a regular `-ed` or one of
 * {@link PAST_TENSES}, or by "now". An optional "has" or "have" in front is the same claim.
 */
const JUST_PLAYED = new RegExp(`^(?:(?:has|have) )?just (?:now|\\p{L}+ed|${PAST_TENSES.join('|')})(?: |$)`, 'u');

/**
 * Whether a window's words cue a record in the direction opposite to the one being judged, so "that's
 * Lovefool coming up" is read as the forward cue it is rather than as "that's" about the next record.
 */
const hasFrame = (window: string, frames: readonly string[]): boolean => frames.some(frame => window.includes(` ${frame} `));

/**
 * How far into a back-announce's window the record's name may START and still be what the frame is
 * about.
 *
 * "That was Iron Maiden's Run to the Hills" names it at once, and "that was, of course, Madhouse" two
 * words in. What starts later is somebody using "that's" as English: measured on the live station's
 * bulletins before one-record kinds were judged at all, "a track that's sure to keep you moving, I'm
 * Broken" and "That is all for now. Next: Bring The Noise" would both have been refused, and both
 * were forward lines. The window stays {@link CUE_WINDOW_WORDS} wide for the RIGHT record, which is
 * what excuses a correct double cue.
 */
const BACK_ANNOUNCE_LEAD_WORDS = 3;

/**
 * Words that, in front of a back-announce frame, turn it round: "following that is Primus". Measured
 * the same way as {@link BACK_ANNOUNCE_LEAD_WORDS}, on a weather break that said exactly that.
 */
const FORWARD_LEADS = ['following', 'after'];

/**
 * The ways a script says a record is still to come. Same doctrine as {@link BACK_ANNOUNCE_FRAMES}.
 *
 * The "next cut" family was added after 23 September, segment `Talk break: Laid to Rest into Scourge
 * of Iron`: "the next cut is Laid to Rest" about the record that had just finished passed, because
 * "next is" needs the two words touching and a presenter puts a noun between them.
 */
const FORWARD_FRAMES = [
    'coming up',
    'next up',
    'up next',
    'next is',
    "here's",
    'here comes',
    'coming your way',
    'stay tuned for',
    'next cut',
    'next track',
    'next song',
    'next record',
    'next tune',
    'next spin',
];

/**
 * What in a back-announce's window says it is really a forward line: every forward frame, plus a bare
 * "next", which a presenter says on its own ("Next: Bring The Noise") and which is never a
 * back-announce.
 */
const FORWARD_HINTS = [...FORWARD_FRAMES, 'next'];

/** The two records a break sits between, so a cue can be judged against the right one. */
export interface BreakCues {
    previous?: BreakTrack;
    next?: BreakTrack;
}

/**
 * Whether a script cued a record on the WRONG SIDE of the break.
 *
 * ## The failure
 *
 * Measured on air on 19 August, segment `e26a93f0`, labelled `Talk break: Madhouse into Run to the
 * Hills`: the script opened "That was Iron Maiden's "Run to the Hills," …" about the record that had
 * not played yet. Every existing check passed it — it is unmistakably the persona speaking, it is
 * inside the ceiling, and {@link namedRecordIn} is satisfied because it named a record it was shown.
 * Nothing asked WHICH side of the boundary that record was on.
 *
 * The prompt was never the problem: the two records are labelled "The record that has just finished"
 * and "The record coming up next" in as many words. This is the same shape as the persona
 * prohibitions — a rule the station was already sending and nothing was reading back — and the same
 * shape as the failure this whole file is built around, which the header states as framing real
 * facts as a CUE. The framing was banned there and is now checkable here.
 *
 * ## Why it refuses so narrowly
 *
 * Only where the name is attached to a frame: within {@link CUE_WINDOW_WORDS} after a forward one,
 * starting within {@link BACK_ANNOUNCE_LEAD_WORDS} of a back-announce, or straight before
 * {@link JUST_PLAYED}. Only where the name is UNAMBIGUOUS —
 * an identifier the two records share (two songs by one artist, a self-titled record) is dropped
 * from both, so "that was Megadeth" going into more Megadeth is not a fault. And never where the
 * RIGHT record is named in the same window too, since "that was Madhouse, and now Run to the Hills"
 * is a correct double cue and reads as one only if both are counted, and never where a frame of the
 * OTHER direction sits in the same window ("that's Lovefool coming up").
 *
 * ## One record is enough
 *
 * This used to ask nothing unless both records were known, on the argument that with one there is
 * no wrong side to confuse it with. That was wrong about the kinds it excused. A weather break, a
 * bulletin or a story is shown only the record coming up, so a back-announce of THAT record is wrong
 * by construction; it is the Lovefool break above. So a back-announce is judged whenever the next
 * record is known, and a forward cue whenever the previous one is.
 *
 * Every one of those is the same bargain the rest of the guards here are on: a refusal costs the
 * station the model's sentence and drops it to the floor, so this refuses only what it is sure of.
 */
export function misCuedIn(script: string, cues: BreakCues): boolean {
    const { previous, next } = cues;
    const spoken = bareWords(script);
    const words = spoken.split(' ').filter(Boolean);

    // Shared identifiers dropped from BOTH sides: they cannot tell the two records apart, so a match
    // on one is not evidence of anything. See the note above about two songs by one artist.
    const shared = new Set(
        previous === undefined || next === undefined ? [] : identifiersOf(previous).filter(one => identifiersOf(next).includes(one)),
    );
    const telling = (record: BreakTrack | undefined): string[] => (record === undefined ? [] : identifiersOf(record).filter(one => !shared.has(one)));

    // `lead` is how many words in the wrong name may START, which only a back-announce narrows (see
    // `BACK_ANNOUNCE_LEAD_WORDS`); a forward cue keeps the whole window. `leads` are the words that,
    // in front of the frame, turn it round.
    const cued = [
        {
            frames: BACK_ANNOUNCE_FRAMES,
            against: FORWARD_HINTS,
            lead: BACK_ANNOUNCE_LEAD_WORDS,
            leads: FORWARD_LEADS,
            wrong: telling(next),
            right: telling(previous),
        },
        { frames: FORWARD_FRAMES, against: BACK_ANNOUNCE_FRAMES, lead: CUE_WINDOW_WORDS, leads: [], wrong: telling(previous), right: telling(next) },
    ];

    const frameFirst = cued.some(({ frames, against, lead, leads, wrong, right }) =>
        frames.some(frame => {
            const size = frame.split(' ').length;

            return words.some((_, at) => {
                if (at + size > words.length || words.slice(at, at + size).join(' ') !== frame) return false;
                if (leads.includes(words[at - 1] ?? '')) return false;

                const window = words.slice(at + size, at + size + CUE_WINDOW_WORDS);
                const spokenWindow = ` ${window.join(' ')} `;
                // The possessive counted as the name, because "Iron Maiden's Run to the Hills" is how
                // a presenter says it and a check that missed it would catch only half the failure.
                // Through {@link saysName} rather than inline, which is where this argument was worked
                // out once and then not applied to `namedRecordIn` — see the note there for what that
                // cost.
                const leadsWith = (one: string): boolean =>
                    window.slice(0, lead).some((__, skip) => {
                        const rest = ` ${window.slice(skip).join(' ')} `;
                        return [` ${one} `, ` ${one}'s `, ` ${one}' `].some(form => rest.startsWith(form));
                    });

                return wrong.some(leadsWith) && !right.some(one => saysName(spokenWindow, one)) && !hasFrame(spokenWindow, against);
            });
        }),
    );
    if (frameFirst) return true;

    // The name-first shape, which only ever claims a record PLAYED, so only the next record can be
    // wrong in it. Read from the words straight after each place the name is said.
    const padded = ` ${spoken} `;
    return telling(next).some(one => {
        for (let at = padded.indexOf(` ${one} `); at !== -1; at = padded.indexOf(` ${one} `, at + 1)) {
            if (JUST_PLAYED.test(padded.slice(at + one.length + 2))) return true;
        }
        return false;
    });
}

/**
 * The words a script used to credit a record to its own title, or `undefined`: "Black Sabbath by War
 * Pigs" for War Pigs by Black Sabbath.
 *
 * Measured live on 2026-10-10, in a break that named both halves of the record correctly and joined
 * them the wrong way round. `namesNothing` cannot see it, because the script DOES name the record, and
 * `misCuedIn` cannot either, because the record is on the right side of the break. The prompt shows a
 * record as two labelled lines rather than as a phrase, so the order "Title by Artist" is something the
 * model has to put together for itself.
 *
 * Only the swapped phrase, and only whole: the artist's name, then "by", then a title the record goes
 * by. "War Pigs by Black Sabbath" and "Black Sabbath, War Pigs" both pass. A record whose title and
 * artist share a name, or where one contains the other ("Black Sabbath" by Black Sabbath), is skipped,
 * because there is no wrong order to say it in.
 */
export function swappedCreditIn(script: string, records: readonly (BreakTrack | undefined)[]): string | undefined {
    const spoken = ` ${bareWords(script)} `;

    for (const record of records) {
        if (record === undefined) continue;
        const artist = bareWords(record.artist);
        if (artist.length === 0) continue;

        const titles = identifiersOf(record).filter(one => one !== artist);
        if (titles.some(title => title.includes(artist) || artist.includes(title))) continue;

        const swapped = titles.map(title => `${artist} by ${title}`).find(phrase => spoken.includes(` ${phrase} `));
        if (swapped !== undefined) return swapped;
    }
    return undefined;
}

/** What a model's answer has to survive to become a script. */
export interface AnswerGuard {
    /**
     * The ceiling this answer is refused past, defaulting to {@link DEFAULT_MAX_WORDS}.
     *
     * **Build it with {@link maxWordsFor}, from the same settings the prompt was built from.** A
     * persona's latitude moves this and the number the model was told together, and they are the
     * only two places the ceiling exists. See that function for what disagreeing costs.
     */
    maxWords?: number;
    /**
     * The character it was asked to write in, checked against what came back.
     *
     * A sheet that named no markers, no samples, no catchphrases and no forbidden wording makes no
     * checkable claim and so passes everything. See {@link characterFault}.
     */
    persona?: PersonaSheet;
    /**
     * What this character said the last few times it picked up the thread this break was handed.
     *
     * Shown in the prompt so a running joke can be built on, and refused here so it cannot simply be
     * said again — the two halves of one bargain, and the same one `spentCatchphrases` already
     * strikes. See `CharacterContext.told`.
     */
    told?: readonly string[];
    /**
     * Whether that character's DIALECT is required of the answer, or only its prohibitions.
     *
     * `required` by default, which is every kind of break whose job is voice. A bulletin passes
     * `optional`, and {@link CharacterContext.dialect} carries the whole argument for why one kind
     * gets to be plain while still being held to what the sheet forbids.
     */
    dialect?: CharacterContext['dialect'];
    /**
     * The last few things the station said, exactly as the prompt was shown them.
     *
     * Read only to decide which signature phrases are spent, and it has to be the same list the
     * prompt carried: a script refused for a repetition it was never warned about is the trick
     * question the markers used to be, and the whole bargain here is that the station asks for
     * something before it refuses a script for not doing it.
     */
    recent?: readonly string[];
    /**
     * The records this break was shown, at least one of which it has to name.
     *
     * Empty or absent means the question is not asked, which covers every kind whose shape does not
     * set {@link BreakPromptShape.mustNameRecord} and every moment that had no record to show — the
     * top of an order, and every welcome. A break cannot be refused for failing to name something it
     * was never given, which is the same bargain the markers and the spent signatures are on.
     */
    names?: readonly (BreakTrack | undefined)[];
    /**
     * The lyric lines of the records this break was shown, to refuse a script that quotes one.
     *
     * The writer is shown what a record is ABOUT and never its words, so this catches the case that
     * cannot: a model that knows the chorus anyway. Absent means the question is not asked, which is
     * every break with `breaks.aboutTheRecord` off. See {@link quotedLyricIn}.
     */
    lyrics?: readonly string[];
    /**
     * Who may be named in front of the script as its speaker, so that label is taken off before the
     * engine reads it out. Built by `speakerGuard`. See `SpeakableOptions.speakers`.
     */
    speakers?: readonly string[];
    /**
     * The two records this break sits BETWEEN, so a cue can be judged against the right one.
     *
     * Separate from {@link AnswerGuard.names}, which is a flat list because the question it asks —
     * did this break name anything at all — does not care which side a record is on. This one is
     * only about the sides, so it needs them kept apart. Absent means the question is not asked. One
     * side alone is still worth passing: a kind shown only the next record can still back-announce
     * it, and {@link misCuedIn} judges whichever side it is given.
     */
    cues?: BreakCues;
    /**
     * The half of the day this break was told it was speaking in.
     *
     * The same `RoughTime` the prompt was built from, on {@link AnswerGuard.recent}'s bargain: the
     * station asks before it refuses. Absent means the question is not asked, which covers a break
     * whose row carried no `airs_at` — and that used to be every ordinary talk break, which is the
     * bug this exists downstream of rather than the state it is designed for.
     *
     * See {@link contradictsDayPart} for why it is judged at the resolution of light-and-dark rather
     * than word for word.
     */
    dayPart?: RoughTime;
    /**
     * When this break airs and where the station is, for the half of the same question a stretch
     * cannot answer.
     *
     * {@link AnswerGuard.dayPart} carries the words and their window; this carries the INSTANT, which
     * is what {@link namesWrongTimeOfDay} needs to judge a word naming a point in the day rather than
     * a half of it — "midday" is `afternoon` at ten past twelve and `afternoon` at half past four,
     * and only one of those is a break worth airing. Both come off the same `airs_at`, in the same
     * place, so a break judged by one is judged by the other.
     *
     * Absent asks nothing, exactly as an absent `dayPart` does and for the same reason.
     */
    moment?: { at: number; zone: string };
    /**
     * The pads this break was offered, which are the only `[sfx:…]` runs its script may keep.
     *
     * The same list the prompt was built from, on {@link AnswerGuard.recent}'s bargain: the station
     * asks for something before it judges a script by it. Absent means none were offered, which
     * takes every pad hit out — the right answer for a character with no board, and for a kind of
     * break that does not allow one.
     */
    pads?: readonly string[];
    /**
     * Every year this break was actually given, and so the only ones it may say.
     *
     * {@link inventedFigure}'s doctrine carried across to the music path, and it arrives here rather
     * than in the weather writer because a DATE is the one claim about a record that a model will
     * fill in without any sense of having invented anything — exactly what that function says about
     * a plausible temperature. Build it with {@link permittedYears}, from the same records the
     * prompt was built from, so a script is refused only for a year it was never shown.
     *
     * Absent asks nothing, on {@link AnswerGuard.recent}'s bargain and every other field's here. An
     * EMPTY list is a different statement and is the one a factless break makes: the station was
     * given no year, so every year in the answer is one the model brought with it. That is the same
     * sentence `break.prompt.ts` already puts in the prompt — "the station knows nothing about X
     * beyond what is listed above" — read back off the answer instead of only asked for.
     */
    years?: readonly number[];
    /**
     * The reading this break was written from, and so the only figures it may say.
     *
     * {@link AnswerGuard.years}' twin, pointed at the substrate that taught it the doctrine: a
     * plausible temperature is easier for a model to write than a plausible anything else, because
     * it knows roughly what August in Atlanta is like and will say so if nothing stops it.
     *
     * It lives on the guard rather than in a writer, which it did not used to. `inventedFigure` ran
     * inside `ModelWeatherBreakWriter` after the answer had already been judged, and that was fine
     * for as long as one kind could be given a reading. The talk break being offered one made it two
     * callers, and two copies of "which numbers may this script say" is the shape `brokenClaim`'s own
     * note warns about — two readings of one question that could disagree. So the question is asked
     * here, once, in the order every other factual check is asked in, and both writers get the same
     * fault, the same sentence and the same row.
     *
     * Absent asks nothing, on every other field's bargain here — which is also what keeps this free
     * for the kinds that are never given a reading, since a break with no weather in front of it
     * cannot invent one from it.
     */
    weather?: SpokenWeather;
    /**
     * The only places this break may call here: the station's location, its parts and the station's
     * own name, normalised. Build it with `homeGuard`, from the same setting the prompt's `homeRule`
     * was built from.
     *
     * {@link AnswerGuard.years}' doctrine pointed at the dateline. A model shown a persona whose style
     * names a home town ("a Glaswegian night owl") says "here in Glasgow" on a station in Atlanta, in
     * the voice the station uses for where it really is. Absent asks nothing, on every other field's
     * bargain here; an EMPTY list is a station with no location, and then every claim of a here is one
     * the model brought with it, which is the same sentence the prompt already sent. See
     * `inventedHomeIn`.
     */
    homes?: readonly string[];
    /**
     * The station's name, which a script may say and may not say a line TO. Build it with
     * `stationGuard`, from the same setting the prompt names the station from. Absent asks nothing.
     * See `stationSignOffIn`.
     */
    station?: string;
    /**
     * The station's language when it is not English. Absent, every check reads the script as it
     * always has.
     *
     * Present, the checks built on English words stand down rather than refuse: the cue frames, the
     * three clock checks and spoken years would never fire on a German script, and saying so here is
     * what makes that a decision rather than an accident. The checks that WOULD fire on one, and
     * refuse good breaks for it, are loosened instead: a record named in the German genitive, a
     * marker inflected or elided, a date or a decimal comma read as an invented figure. See
     * `docs/internals/breaks.md` § "The station's language".
     */
    language?: string;
}

/**
 * A reading the model asked for, lifted off the front of its answer, and the answer without it.
 *
 * Done BEFORE anything reads the answer, and once, by the writer: {@link readAnswer},
 * {@link writeDecline} and {@link writeTrim} all tidy the text themselves, and the tidying strips any
 * bracketed run it does not recognise, so a mark left for them would be gone before the break was
 * judged and the three would be judging words the model did not quite write.
 *
 * Only the FIRST thing in the answer counts, after any reasoning the model put in front of it, and
 * only a word that was OFFERED. Anything else is left exactly where it is, for the tidying to strip:
 * a mark in the middle of a line, a misspelled one, or `[hushed]` in a kind of break whose shape
 * never offered it. That is the safety net the whole arrangement rests on, since the worst a stray
 * mark can do is be deleted, and never be read out.
 */
export function liftDelivery(text: string, offered: readonly SpeechDelivery[]): { text: string; delivery?: SpeechDelivery } {
    if (offered.length === 0) return { text };

    const answer = afterThinking(text);
    const mark = /^\s*\[([a-z]+)\]/i.exec(answer);
    const word = mark?.[1]?.toLowerCase();
    if (mark === null || word === undefined || !isSpeechDelivery(word) || !offered.includes(word)) return { text };

    return { text: answer.slice(mark[0].length).trimStart(), delivery: word };
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
    const tidied = tidyAnswer(text, guard);
    if (tidied === undefined) return undefined;

    // The ceiling, which CUTS at a sentence and declines only what cannot be cut at one. Everything
    // below judges what comes back from this rather than what the model sent, because the fitted
    // script is the one that airs and judging the other would be judging words nobody will hear.
    const script = fitToCeiling(tidied, guard);
    if (script === undefined) return undefined;

    // Every check below judges the WORDS, so a reaction comes out first and the cued script is what
    // is returned. It matters in three different ways and none of them is cosmetic: `runsLong`
    // splits on whitespace, so `[laugh]` would spend one of a break's forty words; `overusedWords`
    // counts the scripts a word appears in, so a station that laughs often would be told it has a
    // verbal tic; and `namedRecordIn` would be handed a token no record can ever match.
    // A pad comes out with them, and for all three of the same reasons: it would spend one of a
    // break's forty words, teach `overusedWords` that this station has a verbal tic called "sfx", and
    // hand `namedRecordIn` a token no record can match.
    const words = withoutPads(withoutCues(script));

    // A break about no record in particular. Checked BEFORE the character, because the two faults
    // want opposite things done about them and this one is the more basic: a script that named
    // nothing is wrong however well it is written, and reporting it as out-of-character would send
    // an operator to the persona page for a fault the prompt caused. See `namesNothing`.
    if (namesNothing(words, guard)) return undefined;

    // A break that named a record it was shown and then put it on the wrong side of itself: "that
    // was" about the record still to come. Checked here, in the same position `writeDecline` checks
    // it, because these two orders have to stay the same story — the note on `tidyAnswer` says why.
    // See `misCuedIn` for how narrowly it refuses.
    if (cuesWrongly(words, guard)) return undefined;

    // A break that named the record the wrong way round, "Black Sabbath by War Pigs". Straight after
    // the cue check and in the same position `writeDecline` asks it: both are about naming a record the
    // station really has, wrongly. See `swappedCreditIn`.
    if (swappedCredit(words, guard) !== undefined) return undefined;

    // A break that called the afternoon "tonight". Beside the cue check because it is the same kind
    // of wrongness — a statement about the moment that a listener can check against their own window
    // — and above the character check for the reason that one sits below the others: being out of
    // character is a question worth asking only about a script the station could otherwise say.
    if (wrongDayPartIn(words, guard) !== undefined) return undefined;

    // A break that dated a record to a year the station never held. Last of the factual checks and
    // in the same position `writeDecline` checks it, on the rule those two orders are kept by: they
    // are one story, and a script the one of them airs is a script the other has to be able to
    // refuse. See `inventedYearIn`.
    if (inventedYearIn(words, guard) !== undefined) return undefined;

    // And a break that stated a TEMPERATURE the station never held, which is the same doctrine on
    // the same rule: one story, one order, and a script this airs is one `writeDecline` has to be
    // able to refuse. See `inventedFigureIn`.
    if (inventedFigureIn(words, guard) !== undefined) return undefined;

    // And weather from a break that was given none, beside the figure check and in the same position
    // `writeDecline` asks it. See `unofferedWeatherIn`.
    if (unofferedWeatherIn(words, guard) !== undefined) return undefined;

    // And a break that called somewhere else here: the year's doctrine asked of the dateline, in the
    // same position `writeDecline` asks it. See `inventedHomeIn`.
    if (inventedHomeIn(words, guard) !== undefined) return undefined;

    // A break that read a line of a record's lyric aloud, which is somebody's copyrighted text and the
    // one thing the station must never say. After the factual checks and in the same position
    // `writeDecline` checks it, on the one-story rule. See `quotedLyricIn`.
    if (quotedLyricIn(words, guard) !== undefined) return undefined;

    // A line said TO the station, "Party on, Deadair!". After every factual check, because it is a
    // fault of voice rather than of fact, and before the character, because a sign-off that is
    // perfectly in character is still refused. Same position in `writeDecline`. See
    // `stationSignOffIn`.
    if (stationSignOffIn(words, guard) !== undefined) return undefined;

    // A correct sentence that is not this character speaking, which is the failure a persona is
    // asked for and the one a model handed a page of content rules actually makes — in flat plain
    // English, in a lifted sample line, in a signature the station used four records ago, or in
    // wording the sheet forbids. Declined rather than re-drafted: the floor underneath speaks in
    // the same character, so the station gets an in-character line at once instead of paying for a
    // second generation to maybe get one. The cued script goes too, because a sheet can forbid a cue
    // and `words` has none: `writeDecline` already judges the cued script, so the two agree.
    if (faultIn(words, guard, script) !== undefined) return undefined;

    return script;
}

/**
 * The tidying half of {@link readAnswer}: an answer as speakable words, or nothing.
 *
 * Split out so {@link writeDecline} can tell an answer that was empty from one that was too long
 * without re-running the checks in a different order and reporting something that did not happen.
 */
const tidyAnswer = (text: string, guard: AnswerGuard = {}): string | undefined =>
    speakableScript(text, {
        perform: PRESENTER_CUES,
        pads: guard.pads ?? [],
        ...(guard.language === undefined ? {} : { language: guard.language }),
        ...(guard.speakers === undefined ? {} : { speakers: guard.speakers }),
    });

/**
 * How much of a run-long script is worth keeping before it stops being one.
 *
 * A trim keeps the words in FRONT of the overrun, which is the whole argument for trimming at all:
 * the model made its point and then kept talking. Where the first sentence is most of the ceiling on
 * its own that reading no longer holds — what survives is an opening clause rather than a break, and
 * the floor's own phrasing says something whole instead. Half is a judgement rather than a
 * measurement; every trim this was built from kept between 86 and 91 words of a hundred.
 */
const MIN_KEPT_SHARE = 0.5;

/**
 * A tidied script cut to the guard's ceiling at a sentence boundary, or nothing.
 *
 * A cut rather than a refusal, which is a reversal and was measured rather than reasoned: of the six
 * answers this station has ever refused for length, every one made its point and then padded, and
 * every one of the tails thrown away was of the "make of that what you will" kind. So what the
 * ceiling used to discard was the good eighty words in front of the padding.
 *
 * The original argument survives in what this still refuses. Cutting a script MID-SENTENCE is worse
 * to air than the floor's correct line, so a single sentence that runs past the ceiling on its own is
 * declined exactly as before — `sentencesWithin` has no word-cut fallback for that reason — and so is
 * a trim so short it is no longer the break the model wrote. What is gone is only the claim that a
 * long answer means a misunderstood job.
 */
function fitToCeiling(script: string, guard: AnswerGuard): string | undefined {
    const ceiling = guard.maxWords ?? DEFAULT_MAX_WORDS;
    // The ordinary case, and it has to be answered before the share floor below: a break the model
    // kept to twelve words was never trimmed and must not be refused for being short.
    if (wordsIn(script) <= ceiling) return script;

    const fitted = sentencesWithin(script, ceiling);
    if (fitted === undefined) return undefined;

    // The front-keeping cut threw away the only sentence that named a record, which is the usual
    // shape of an outro: the model rambles about the last record and names the next one in its
    // closing line. Kept as it was, the trim is then refused as `named-nothing`, a fault the model
    // did not commit. So the naming sentence is kept and the cut moves in front of it instead.
    if (namesNothing(fitted, guard) && !namesNothing(script, guard)) {
        const kept = keepingTheName(script, ceiling, guard.names ?? [], guard.language);
        return kept === undefined || wordsIn(kept) < ceiling * MIN_KEPT_SHARE ? undefined : kept;
    }

    if (wordsIn(fitted) < ceiling * MIN_KEPT_SHARE) return undefined;

    // The same cut keeping the PREVIOUS record and losing the next, which `namesNothing` cannot see
    // because the back-announce still names something. Measured on an audition: seven of ten breaks
    // under a sheet that asks for the next record in the last sentence aired introducing nothing,
    // every one of them cut 10 to 64 words past an 80-word ceiling. Unlike the rescue above this one
    // is a preference rather than a necessity — the front cut is a whole, sayable break — so a hand-off
    // that cannot be kept leaves the front cut standing instead of refusing it.
    const next = droppedNext(fitted, script, guard);
    if (next === undefined) return fitted;

    const handedOff = keepingTheName(script, ceiling, [next], guard.language);
    return handedOff === undefined || wordsIn(handedOff) < ceiling * MIN_KEPT_SHARE ? fitted : handedOff;
}

/**
 * The record still to come, when a trim cut the only sentences that named it, or `undefined`.
 *
 * Asked only of a kind that has to name its records at all (a non-empty {@link AnswerGuard.names}),
 * since a welcome or a bulletin shown the next record is free not to introduce it and a cut that
 * moves its words round to make it would be the station editing for a rule it never gave.
 *
 * Two records by one artist share that name, so the artist alone would read as the next record named
 * by a script that only back-announced the last one. The title is what tells them apart then, on the
 * reasoning `misCuedIn` drops shared identifiers by.
 */
function droppedNext(fitted: string, script: string, guard: AnswerGuard): BreakTrack | undefined {
    const next = guard.cues?.next;
    if (next === undefined || (guard.names ?? []).every(record => record === undefined)) return undefined;

    const previous = guard.cues?.previous;
    const telling = previous !== undefined && bareWords(previous.artist) === bareWords(next.artist) ? { ...next, artist: '' } : next;
    const names = (text: string): boolean => namedRecordIn(text, [telling], guard.language) !== undefined;

    return !names(fitted) && names(script) ? telling : undefined;
}

/**
 * A run-long script cut to the ceiling with its first record-naming sentence kept, or nothing.
 *
 * Whole sentences are dropped from just in front of the naming one, walking back, until the rest
 * fits. The sentences nearest the name are the ones a model spends winding up to it ("this next
 * one, this riff"), so they read worst once the name has moved; the opening is where the break
 * found its subject and is kept longest. Everything after the naming sentence goes, as in the
 * ordinary trim.
 *
 * Nothing when even the opening sentence and the name together are over, which `writeDecline`
 * then reports as `ran-long` — the true reason, rather than a `named-nothing` the cut caused.
 */
function keepingTheName(script: string, ceiling: number, records: readonly (BreakTrack | undefined)[], language?: string): string | undefined {
    const sentences = sentencesOf(script);
    const naming = sentences.findIndex(sentence => namedRecordIn(sentence, records, language) !== undefined);
    if (naming < 0) return undefined;

    const name = sentences[naming] ?? '';
    for (let lead = naming; lead >= 0; lead--) {
        const candidate = [...sentences.slice(0, lead), name].join(' ');
        if (wordsIn(candidate) <= ceiling) return candidate;
    }
    return undefined;
}

/**
 * How long a script is, on the one definition the ceiling is counted in.
 *
 * A reaction is not a word. `[laugh]` is a whitespace-separated token and would otherwise spend one
 * of a break's forty, which is small until it is the one that tips a good script over the ceiling —
 * and a break refused for length it did not have is the exact failure the ceiling was measured to
 * avoid. Counted here rather than at each caller so the trim and the refusal cannot disagree.
 */
const wordsIn = (script: string): number => withoutCues(script).split(/\s+/).filter(Boolean).length;

/**
 * Whether a script was shown records and named none of them.
 *
 * A guard carrying no records asks nothing, which is what makes this safe to apply to every kind: a
 * welcome and a bulletin simply never populate {@link AnswerGuard.names}, and a link at the top of
 * an order with nothing either side of it populates it with nothing.
 */
const namesNothing = (script: string, guard: AnswerGuard): boolean => {
    const offered = (guard.names ?? []).filter(record => record !== undefined);
    return offered.length > 0 && namedRecordIn(script, offered, guard.language) === undefined;
};

/** Whether a script cued one of its records on the wrong side. See {@link misCuedIn}. */
const cuesWrongly = (script: string, guard: AnswerGuard): boolean =>
    // The frames `misCuedIn` reads are English phrases ("that was", "up next"), so outside English it
    // could only ever answer no. Standing down says that out loud.
    guard.language === undefined && guard.cues !== undefined && misCuedIn(script, guard.cues);

/**
 * The swapped credit a script used for one of the records it was shown. See {@link swappedCreditIn}.
 *
 * English only, for `cuesWrongly`'s reason: "by" is the English word, and outside English the check
 * could only ever answer no.
 */
const swappedCredit = (script: string, guard: AnswerGuard): string | undefined =>
    guard.language === undefined ? swappedCreditIn(script, guard.names ?? []) : undefined;

/**
 * Whether a script named a half of the day that cannot be the one it was told.
 *
 * A guard with no daypart asks nothing, exactly as {@link namesNothing} asks nothing of a break that
 * was shown no records — and the reason is the same bargain: the prompt has to have said so before
 * the script can be refused for contradicting it.
 *
 * The measurement behind refusing at all is in {@link contradictsDayPart}. The short version is that
 * the prompt asks and is obeyed most of the time, and the times it is not are all the same word.
 *
 * Three questions rather than one, because a daypart is a STRETCH and some words a break reaches for
 * name a point inside one — "midday" is the afternoon at ten past twelve and still the afternoon at
 * half past four, so no comparison of stretches will ever separate them. See
 * {@link namesWrongTimeOfDay}. The third is the sky, which names the time without naming a word for
 * it at all ("Night falls, my listeners" at a quarter to four). See {@link namesWrongSky}, which is
 * asked here and not of a production, for the reason given there. All three share this predicate,
 * and through it the `wrong-daypart` fault and its sentence, because they are the same thing to a
 * listener: the station saying what time it is and being wrong.
 *
 * ## It answers the WORD, and that is the whole of why it is not a boolean
 *
 * Both checks already know which word they caught, and this threw it away for as long as it returned
 * `true`. What that cost is a question nobody could answer from the record: `contradictsDayPart`
 * fires on one of four dayparts, and "which one, how often" is the difference between a sheet with
 * one habit and a model with a general problem. It answers the wording the SCRIPT used rather than
 * the table's, which is a second reason the word has to travel: since `DAYPART_CLAIMS`, "the
 * morning" and "good evening" are both things it can catch and neither is a phrase the table
 * carries. On the live station `conspiracy` sent a third of its breaks to the floor for
 * months with this fault among the leaders, and finding out which word did it meant reading raw
 * answers by hand, one at a time, only while `llm.captureWrites` happened to be on.
 *
 * The word reaches `script_history.reason` through {@link writeDecline}, so `scripts/break.declines.ts`
 * splits the fault by word with no change of its own: it groups on the reason string.
 */
const wrongDayPartIn = (script: string, guard: AnswerGuard): string | undefined => {
    // All three read English words for the time of day and the sky, so outside English they stand
    // down. The prompt still tells the model the part of the day; only the check on the answer goes.
    if (guard.language !== undefined) return undefined;

    const spoken = withoutRecordNames(script, guard);

    return (
        contradictsDayPart(spoken, guard.dayPart) ??
        namesWrongTimeOfDay(spoken, guard.moment?.at, guard.moment?.zone) ??
        namesWrongSky(spoken, guard.moment?.at, guard.moment?.zone)
    );
};

/**
 * A script with the names of the records it was shown taken out of it.
 *
 * ## A title is not a claim about the time
 *
 * Both clock checks read the script for words that say what time it is, and a record's name is full
 * of them: `Tonight, Tonight`, `(What's the Story) Morning Glory?`, `Midnight Rambler`, `In the
 * Evening`. A break that back-announces one of those has said nothing whatsoever about the moment,
 * and refusing it would cost the station the model's sentence for the crime of naming the record it
 * was given. This is not hypothetical for {@link namesWrongTimeOfDay}, which already matches
 * `midnight` as a bare word and so already refuses a midday break for back-announcing
 * `Midnight Train to Georgia`.
 *
 * So the names come out before either check reads the words. Taken from
 * {@link AnswerGuard.names} — the same records {@link namesNothing} asks about, through the same
 * {@link identifiersOf} — so what counts as naming a record is one answer and cannot drift into
 * being two.
 *
 * ## What it costs, and why that is the right direction
 *
 * A break that says the word as a title AND means it about the moment loses the second one too:
 * every `tonight` in a break that back-announced a record called `Tonight` looks identical. That is
 * a false NEGATIVE, and the file's whole bargain is that a break wrongly refused costs a sentence
 * the station wanted while a break wrongly passed costs one wrong word — with the floor underneath
 * being a correct sentence either way. The narrow miss is the survivable one.
 *
 * A guard carrying no records changes nothing, which keeps every kind that populates no names — a
 * welcome, a bulletin, a link at the top of an order — reading exactly the script it always did.
 *
 * ## The names come out and the punctuation stays
 *
 * Names are MATCHED as {@link bareWords}, because a curly apostrophe or a comma inside a title is not
 * a reason to miss it. They are CUT out of the lower-cased text itself, though, and not out of the
 * bare-words copy. The copy threw every stop away, and {@link namesWrongSky} needs the stops: it
 * looks for a sentence that OPENS on "Night falls", and with no stops left every word looks like
 * the middle of one sentence. `namesWrongTimeOfDay` needs them too, since it passes over a word
 * inside a comparison and a comparison ends at the next comma or stop. Both older checks read the
 * result exactly as they read the bare copy: `saysTime` lower-cases before its `includes`, `wholeWord`
 * bounds on letters, and the no-records path above always handed them the punctuated script anyway.
 */
export const withoutRecordNames = (script: string, guard: AnswerGuard): string => {
    const records = (guard.names ?? []).filter((record): record is BreakTrack => record !== undefined);
    if (records.length === 0) return script;

    // The script's words exactly as `bareWords` splits them (reactions and pads out first, then every
    // run of anything else turned into one space), each with where it sits in the text.
    const text = withoutPads(withoutCues(script))
        .toLowerCase()
        .replace(/[‘’ʼ′]/g, "'");
    const words = [...text.matchAll(/[\p{L}\p{N}']+/gu)];

    let spoken = text;
    for (const candidate of records.flatMap(identifiersOf)) {
        const parts = candidate.split(' ');

        // Every occurrence, not the first: a break may name the same record twice.
        for (let at = 0; at + parts.length <= words.length; at++) {
            const named = parts.every((part, index) => {
                const word = words[at + index]![0];
                // Both possessive endings on the last word, for the reason `saysName` carries them:
                // what is in the text after a presenter names a record is `iron maiden's`, and a plain
                // search for the band never finds it.
                return word === part || (index === parts.length - 1 && (word === `${part}'s` || word === `${part}'`));
            });
            if (!named) continue;

            // From the first word to the end of the last, so the comma inside `Tonight, Tonight` goes
            // with the title. Blanked rather than removed, so every offset above stays true.
            const from = words[at]!.index;
            const last = words[at + parts.length - 1]!;
            const until = last.index + last[0].length;
            spoken = spoken.slice(0, from) + ' '.repeat(until - from) + spoken.slice(until);
        }
    }

    // Back to single spacing, because `contradictsDayPart` looks for a PHRASE and a run of spaces
    // where a title used to be would hide `this morning` from it.
    return spoken.replace(/\s+/g, ' ').trim();
};

/**
 * A year written in digits, bounded to the range a record can plausibly carry.
 *
 * 1800 to 2099. The bound is what keeps this a check on DATES rather than on arithmetic: a break is
 * shown a length and a chart position and may say either, and `503` and `1,750,000` are numbers a
 * script is entitled to. Four digits in that range is the shape a year takes and almost nothing else
 * a presenter says does.
 */
const DIGIT_YEAR = /\b(1[89]\d{2}|20\d{2})\b/g;

/** The century a spoken year opens with. `two thousand` is handled on its own, below. */
const SPOKEN_CENTURY: Record<string, number> = { nineteen: 1900, twenty: 2000 };

const SPOKEN_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Ten to nineteen as the whole of a year's second half — "nineteen seventeen" — plus the units that
// follow a tens word and the `oh` that stands in for a zero decade. One table, because every one of
// them is a number word and the parser's rules are about POSITION rather than about which list a
// word came from.
const SPOKEN_UNITS: Record<string, number> = {
    oh: 0,
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
};

/**
 * The years a script says out loud, as the words a presenter actually uses.
 *
 * **This is the half {@link inventedFigure} deliberately does without, and the music path cannot.**
 * That function documents a spelled-out number getting through as an accepted gap, which is right
 * where the substrate is a temperature: nobody says "twenty-three degrees" as words in a forecast
 * this station writes. A year is the opposite — of the ungrounded dates this station has actually
 * aired, "formed in Hannover nineteen sixty-five", "born in Ho-Ho-Kus back in nineteen seventy-two"
 * and "launched in Los Angeles back in two thousand" are all words, and only "born in Brooklyn,
 * 1989" is digits. A digits-only check would have caught one of the four.
 *
 * ## What it will not read as a year, on purpose
 *
 * A century word with nothing that completes it. `twenty minutes`, `nineteen records` and a bare
 * `twenty` at the end of a sentence are not dates, and the parser requires the second half to be
 * there before it calls anything a year: a tens word (`nineteen sixty`), a ten-to-nineteen word
 * (`nineteen seventeen`), or an `oh` and a unit (`nineteen oh five`). `twenty two people` is
 * therefore not 2022, because a bare unit after a century completes nothing.
 *
 * A bare decade with no century — "back in seventy-two" — is a year to a listener and is not read as
 * one here. Catching it means reading every two-digit number word as a date, which refuses "forty
 * five seconds" and "the last twenty minutes" on a station whose breaks are full of both. That is
 * the same trade `withoutRecordNames` takes and in the same direction: a narrow miss is survivable
 * where a wrong refusal costs the station a sentence it wanted.
 */
function spokenYearsIn(words: readonly string[]): number[] {
    const found: number[] = [];

    for (let i = 0; i < words.length; i++) {
        // `two thousand` and everything hanging off it: the plain year, and the `and` a presenter
        // puts in the middle of "two thousand and four" but a model often leaves out.
        if (words[i] === 'two' && words[i + 1] === 'thousand') {
            const rest = words[i + 2] === 'and' ? i + 3 : i + 2;
            const tens = SPOKEN_TENS[words[rest] ?? ''];
            const unit = SPOKEN_UNITS[words[rest] ?? ''];

            if (tens !== undefined) found.push(2000 + tens + (SPOKEN_UNITS[words[rest + 1] ?? ''] ?? 0));
            else if (unit !== undefined) found.push(2000 + unit);
            else found.push(2000);
            continue;
        }

        const century = SPOKEN_CENTURY[words[i] ?? ''];
        if (century === undefined) continue;

        const next = words[i + 1] ?? '';
        const tens = SPOKEN_TENS[next];
        if (tens !== undefined) {
            found.push(century + tens + (SPOKEN_UNITS[words[i + 2] ?? ''] ?? 0));
            continue;
        }

        // `nineteen seventeen` and `nineteen oh five`. A unit below ten only counts behind an `oh`,
        // which is what keeps `twenty two` from being read as a year.
        const unit = SPOKEN_UNITS[next];
        if (unit !== undefined && unit >= 10) found.push(century + unit);
        else if (next === 'oh' || next === 'zero') found.push(century + (SPOKEN_UNITS[words[i + 2] ?? ''] ?? 0));
    }

    return found;
}

/** Every year a text states, in digits and in words, which is what both sides of the check read. */
export function yearsIn(text: string, language?: string): number[] {
    const digits = [...text.matchAll(DIGIT_YEAR)].map(match => Number(match[0]));
    // Spoken years are read in English ("nineteen eighty-four"), so outside English only the digits
    // are checked. A year spelled out in another language goes by unread.
    if (language !== undefined) return digits;

    const words = bareWords(text).toLowerCase().split(/\s+/).filter(Boolean);
    return [...digits, ...spokenYearsIn(words)];
}

/**
 * The years a break may say: every one the station put in front of it.
 *
 * The record's own three are each something the writer was handed — the year on the listing, any
 * year inside the album title beside it, and any year inside a fact the enrichment path supplied.
 * The album is permitted rather than stripped because {@link withoutRecordNames} takes the title and
 * the artist out of a script and not the album: `Blizzard Of Ozz (40th Anniversary Expanded Edition)`
 * is on the prompt, so a break may repeat it, and refusing that would be the station refusing its
 * own note.
 *
 * `now` is the moment the break airs and permits the year it airs IN, which is the one date a
 * presenter can state from the booth with no note in front of them.
 *
 * ## `shown` is the prompt itself, and leaving it out made this a trick question
 *
 * **A persona's own material carries dates, and the station asks for them.** Measured over the 748
 * aired talk breaks this station has written: without this argument the check refuses 23 of them,
 * and 5 are the `conspiracy` host telling his own seeded story, which opens "Nineteen ninety-seven.
 * I was driving home". The prompt prints that story, the sheet asks him to bring it up, and the
 * break said it — so refusing it is the station asking for something and then declining a script for
 * doing it, which is the one thing every guard in this file is built not to do. See
 * {@link AnswerGuard.recent}, which is on the same bargain for the same reason.
 *
 * Passing the whole rendered prompt rather than enumerating the fields it came from is deliberate.
 * A sheet grows fields — `background`, the stories, the preoccupations, and whatever is added next —
 * and a list here would be right until the day somebody adds one, which is how a rule in this file
 * becomes a lie. What the model was SHOWN is the thing the bargain is actually about, and the prompt
 * is that, exactly, with nothing to keep in step.
 *
 * The one path it widens is {@link AnswerGuard.recent}: `recent` is filled from EVERY writer's
 * scripts, including a kind with no year guard at all, so a year one of them invented is quoted back
 * into the next prompt's "You said these recently" block and would be permitted here on the strength
 * of having been shown it. The station is asking about a year IT put there. Callers close this by
 * stripping `recent` back out of the messages before they reach `shown`; see {@link shownWithoutRecent}.
 */
/**
 * The prompt's own messages, with every script named in `recent` taken back out of each one's text.
 *
 * Built for {@link permittedYears}'s `shown` argument, and only for that: `recent` is quoted verbatim
 * into the "You said these recently" block of the user turn (see {@link AnswerGuard.recent}), which
 * means it is IN the text `permittedYears` reads. Since `recent` is filled from every writer's
 * scripts (including a kind that carries no year guard of its own), an invented year sitting in one
 * of those quoted scripts would otherwise be permitted here on no more authority than having been
 * echoed back. `String.replaceAll` per script rather than a single pass, because a persona can have
 * repeated one: the block lists each script once, but a run of them share an opening the same way
 * `spentOpenings` measures.
 */
export function shownWithoutRecent(messages: readonly Pick<LlmMessage, 'content'>[], recent: readonly string[] = []): string[] {
    return messages.map(message => recent.reduce((text, script) => text.replaceAll(script, ''), message.content));
}

export function permittedYears(
    records: readonly (BreakTrack | undefined)[],
    now?: { at: number; zone: string },
    shown: readonly string[] = [],
): number[] {
    const years = new Set<number>();

    for (const record of records) {
        if (record === undefined) continue;
        if (record.year !== undefined) years.add(record.year);
        for (const year of yearsIn(record.album ?? '')) years.add(year);
        for (const fact of record.facts ?? []) for (const year of yearsIn(fact)) years.add(year);
        // A route link can name a shared record whose title is a year: saying it is no invented date.
        for (const year of yearsIn(record.link ?? '')) years.add(year);
    }

    for (const text of shown) for (const year of yearsIn(text)) years.add(year);

    if (now !== undefined) {
        const airs = Number(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: now.zone }).format(new Date(now.at)));
        if (Number.isFinite(airs)) years.add(airs);
    }

    return [...years];
}

/**
 * The year a script stated that it was never given, or `undefined` when every date in it is one.
 *
 * The record names come out first, through the same {@link withoutRecordNames} the clock checks use
 * and for the same reason one word along: `1979`, `1999` and `Miami Nights 1984` are a title, a title
 * and an artist, and a break that back-announces one has made no claim about a date at all. That
 * artist is not hypothetical — it is on this station, and it aired.
 *
 * The album's years are permitted rather than stripped, which is {@link permittedYears}' note.
 */
/**
 * What it does to the station's own output, which is the only measurement that settles a guard here.
 *
 * Replayed over the 748 aired model talk breaks in `script_history`, with each break's records, its
 * facts as the store holds them now, and its persona's sheet as {@link permittedYears}' `shown`: it
 * refuses 21, which is 2.8%. Every one is a date nothing in front of the model carried, and they are
 * the shapes this file has been describing in prose — "the Scorpions' anthem born from Hannover in
 * 1965", "a band that launched in Los Angeles back in two thousand", "The band born in Brooklyn,
 * 1989" — plus the two the same mechanism produces when the recall is wrong rather than right: "the
 * Chicago band from twenty-seventy" and "The band formed in Seattle in sixteen seventy-four".
 *
 * There were 23 before `shown` existed, and the two it gave back are the whole argument for it.
 */
/**
 * The figure a script stated that the reading never carried, or `undefined` when every one of them
 * was measured.
 *
 * The thinnest of wrappers over {@link inventedFigure}, and it earns its place by being the half
 * that knows about the GUARD: the function in `weather.figures.ts` is pure and takes a reading,
 * which is what lets both writers and the tests reach it without one, and this is where "was this
 * break given a reading at all" is answered. Same division as {@link inventedYearIn} one line up.
 *
 * The record names are already out of `script` by the time this is asked, which matters more here
 * than it does for a year: `Summer 68`, `1999` and `Nineteen85` are a title, a title and a producer,
 * and a break that back-announced one has said nothing about a temperature.
 */
const inventedFigureIn = (script: string, guard: AnswerGuard): string | undefined =>
    guard.weather === undefined
        ? undefined
        : inventedFigure(withoutShownFigures(withoutRecordNames(script, guard), guard), guard.weather, guard.language);

/**
 * The script with every figure a shown record carried taken out, its chart placing and its facts, so
 * a true claim about the record is not mistaken for a temperature.
 *
 * A chart show asks for "at number 43", and a talk break is OFFERED the weather, so the figure check
 * reads every break on that show. With the rank left in, it refused every model-written break of the
 * US countdown from 09:44 on 2026-10-23, all six aired from the floor, and the reason given each time
 * was the very rank the prompt had asked for. Any figure equal to one the placing carried is out, not
 * only one after "number": "43 on the chart" and "eleven weeks" are the same true claim.
 *
 * The facts are the same failure one field along. On 2026-10-28 the '80s show was refused twice for
 * "24" going into Let's Go Crazy, from a fact that said Purple Rain spent 24 weeks at number one,
 * and twice for "2" going into She Bop, from "released on July 2, 1984". Both aired from the floor.
 * Only whole figures are read out of a fact, which is all this function strips from a script.
 *
 * What it costs is an invented reading that happens to equal a rank or a fact's figure, which is the
 * narrow miss this file prefers.
 */
function withoutShownFigures(script: string, guard: AnswerGuard): string {
    const figures = new Set(
        (guard.names ?? []).flatMap(record => [
            ...(record?.chart === undefined ? [] : [record.chart.rank, record.chart.peak, record.chart.weeksOn].filter(value => value !== undefined)),
            ...(record?.facts ?? []).flatMap(fact => [...fact.matchAll(/(?<![\d.,])\d+(?![\d]|[.,]\d)/g)].map(match => Number(match[0]))),
        ]),
    );
    // A number standing on its own, so a rank of 9 never takes the hour out of "9:30" or a digit out of "9.5".
    return figures.size === 0 ? script : script.replace(/(?<![\d:.,])\d+(?![\d:]|[.,]\d)/g, digits => (figures.has(Number(digits)) ? ' ' : digits));
}

/**
 * The lyric line a script quotes {@link SUBJECT_ECHO_WORDS} words of in a row, or `undefined`.
 *
 * `runOf`'s rule, so a line shorter than the run is never matched whole: a title is often a line of
 * the lyric, and naming the record is the job. Judged with the record names taken out
 * ({@link withoutRecordNames}), because that rule only spares a title SHORTER than the run.
 * `Can't Get You out of My Head` is seven words and sits inside its own chorus, so a break that
 * back-announced it was refused for quoting a lyric when it had only said what the record was
 * called. A script that carries on past the title into the line still shares the rest of it, so
 * the quote this exists for is still caught.
 */
const quotedLyricIn = (script: string, guard: AnswerGuard): string | undefined =>
    guard.lyrics === undefined || guard.lyrics.length === 0 ? undefined : runOf(guard.lyrics, withoutRecordNames(script, guard), SUBJECT_ECHO_WORDS);

/**
 * The weather a break described when it was given no reading to describe, or `undefined`.
 *
 * The other half of {@link inventedFigureIn}: that one asks what a break did with the reading it was
 * handed, and has nothing to ask of a break handed none, which is every break but a weather break and
 * a talk break offered one. The prompt already tells those not to reach for the weather to set a
 * scene; this is where the station stops relying on the model having listened. Record names are out
 * of the script first, so "Sunny" is a title rather than a forecast.
 */
const unofferedWeatherIn = (script: string, guard: AnswerGuard): string | undefined =>
    guard.weather === undefined ? unofferedWeather(withoutRecordNames(script, guard), guard.language) : undefined;

/**
 * The claim a script made that somewhere is here when the station is not there, or `undefined`.
 *
 * Only the explicit shapes ("here in", "our city of", "broadcasting from"; see `homeClaimsIn`), so a
 * break naming a place it was handed (where a record was made, a dateline in the news, the town a
 * weather band points at) is never read as claiming it. The claim is found in the script as written,
 * because a capital is what tells "here in Glasgow" from "here in the studio", and then has to
 * survive {@link withoutRecordNames}: "here in Paris" inside a title is the record, not the presenter.
 *
 * English only, like `overusedWords`: the frames are English words, so outside English this stands
 * down as a decision rather than never firing by accident.
 */
const inventedHomeIn = (script: string, guard: AnswerGuard): string | undefined => {
    if (guard.homes === undefined || guard.language !== undefined) return undefined;

    const claim = claimedHomeIn(script, guard.homes);
    if (claim === undefined) return undefined;

    const spoken = withoutRecordNames(script, guard).toLowerCase().replace(/\s+/g, ' ');
    const said = claim.said
        .toLowerCase()
        .replace(/[‘’ʼ′]/g, "'")
        .replace(/\s+/g, ' ');
    return spoken.includes(said) ? claim.said : undefined;
};

/**
 * The sentence a script said TO the station, "Party on, Deadair!", or `undefined` when it said none.
 *
 * A catchphrase with somebody's name on the end ("Party on, Garth!") is the shape a model reaches
 * for when it wants a line to go out on, and the station's name is the one name every prompt hands
 * it. The result addresses the listener as the station, which no presenter does. Naming the station
 * is not the fault: "This is Deadair", "you're on Deadair" and "stay tuned to Deadair" are idents,
 * and they never put a comma in front of the name. So the check is the vocative and nothing wider:
 * a sentence that ENDS on the station's name with a comma before it.
 *
 * Measured on the live station on 2026-10-21, over the 2,322 model-written talk breaks in
 * `script_history`: 6 carried one ("Stay wired, Deadair.", "Cheers, Deadair!", "Happy listening,
 * Deadair."), and across every stored talk break, welcome, banter and changeover script of the
 * last thirty days the only comma-and-name endings were sign-offs of this kind. The two uses of the
 * name in apposition ("this station, Deadair, is bloody brilliant") do not end on it and pass.
 * The wider shape the prompt also discourages, "Stay laid back on Deadair.", is not refused,
 * because "Stay tuned to Deadair." is the same grammar and a real ident.
 *
 * Not English-only, unlike the frames around it: a comma and a name is the same vocative in every
 * language the station speaks.
 */
const stationSignOffIn = (script: string, guard: AnswerGuard): string | undefined => {
    const station = guard.station?.trim().toLowerCase();
    if (station === undefined || station === '') return undefined;

    return sentencesOf(script).find(sentence => {
        const bare = sentence
            .toLowerCase()
            .replace(/[\s.!?…"'”’)]+$/u, '')
            .replace(/\s+/g, ' ');
        return bare.endsWith(station) && /,\s*$/.test(bare.slice(0, -station.length));
    });
};

const inventedYearIn = (script: string, guard: AnswerGuard): string | undefined => {
    if (guard.years === undefined) return undefined;

    const permitted = new Set(guard.years);
    const spoken = withoutRecordNames(script, guard);

    // The DIGITS are reported as they were written and a spoken year as the number it parsed to,
    // because the two answer different questions for whoever reads the row: a digit year is the text
    // to search the capture for, and "nineteen sixty-five" is three tokens that were never adjacent
    // in the original. `scripts/break.declines.ts` groups on the reason, so both stay one fault.
    for (const year of yearsIn(spoken, guard.language)) if (!permitted.has(year)) return String(year);

    return undefined;
};

/**
 * Why a cleaned script is not the persona speaking, or `undefined` when it is.
 *
 * The same judgement {@link readAnswer} makes, exported so a writer can log WHICH of the four faults
 * it was without re-deriving it and drifting from what actually happened. A guard carrying no
 * persona answers `undefined`: a station that made no claim, rather than one that passed.
 *
 * `cued` is the same script with its cues still in, for a caller that judges the words without them:
 * a sheet can forbid a cue (`[sigh]`), and only the cued script can say one.
 */
export function faultIn(script: string, guard: AnswerGuard, cued?: string): CharacterFault | undefined {
    if (guard.persona === undefined) return undefined;

    return characterFault(guard.persona, script, {
        ...(cued === undefined ? {} : { cued }),
        ...(guard.recent === undefined ? {} : { recent: guard.recent }),
        ...(guard.told === undefined ? {} : { told: guard.told }),
        ...(guard.dialect === undefined ? {} : { dialect: guard.dialect }),
        ...(guard.language === undefined ? {} : { language: guard.language }),
        withoutRecordNames: withoutRecordNames(script, guard),
    });
}

/**
 * What an operator should go and change, per fault.
 *
 * A sentence per fault rather than one shared, because they are not variations on "the model missed": a spent
 * signature is the station working exactly as designed and wants nothing done about it, a quoted
 * sample is a sheet whose examples are too magnetic for the model in front of them, forbidden
 * wording is worth reading a capture for, and a flat plain-English line is markers or diction wanting
 * work. Only the last two are usually a fault of the sheet at all.
 */
const FAULT_REASONS: Record<WriteFault, string> = {
    'nothing-said': 'the model answered with nothing the station could say',
    'ran-long':
        'the model wrote past the word ceiling with nothing whole to keep short of it, and a script cut mid-sentence is worse than the phrasing underneath it',
    'named-nothing': 'the model wrote a break about neither of the records it was shown, so a listener could not tell what was playing',
    'cued-wrong': 'the model announced a record on the wrong side of the break, telling a listener something had played when it had not',
    'swapped-credit': 'the model credited a record to its own title, naming the artist as the song and the song as the artist',
    'wrong-daypart': 'the model called it the wrong half of the day, which a listener hears immediately and the station cannot take back',
    // Not "dated a RECORD", though that is almost always what happened: of the 21 aired breaks this
    // refuses, one is the paranormal host dating his own life to a year his sheet does not carry.
    // A fault sentence that named the record would send an operator to the listing for a break whose
    // fault was in the persona.
    'invented-year':
        'the model stated a year the station never gave it, which a listener cannot check and the station cannot tell from one it made up',
    // The weather's own version of the row above, and worth its own sentence for the reason that one
    // is: an operator reading "stated a year" goes to the listing, and an operator reading this goes
    // to the service. A figure nobody measured is also the one fault here a LISTENER can be harmed
    // by — a temperature said confidently is acted on.
    'invented-figure': 'the model gave a figure the station was never given, which sounds exactly like one the service measured',
    'quoted-lyric': 'the model quoted a run of a record’s lyrics, which the station never says on air',
    // Not folded into the row above: there the station had a reading and the model contradicted it,
    // here it had none and the model described the sky anyway, and the two send an operator to
    // different places (the service, against the prompt).
    'unoffered-weather': 'the model described the weather when it was given no reading, so whatever it said about the sky was made up',
    // Its own row rather than folded into `invented-year`: that one sends an operator to the listing,
    // and this one to the persona sheet or the station's own text, where a home town was planted.
    'invented-home':
        'the model called somewhere here that is not where the station is, which a listener there hears as the station not knowing its own town',
    'station-sign-off': 'the model said a line to the station by name, as though the station were the listener',
    'quoted-sample': 'the model read one of the persona’s own sample lines back rather than writing in its voice',
    'retold-verbatim': 'the model repeated what this character said the last time it picked up the same thread, rather than moving it on',
    'spent-catchphrase': 'the model reached for a signature the station had just used',
    'repeated-itself': 'the model said again, word for word, a long stretch of something the station said a few breaks ago',
    'avoided-wording': 'the model used wording the persona forbids',
    'mixed-subjects': 'the model took the persona onto two of the subjects its sheet keeps to one per break',
    'out-of-character': 'the model wrote a line the station could say, but not in its own voice',
    'character-trimmed': 'the model wrote in character but put the character past the word ceiling, so what would have aired carries none of it',
};

/**
 * Every way an answer can be refused: the four character faults, plus the ones that come first.
 *
 * `nothing-said` and `ran-long` are separated because they want opposite things done about them and
 * the row could not tell them apart: a 203-word bulletin was reported as the model having "nothing to
 * say here", which sent an operator looking at a persona sheet for a ceiling that was in the way of a
 * bulletin the prompt had asked for.
 *
 * `character-trimmed` is the same separation one step further down, and it was measured the same way.
 * Of 50 breaks `conspiracy` lost to `out-of-character` in three days, 5 had written the character and
 * put it past the ceiling — the first marker landing at word 50, 64, 75, 98 and 163 of answers
 * running 82 to 173 words, all of it cut before the check read them. Reported as `out-of-character`
 * those five send an operator to a persona sheet that is working, when what wants changing is a model
 * writing four times the length it was given.
 */
export type WriteFault =
    | CharacterFault
    | 'nothing-said'
    | 'ran-long'
    | 'named-nothing'
    | 'cued-wrong'
    | 'swapped-credit'
    | 'wrong-daypart'
    | 'invented-year'
    | 'invented-figure'
    | 'quoted-lyric'
    | 'unoffered-weather'
    | 'invented-home'
    | 'station-sign-off'
    | 'character-trimmed';

/** How {@link writeDecline} introduces the wording it caught, which {@link saidIn} reads back. */
const SAID = ': it said "';

/**
 * The wording a {@link writeDecline} reason caught, or `undefined` where it named none.
 *
 * Read back out of the sentence rather than carried beside it, for the reason `writeDecline` gives:
 * the sentence is what already reaches every writer's `WriteDetail.reason`, and a second field would
 * be threaded through all of them. The second ask is what wants it (`BreakRetry.said`), because a
 * model told "the wrong half of the day" and shown its own paragraph has to guess which word did it.
 * Kept beside the one place the suffix is written, so the two cannot drift apart.
 */
export function saidIn(reason: string): string | undefined {
    const at = reason.lastIndexOf(SAID);
    if (at < 0 || !reason.endsWith('"')) return undefined;

    const said = reason.slice(at + SAID.length, -1);
    return said.length === 0 ? undefined : said;
}

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
    // `said` names the wording that actually caused it, for the one fault whose sentence cannot be
    // acted on without it. The rest are already specific: a break that named no record, or ran long,
    // or read a sample back, tells an operator where to look on its own. "The wrong half of the day"
    // does not — the fix for a model reaching for `tonight` in the morning is not the fix for one
    // saying `teatime` at ten, and the row could not tell them apart.
    //
    // Appended to the sentence rather than carried beside it, because the sentence is the thing that
    // reaches BOTH destinations already: `script_history.reason` and, through the writers, the log
    // line's own message. A second field would have to be threaded through five writers to arrive
    // where this arrives for nothing. It splits the fault into one row per word in
    // `scripts/break.declines.ts`, which groups on the reason and is the report this is for.
    const reasoned = (fault: WriteFault, said?: string) => ({
        fault,
        reason: said === undefined ? FAULT_REASONS[fault] : `${FAULT_REASONS[fault]}${SAID}${said}"`,
    });

    const tidied = tidyAnswer(text, guard);
    if (tidied === undefined) return reasoned('nothing-said');

    // The same cut in the same position, and everything below reads what came back from it. A trim
    // is not a decline, so a script this shortens goes on to be judged like any other — which is the
    // half that keeps the two functions one story: `readAnswer` airs the fitted words, so those are
    // the words this has to be able to refuse.
    const speakable = fitToCeiling(tidied, guard);
    if (speakable === undefined) return reasoned('ran-long');

    if (namesNothing(speakable, guard)) return reasoned('named-nothing');
    // After naming and before character, which is where it belongs in the narrative this order is:
    // a break that named nothing has not got as far as cueing anything wrongly, and a break that
    // told the listener the wrong record played is not worth asking whether it did so in voice.
    if (cuesWrongly(speakable, guard)) return reasoned('cued-wrong');
    // With the phrase it said, so the second ask can be told exactly which words to turn round.
    const swapped = swappedCredit(speakable, guard);
    if (swapped !== undefined) return reasoned('swapped-credit', swapped);
    const daypart = wrongDayPartIn(speakable, guard);
    if (daypart !== undefined) return reasoned('wrong-daypart', daypart);
    // Last of the factual checks and still ahead of the character ones, on the order's own argument:
    // a break that told the listener the record was made in a year the station never heard of is not
    // worth asking whether it did so in voice. It sits after the daypart rather than before because
    // the clock checks read a script the record names have been taken out of, and this one wants the
    // same treatment for the same reason — a title full of digits is not a claim about a date.
    const year = inventedYearIn(speakable, guard);
    if (year !== undefined) return reasoned('invented-year', year);
    // Beside the year and immediately after it, because they are one doctrine asked of two
    // substrates: a number the station never gave the model, said in the voice it uses for the ones
    // it did. The reading is read against `speakable` for the year check's own reason — the record
    // names are already out of it, so a title full of digits is not a claim about the sky.
    const figure = inventedFigureIn(speakable, guard);
    if (figure !== undefined) return reasoned('invented-figure', figure);
    // Weather from a break handed no reading, immediately after the figure for the same reason the
    // figure follows the year.
    const sky = unofferedWeatherIn(speakable, guard);
    if (sky !== undefined) return reasoned('unoffered-weather', sky);
    // Somewhere else called here, after the sky and with the phrase that did it, for the year's reason:
    // an operator reading "called somewhere else here" wants to know where.
    const home = inventedHomeIn(speakable, guard);
    if (home !== undefined) return reasoned('invented-home', home);
    // Without the words that matched, unlike the two above: they are the lyric, and this sentence is
    // stored in `script_history.reason`, which is the second copy of the text the station must not keep.
    if (quotedLyricIn(speakable, guard) !== undefined) return reasoned('quoted-lyric');
    // With the sentence, so the second ask can be told which line to drop.
    const signOff = stationSignOffIn(speakable, guard);
    if (signOff !== undefined) return reasoned('station-sign-off', signOff);

    const fault = faultIn(speakable, guard);
    if (fault === undefined) return undefined;

    // The character was there and the CEILING took it. Asked only of a script the trim actually
    // shortened, and only when the untrimmed answer was clean on all four checks — so this claims the
    // trim did it only where the trim is the single thing that changed. Everything else stays
    // `out-of-character`, including an answer that was out of character before it was cut.
    //
    // It refuses either way. This is a change of what the ROW says, not of what airs: the words are
    // no more speakable for having been in character further down than the listener will ever hear.
    if (fault === 'out-of-character' && speakable !== tidied && faultIn(tidied, guard) === undefined) return reasoned('character-trimmed');

    // Named for the daypart's reason: "two subjects" does not say which two, and the pair is what an
    // operator reads a capture for.
    if (fault === 'mixed-subjects' && guard.persona !== undefined) {
        return reasoned(fault, subjectsVisited(guard.persona, withoutRecordNames(speakable, guard), guard.language).join('" and "'));
    }

    return reasoned(fault);
}

/**
 * What the station CUT off an answer it kept, or `undefined` when it kept the lot.
 *
 * The sibling of {@link writeDecline} and derived the same way — from the raw text, through the same
 * two steps, in the same order — because the alternative is a writer measuring the difference between
 * what it sent and what came back and reporting a number this file did not produce.
 *
 * It exists at all because a trim is an EDIT the station made to something a listener then heard, and
 * an edit nothing records is indistinguishable from a model that writes to length. `raw` answers this
 * too, but only while `llm.captureWrites` is on, which is an evening of prompt tuning rather than the
 * ordinary state. A decline is not a trim: this answers `undefined` for one, because that break never
 * aired and {@link writeDecline} has the whole story about it.
 */
export function writeTrim(text: string, guard: AnswerGuard): { kept: number; dropped: number; reason: string } | undefined {
    const tidied = tidyAnswer(text, guard);
    if (tidied === undefined) return undefined;

    const fitted = fitToCeiling(tidied, guard);
    if (fitted === undefined || fitted === tidied) return undefined;

    const kept = wordsIn(fitted);
    const dropped = wordsIn(tidied) - kept;

    // A fitted script that is not the answer's front was cut in front of its naming sentence instead.
    const where = tidied.startsWith(fitted) ? 'cut back to its last whole sentence' : 'cut to whole sentences that keep the one naming a record';
    return { kept, dropped, reason: `the model wrote ${dropped} words past the word ceiling, so the break was ${where}` };
}
