import { classify, describe, type Failure } from '../station/connection.failure.js';

/** What a key says about a command, in the log, beyond the tick or the warning triangle on the key itself. */
export type Log = (sentence: string) => void;

/**
 * Runs a command a key was pressed for, and shows how it went on that key.
 *
 * A tick for done, the warning triangle for anything else, and the reason in the log: a key has no
 * room for the sentence, and the operator who wants it opens the log from the Stream Deck app.
 * `words` lets a command say what a failure means for IT, which a generic sentence cannot (a 409 on
 * Start is "nothing to resume").
 */
export async function runCommand(
    face: { showOk(): Promise<void>; showAlert(): Promise<void> } | undefined,
    command: () => Promise<unknown>,
    log: Log,
    words: Partial<Record<Failure, string>> = {},
): Promise<boolean> {
    try {
        await command();
        await face?.showOk().catch(() => undefined);
        return true;
    } catch (error) {
        const failure = classify(error);
        log(words[failure] ?? describe(failure).sentence);
        await face?.showAlert().catch(() => undefined);
        return false;
    }
}
