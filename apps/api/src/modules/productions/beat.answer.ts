/**
 * Asking the model for one beat until it answers, or until it is clear it will not.
 *
 * Two things can come back that are not a script, and they are not the same thing. An EMPTY answer
 * is the model having spent its allowance on reasoning rather than words: a bad roll, asked again
 * once, and written off after that. A PREEMPTED answer is not the model's at all — a break wanted
 * the model and this is the binding that is supposed to lose (`LlmService.runConversation` answers
 * one with no text and `finishReason: 'preempted'` rather than throwing). For a long time the
 * drafting loop read only the text, so a beat cut off by an on-air break counted as "came back
 * empty", a second break during the retry failed the whole programme, every beat already written
 * was thrown away, and the log blamed the model. A `background` production sits hours from its
 * slot on a station that breaks every few records, so this was the ordinary way one died.
 *
 * So a preemption is not an attempt: it is not recorded as one, does not count against the empty
 * allowance, and is asked again — the next ask waits on the gate, which is what the wait was for.
 * It is still bounded, because a station that is never quiet would otherwise hold the job forever,
 * and the reason it stops for is named so nobody goes looking for a model fault that is not there.
 */

/** How many times an EMPTY beat is asked again before the production is written off. */
export const EMPTY_BEAT_RETRIES = 1;

/** How many times a PREEMPTED beat is asked again before the production is written off. */
export const PREEMPTED_BEAT_RETRIES = 3;

/** The one thing this reads off an answer, besides the text the caller turns into a script. */
export interface BeatAnswer {
    finishReason: string;
}

/** One ask that came back with words to judge, and what was made of them. */
export interface BeatAttempt<A extends BeatAnswer> {
    answer: A;
    /** The speakable script read out of `answer`, possibly empty. */
    script: string;
}

export interface BeatOutcome<A extends BeatAnswer> {
    /** The script to keep, or empty when {@link reason} says why there is none. */
    script: string;
    /** Every ask that produced an answer, in order. Preempted asks are not attempts and are not here. */
    asked: BeatAttempt<A>[];
    /** How many asks a break took the model back from. */
    preempted: number;
    /** Why there is no script, when there is none. */
    reason?: 'empty' | 'preempted';
}

export interface BeatAskHooks {
    /** Called before each re-ask that follows an empty answer, with how many have been empty so far. */
    onEmpty?: (empties: number) => void;
    /** Called before each re-ask that follows a preemption, with how many there have been so far. */
    onPreempted?: (preemptions: number) => void;
}

export async function askForBeat<A extends BeatAnswer>(
    ask: () => Promise<A>,
    read: (answer: A) => string,
    hooks: BeatAskHooks = {},
    limits: { emptyRetries?: number; preemptedRetries?: number } = {},
): Promise<BeatOutcome<A>> {
    const emptyRetries = limits.emptyRetries ?? EMPTY_BEAT_RETRIES;
    const preemptedRetries = limits.preemptedRetries ?? PREEMPTED_BEAT_RETRIES;
    const asked: BeatAttempt<A>[] = [];
    let preempted = 0;
    let empties = 0;

    for (;;) {
        const answer = await ask();

        if (answer.finishReason === 'preempted') {
            preempted += 1;
            if (preempted > preemptedRetries) return { script: '', asked, preempted, reason: 'preempted' };
            hooks.onPreempted?.(preempted);
            continue;
        }

        const script = read(answer);
        asked.push({ answer, script });
        if (script.length > 0) return { script, asked, preempted };

        empties += 1;
        if (empties > emptyRetries) return { script: '', asked, preempted, reason: 'empty' };
        hooks.onEmpty?.(empties);
    }
}
