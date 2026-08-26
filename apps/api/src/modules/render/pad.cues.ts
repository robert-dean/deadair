/**
 * A pad hit, as it rides inside a script.
 *
 * `[sfx:airhorn]`, written where it happens, exactly as `[laugh]` is and for the same stated reason:
 * a sound happens at a PLACE in a sentence, and a field beside the text would have to invent a way
 * to say where.
 *
 * ## Why this is not in the plugin SDK, where `[laugh]` is
 *
 * `SPEECH_CUES` lives in `capabilities/speech.ts` because the speech PLUGIN has to know about it —
 * the engine performs a laugh, so the plugin declares which ones it can do and the host keeps only
 * those. Nothing analogous is true here. **No plugin ever sees a pad cue.** The host reads it, takes
 * it out of the words, fetches the file itself and asks the mixer to join some audio, and the mixer
 * is handed URLs rather than a script. Putting this in the SDK would publish a vocabulary to
 * everybody who cannot act on it.
 *
 * The plan for this feature said the SDK; that was wrong for the reason above, and this is the
 * correction.
 *
 * ## The shape is `withoutCues`' on purpose
 *
 * Two functions with the same signature and the same `keep`-is-what-to-LEAVE default, because the
 * three places that call both should not have to hold two different conventions in mind. The one
 * difference is the vocabulary: a cue is one of four fixed words and a pad name is whatever an
 * operator called a file, so the pattern here matches a SHAPE and the caller checks the name against
 * a board.
 */

/**
 * How many pads one script may hit.
 *
 * One, and it is the same number as `MAX_REACTIONS` for a different reason. A reaction is capped at
 * one because a presenter reacting continuously is a demo aesthetic rather than a person. A pad is
 * capped at one because a soundboard is funny once: the failure mode is not a character who
 * overacts, it is a character doing a bit. On a 28-word median break there is room for a sentence
 * and a sound, and nothing else.
 */
export const MAX_PADS = 1;

/**
 * A fresh matcher every call, because a `g` flag carries `lastIndex` between them.
 *
 * The name is deliberately narrow — lower-case letters, digits and hyphens — and it is the same
 * shape `padNameOf` produces from a filename. That is not a coincidence to be tidied away later:
 * what the model is offered has to be exactly what the library can be asked for, and a name that
 * could carry a space or a bracket is a name the answer parser has to be clever about.
 */
const padPattern = (): RegExp => /\[sfx:([a-z0-9-]+)\]/gi;

/** Every pad a script hits, in the order they happen, lower-cased, with repeats. */
export function padsIn(text: string): string[] {
    return [...text.matchAll(padPattern())].map(match => match[1]!.toLowerCase());
}

/**
 * The same text with pad hits removed, or with only some of them kept.
 *
 * `keep` is the set to LEAVE, so the default of none is "take them all out" — `withoutCues`'
 * convention, and the safe direction: this is what runs on the way to an engine that would otherwise
 * read the word "sfx" out loud.
 *
 * Only `[sfx:…]` is touched. Anything else in brackets is somebody else's problem and stays exactly
 * as it arrived; `speakableScript` is what decides the fate of a bare `[warmly]`.
 */
export function withoutPads(text: string, keep: Iterable<string> = []): string {
    const kept = new Set<string>([...keep].map(name => name.toLowerCase()));

    return text
        .replace(padPattern(), (match, name: string) => (kept.has(name.toLowerCase()) ? match : ' '))
        .replace(/[^\S\n]{2,}/g, ' ')
        .replace(/[^\S\n]+([.,!?;:])/g, '$1')
        .trim();
}

/** How a pad is written into a script, and into the sentence of the prompt that offers it. */
export const padCue = (name: string): string => `[sfx:${name.toLowerCase()}]`;

/**
 * A script with every pad hit past the ceiling taken out, and every name not on offer with it.
 *
 * The FIRST rather than the best, on `keepReactions`' argument: there is no way to rank them and the
 * earliest is the one the model committed to before it got carried away.
 *
 * A name the board does not hold is dropped rather than refused, which is the bargain every guard on
 * this path keeps — a refusal costs the station the model's sentence and hands the break to the
 * floor, and an invented pad name is a notation problem in an answer that is otherwise fine. The
 * words survive; the noise does not.
 */
export function keepPads(text: string, offered: Iterable<string>, ceiling: number = MAX_PADS): string {
    const allowed = new Set<string>([...offered].map(name => name.toLowerCase()));
    let seen = 0;

    return text
        .replace(padPattern(), (match, name: string) => {
            if (!allowed.has(name.toLowerCase())) return ' ';
            seen += 1;
            return seen <= ceiling ? match.toLowerCase() : ' ';
        })
        .replace(/[^\S\n]{2,}/g, ' ')
        .replace(/[^\S\n]+([.,!?;:])/g, '$1')
        .trim();
}

/** One piece of a script: words to speak, or a pad to play. */
export type ScriptPart = { kind: 'words'; text: string } | { kind: 'pad'; name: string };

/**
 * A script as the sequence the render path has to produce.
 *
 * This is the whole reason a pad cue rides INSIDE the text rather than beside it. Where the hit
 * happens is the difference between a presenter making a joke and landing it, and the only thing
 * that knows where it happens is the position of the marker in the sentence.
 *
 * Empty runs of words are dropped, so a script that opens or closes on a hit produces no empty take:
 * asking a speech engine for nothing is a request that either fails or returns a file of silence, and
 * both cost more than not asking.
 *
 * Note what this deliberately does not do. It does not check the names against a board, and it does
 * not enforce a ceiling — both happened at write time, and a script reaching the render path has
 * already been through them. Doing either again here would be a second opinion able to disagree with
 * the one the row was written under.
 */
export function splitOnPads(text: string): ScriptPart[] {
    const parts: ScriptPart[] = [];
    let at = 0;

    for (const match of text.matchAll(padPattern())) {
        const words = text.slice(at, match.index).trim();
        if (words.length > 0) parts.push({ kind: 'words', text: words });
        parts.push({ kind: 'pad', name: match[1]!.toLowerCase() });
        at = match.index + match[0].length;
    }

    const rest = text.slice(at).trim();
    if (rest.length > 0) parts.push({ kind: 'words', text: rest });

    return parts;
}
