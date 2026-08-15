import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { LlmMessage } from '@deadair/plugin-sdk';
import { errorText } from '#modules/shared/error.text.js';

/**
 * Everything a model was shown and everything it said, on disk, while an operator is tuning.
 *
 * ## Why this is a file and not a log line
 *
 * It was a log line first, and one live run killed that: `RotatingLogStore` truncates every meta
 * value at `LOG_MAX_VALUE_CHARS` (512) and every line at `LOG_MAX_LINE_BYTES` (8k), so a transcript
 * carrying three searches' worth of results arrived as the first two rules of the system prompt and
 * an ellipsis. Those limits are RIGHT — they are what keeps one wild field from flooding a log an
 * operator has to read — so the answer is not to raise them for everybody, it is to put a thing
 * that is measured in tens of kilobytes somewhere that expects them.
 *
 * ## Why it is not a database table either
 *
 * A break's prompt and raw answer are columns on `script_history` because a break IS a row: it has
 * a segment, a writer and a lifetime. A set is not. Its picks become a running order and the
 * conversation that produced them is not part of what the station keeps, so a table would be a
 * schema carrying a debugging session.
 *
 * ## What bounds it
 *
 * `llm.captureWrites` is off by default and is meant for an evening rather than for a station, but
 * "meant for" is not a bound: an operator who leaves it on and goes to bed would otherwise wake to
 * a directory with a refill's transcript in it every quarter hour, forever. So each write prunes to
 * the newest {@link MAX_CAPTURES}, which is the same shape `RotatingLogStore` uses on itself.
 *
 * Nothing here may cost the caller its work. Every failure is swallowed with a line, because this
 * is a debugging aid and a station that stopped programming because it could not write a
 * transcript would be a far worse bug than the one it exists to diagnose.
 */

/** How many captures to keep. A few evenings of refills, and a few megabytes at most. */
export const MAX_CAPTURES = 50;

/** Where they go, under the same root the logs use. Sibling of the per-plugin log directories. */
const CAPTURES_DIR = 'captures';

/** One conversation worth keeping, as the file records it. */
export interface LlmCapture {
    /** What was being asked for: `set`, and whatever else grows one. Leads the filename. */
    kind: string;
    /** Anything the reader needs to know that is not in the conversation: counts, brief, model. */
    context: Record<string, unknown>;
    /** Everything the model was shown, in order. */
    transcript: readonly LlmMessage[];
    /** What it said back, whole and unparsed. */
    answer: string;
}

/**
 * Write one capture, and say where it went.
 *
 * @returns the file's path, for the caller's own log line, or `undefined` when nothing was
 *   written. The pointer is the point: the log stays short and greppable and says where the long
 *   thing is, which is the arrangement that failed when the long thing WAS the log line.
 */
export async function writeCapture(config: AppConfig, logger: Logger, capture: LlmCapture, at: number): Promise<string | undefined> {
    const dir = join(String(config.get('LOGS_DIR', './logs')), CAPTURES_DIR);
    // Sortable, second-resolution, and filename-safe: the prune below orders by name, so the name
    // has to sort the way time does.
    const stamp = new Date(at).toISOString().replace(/[:.]/g, '-');
    const path = join(dir, `${capture.kind}-${stamp}.json`);

    try {
        await mkdir(dir, { recursive: true });
        await writeFile(path, JSON.stringify({ at: new Date(at).toISOString(), ...capture }, undefined, 2), 'utf8');
        await prune(dir);
        return path;
    } catch (error) {
        logger.warn(`llm: could not write what the model was shown (${errorText(error)})`);
        return undefined;
    }
}

/** Drop all but the newest {@link MAX_CAPTURES}. Failures are the caller's to swallow. */
async function prune(dir: string): Promise<void> {
    const files = (await readdir(dir)).filter(name => name.endsWith('.json')).sort();
    if (files.length <= MAX_CAPTURES) return;

    for (const name of files.slice(0, files.length - MAX_CAPTURES)) {
        await rm(join(dir, name), { force: true });
    }
}
