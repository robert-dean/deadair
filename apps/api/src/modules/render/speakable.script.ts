/**
 * A model's answer as words an engine may actually be handed.
 *
 * Everything here exists because the speech engine reads what it is GIVEN. A stage direction is not
 * a note to the performer, it is a word in the audio: `*yikes*` is read as an asterisk and "(laughs)"
 * is read as the word "laughs", and neither can be taken back once it has gone out.
 *
 * ## It was the break path's, and a production never had it
 *
 * This is `readAnswer`'s tidying half, lifted out. `WriteBreakJob` has run it on every break since
 * the failure that put it there; `ProduceProductionJob` takes `answer.text.trim()` and stores it,
 * which is why the first live call-in aired an album title wrapped in asterisks. One function, two
 * callers, and the thing it protects is the same in both.
 *
 * ## Which cues survive is the CALLER's question, not this file's
 *
 * A performance cue rides inside the text as `[laugh]`, so the strip below has to spare the ones the
 * writer was actually offered — and only those. That set is a permission (the host has four, a
 * caller in a production has more) and it is passed in rather than read from {@link SPEECH_CUES},
 * because reaching for the whole vocabulary here is precisely how a presenter starts coughing on a
 * station that widened the list for somebody else.
 */

import { SPEECH_CUES, type SpeechCue } from '@deadair/plugin-sdk';
import { keepPads, MAX_PADS } from './pad.cues.js';

/**
 * How many performance cues one script may carry.
 *
 * One, and the number is the point rather than a starting position. The engine's own sample scripts
 * put one in front of nearly every sentence, which is a demo aesthetic: on this station's 28-word
 * median break it would be a presenter performing continuously instead of talking. One is a person
 * reacting once; two is a bit. A 70-word caller turn does not change that arithmetic.
 */
export const MAX_REACTIONS = 1;

/** What a script may keep, and how much of it. */
export interface SpeakableOptions {
    /**
     * The cues this writer was offered, which are the only bracketed runs that survive.
     *
     * Required rather than defaulted to the whole vocabulary: a default here would silently permit
     * every future addition to {@link SPEECH_CUES} in every script on the station.
     */
    perform: readonly SpeechCue[];
    /** How many of them to keep. Defaults to {@link MAX_REACTIONS}. */
    maxReactions?: number;
    /** How many pad hits to keep. Defaults to {@link MAX_PADS}. */
    maxPads?: number;
    /**
     * The pads this writer was offered, by name, which are the only `[sfx:…]` runs that survive.
     *
     * Required in the same sense `perform` is and defaulted to none rather than to the whole rack:
     * a script that keeps a pad the writer was never offered is a break that reaches the render path
     * asking for a sound this character does not have.
     *
     * A pad SURVIVES this pass where a reaction is merely spared it, and the difference matters. A
     * reaction goes to the engine, which performs it. A pad goes no further than the stored script —
     * `transposeForSpeech` takes it out on the way to the engine, and the render job reads it off the
     * row to decide what to join. So this is what puts the hit on the record of what was written.
     */
    pads?: readonly string[];
}

/**
 * One answer as speakable words, or nothing when there is nothing left of it.
 *
 * Split from the checks that judge an answer so a caller can tell an answer that was EMPTY from one
 * that was refused, without re-running the checks in a different order and reporting something that
 * did not happen.
 */
export function speakableScript(text: string, options: SpeakableOptions): string | undefined {
    const kept = new Set<string>(options.perform.map(cue => cue.toLowerCase()));
    const ceiling = options.maxReactions ?? MAX_REACTIONS;
    const pads = options.pads ?? [];
    let script = text.trim();

    // A reasoning model that was told not to think out loud and did anyway. Take what follows the
    // last one rather than dropping the answer: the words after it are usually the actual script.
    script = script.replace(/^[\s\S]*<\/think>/i, '').trim();

    // Anything before a speaker label on the first line: "DJ:", "Host:", "Announcer:".
    script = script.replace(/^\s*[A-Z][A-Za-z ]{0,20}:\s*(?=[A-Z"'“])/, '');

    // Stage directions, wherever they are: [warmly], (laughs), *sighs*.
    //
    // A cue this writer was offered is spared by name, and it is a CARVE-OUT of this rule rather
    // than a relaxation of it: `[warmly]` still goes, because the failure that put this line here
    // was a model's stage direction being read out loud, and only a cue with an engine behind it is
    // anything else. Everything past the first is dropped too — see {@link MAX_REACTIONS} for why
    // one, and note that it is a TRIM rather than a refusal, on `overusedWords`' argument: the words
    // are fine and only the notation is excessive, so declining would cost the station the model's
    // sentence over punctuation.
    //
    // A pad hit is spared on exactly the same terms and for the same reason — `[sfx:airhorn]` has a
    // FILE behind it where `[warmly]` has nothing — so it has to be decided BEFORE this strip rather
    // than after it. The strip drops every bracketed run it does not recognise, so a pad admitted
    // afterwards would be admitted into a script the strip had already emptied of pads.
    script = keepPads(keepReactions(script, kept, ceiling), pads, options.maxPads ?? MAX_PADS)
        .replace(/\[[^\]]*\]/g, match => (isReaction(match, kept) || isPad(match) ? match.toLowerCase() : ' '))
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

/**
 * Whether a bracketed run is a pad hit that {@link keepPads} has already approved.
 *
 * A shape test rather than a name test, and that is safe only because of the ordering above: by the
 * time the strip runs, every `[sfx:…]` still in the script is one `keepPads` checked against the
 * board and counted against the ceiling. Anything it refused is already gone.
 */
const isPad = (bracketed: string): boolean => /^\[sfx:[a-z0-9-]+\]$/i.test(bracketed);

/** Whether a bracketed run is one this writer was offered, however it was capitalised. */
const isReaction = (bracketed: string, kept: ReadonlySet<string>): boolean => kept.has(bracketed.slice(1, -1).trim().toLowerCase());

/**
 * The same script with every reaction past the ceiling taken out.
 *
 * The FIRST rather than the best, because there is no way to rank them and the earliest is the one
 * the model committed to before it got carried away. Kept as a separate pass ahead of the strip so
 * the two rules stay legible: this one is about how many, that one is about which.
 */
function keepReactions(script: string, kept: ReadonlySet<string>, ceiling: number): string {
    let seen = 0;

    return script.replace(/\[[^\]]*\]/g, match => {
        if (!isReaction(match, kept)) return match;
        seen += 1;
        return seen <= ceiling ? match : ' ';
    });
}

/** Drop a pair of marks that wraps the entire text, and only then. */
export function stripWrapping(text: string, open: string, close: string): string {
    if (!text.startsWith(open) || !text.endsWith(close) || text.length < 2) return text;

    const inner = text.slice(open.length, -close.length);
    return inner.includes(close) && !inner.endsWith(close) ? text : inner.trim();
}
