/**
 * The second ask: which refusals are worth putting back to the model, and what to say to it.
 *
 * ## Why there is a second ask at all, when the tree said there was not
 *
 * `readAnswer` declines rather than re-drafting, and the note on it says why: "the floor underneath
 * speaks in the same character, so the station gets an in-character line at once instead of paying
 * for a second generation to maybe get one". That rests on the floor being an equal substitute, and
 * it stopped being one. Measured on the live station over two days: a quarter of every talk break
 * written went to the floor (videoage 20%, wisecrack 27%, conspiracy 24%), and a persona's floor is
 * six phrasings, so a character whose model keeps being refused starts repeating inside one hour.
 *
 * The other half of that argument was cost, and the numbers are against it there too. A break is
 * written MINUTES before it airs (`break.claims.ts`), the planner pays for the words about fifteen
 * minutes ahead, and a generation on this station takes about five seconds. There is room for one
 * more.
 *
 * ## Only the faults the model can act on, which is the whole of the rule
 *
 * Of 67 refusals in those two days, 39 were mechanical: a rule the model was given and broke, where
 * the fix is to say which one. The rest were about the SUBSTRATE — a break about neither record, a
 * record announced on the wrong side — and those are not retried, deliberately. A model that wrote
 * about neither of the records it was shown has misunderstood what it was handed, and asking again
 * invites it to invent something that fits; the floor is the right answer to that and always was.
 *
 * `ran-long` is mechanical and is also not here, because the trim already answers it: a script past
 * the ceiling is cut to its last whole sentence and aired, so there is nothing to ask for.
 *
 * **One retry, never two.** The registry passes {@link BreakRetry} on the second ask and refuses to
 * build a third, so a model that fails the same way twice reaches the floor exactly as it does now,
 * one generation later.
 *
 * ## It cannot make the station late, and that is a property rather than a hope
 *
 * The second ask goes through the same `patienceFor(request.airsAt)` as the first, which is the room
 * left before the break is due minus a reserve. A retry with minutes in hand waits like any other
 * generation; a retry with nothing in hand is given zero, the gate turns it down, and the floor
 * writes the break — which is exactly what would have happened without the second ask, one refusal
 * later. Nothing here needs to know how long the first attempt took.
 */

import type { WriteFault } from './break.prompt.js';

/**
 * What the second ask carries: what was refused, and why.
 *
 * `refused` is the answer itself, and it is sent back to the model rather than described. A model
 * told "that did not sound like you" and shown nothing rewrites from the prompt and lands in the
 * same place; shown its own sentence, it edits.
 */
export interface BreakRetry {
    fault: WriteFault;
    /** The sentence `writeDecline` produced, which for some faults names the wording that caused it. */
    reason: string;
    /** What the model actually said, where it said anything at all. */
    refused?: string;
}

/**
 * The faults a second ask can fix.
 *
 * Every one is a rule the prompt already stated and the answer already broke, so the nudge is a
 * reminder rather than new information. Nothing here is about what the model was TOLD about the
 * records, which is the line this set is drawn on.
 */
export const RETRYABLE_FAULTS: ReadonlySet<WriteFault> = new Set<WriteFault>([
    'out-of-character',
    'character-trimmed',
    'avoided-wording',
    'spent-catchphrase',
    'quoted-sample',
    'retold-verbatim',
    'wrong-daypart',
    'nothing-said',
]);

/** Whether a refusal is worth putting back to the model. */
export const worthRetrying = (fault: WriteFault | undefined): boolean => fault !== undefined && RETRYABLE_FAULTS.has(fault);

/**
 * What to say on the second ask, per fault.
 *
 * Each names the rule and asks for the SAME break again, because a model told only what it did
 * wrong writes a different break: the records move, the aside goes, and the second answer is
 * refused for something new. "Say it again, fixing this" is the instruction that keeps the two
 * answers the same shape.
 *
 * They do not restate the sheet. Everything these reference is already in the system prompt, and
 * this file's own measurement is that a word put in front of a model comes back out of it — see the
 * note on `not the worst` in `persona.defaults.ts`, where naming a phrase four times made it half
 * the character's output.
 */
const NUDGES: Record<string, string> = {
    'out-of-character':
        'That did not sound like you. Say the same break again in your own voice, working at least one of your own words into a sentence rather than adding it on the end.',
    'character-trimmed':
        'That was you, but it ran past the length you have, so what would have aired carried none of it. Say the same break again, shorter, with the part that sounds like you at the front.',
    'avoided-wording': 'That used wording you do not use. Say the same break again without it.',
    'spent-catchphrase': 'That reached for a signature this station has just used. Say the same break again, with a different one or none at all.',
    'quoted-sample':
        'That read one of your own example lines back. Those show the grammar, never the sentence. Say the same break again in words you have not been given.',
    'retold-verbatim':
        'That said again what you said the last time you came back to this. Coming back to it only works if it has moved. Say the same break again, taking it somewhere it has not been.',
    'wrong-daypart':
        'That named the wrong part of the day. Say the same break again, fitting the time you were told, or saying nothing about the time at all.',
    'nothing-said': 'That answered with nothing the station could read aloud. Write the break.',
};

/**
 * The second ask as one user turn, or nothing where the fault has no nudge.
 *
 * The refused answer is quoted back under a label rather than pasted bare, so a model that reads it
 * as the next thing to continue has something to disagree with instead.
 */
export function retryNudge(retry: BreakRetry): string | undefined {
    const nudge = NUDGES[retry.fault];
    if (nudge === undefined) return undefined;

    const refused = retry.refused?.trim() ?? '';
    return refused.length === 0 ? nudge : `${nudge}\n\nWhat you said, which the station refused:\n"${refused}"`;
}
