/**
 * A decision's `kind` in the words the station's own registry gives it, rather than the queue name
 * it is stored under.
 *
 * `TraceDecision.kind` is deliberately free text — `job.mappings.ts`'s registered name for a job, or
 * `${method} ${path}` for the console's own page loads, minted before routing has even matched a
 * path (`authorization.context.middleware.ts`). Nothing about the shape says which is which, so the
 * table on Check-up's "What it cost" tab rendered `schedule.tick` and `GET /voices` in one column
 * with the same weight — a decision the station made sitting beside a page the console asked for,
 * indistinguishable until read closely.
 *
 * This is a translation, not a classification. Every job name that exists is listed here, by hand,
 * against `job.mappings.ts` — there is no way to derive the sentence from the key, because the
 * sentence is the whole point: it is what an operator would call the thing, not what the queue does.
 * A kind not in this table is either an HTTP method-and-path (matched structurally) or a job added
 * since this file was last updated, and both fall through to a sentence built from the raw string
 * rather than a blank cell.
 */
const JOB_SENTENCES: Record<string, string> = {
    'catalog.sync': 'Asked a music source what it still has',
    'catalog.resolve_placeholders': 'Matched a placeholder record to a real one',
    'catalog.enrich': 'Asked what the providers know about a record',
    'catalog.extract_facts': 'Read an article for facts to talk about',
    'catalog.cache_art': 'Fetched cover art',
    'catalog.analyze': 'Measured a record',
    'playout.cache_track': "Fetched a record's audio",
    'playout.sweep_track_cache': 'Threw away cached audio over the cap',
    'director.extend_lineup': 'Topped up the running order',
    'director.replan_lineup': 'Threw the running order away and planned it again',
    'director.write_break': 'Wrote what a host says',
    'director.produce': 'Drafted a production',
    'render.stitch_production': 'Joined a production into one file',
    'render.segment': 'Turned a break into audio',
    'render.prune_script_history': 'Forgot old scripts',
    'personas.distil_notes': "Read a persona's recent scripts into notes",
    'personas.write_stories': "Wrote a persona's own stories",
    'activity.prune_events': 'Forgot old activity',
    'schedule.tick': 'Checked whether the schedule changed',
    'scrobble.flush': 'Reported what aired to a scrobble service',
};

/** A method-and-path minted before routing matched anything — the console's own page loads. */
const HTTP_METHOD = /^(GET|POST|PUT|PATCH|DELETE) /;

/**
 * The sentence a decision's raw `kind` is worth, and where that sentence came from.
 *
 * `sentence` is always populated — an unrecognised job name gets one built from its own string
 * rather than nothing, because a blank cell reads as a bug rather than as "this console does not
 * have a nicer word for it yet". `source` is what a caller uses to decide whether to show the raw
 * `kind` at all: an HTTP request already reads fine as `GET /voices`, so repeating it under a
 * translated label would be the same fact twice.
 */
export interface DecisionReading {
    sentence: string;
    source: 'job' | 'request' | 'unknown';
}

export function describeDecision(kind: string): DecisionReading {
    const known = JOB_SENTENCES[kind];
    if (known !== undefined) return { sentence: known, source: 'job' };

    if (HTTP_METHOD.test(kind)) return { sentence: `Request · ${kind}`, source: 'request' };

    // A job this table has not caught up with. `kind` is a dotted queue name by the same convention
    // every entry above follows (`module.verb_noun`), so trading underscores for spaces gets most of
    // the way to a readable sentence without inventing a new one.
    return { sentence: kind.replace(/[._]/g, ' '), source: 'unknown' };
}
