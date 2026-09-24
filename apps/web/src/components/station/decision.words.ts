import { i18n } from '../../i18n/i18n.setup';

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
const JOB_SENTENCES = {
    'catalog.sync': 'station:decision.job.catalogSync',
    'catalog.resolve_placeholders': 'station:decision.job.catalogResolvePlaceholders',
    'catalog.enrich': 'station:decision.job.catalogEnrich',
    'catalog.extract_facts': 'station:decision.job.catalogExtractFacts',
    'catalog.cache_art': 'station:decision.job.catalogCacheArt',
    'catalog.analyze': 'station:decision.job.catalogAnalyze',
    'playout.cache_track': 'station:decision.job.playoutCacheTrack',
    'playout.sweep_track_cache': 'station:decision.job.playoutSweepTrackCache',
    'director.extend_lineup': 'station:decision.job.directorExtendLineup',
    'director.replan_lineup': 'station:decision.job.directorReplanLineup',
    'director.write_break': 'station:decision.job.directorWriteBreak',
    'director.produce': 'station:decision.job.directorProduce',
    'render.stitch_production': 'station:decision.job.renderStitchProduction',
    'render.segment': 'station:decision.job.renderSegment',
    'render.prune_script_history': 'station:decision.job.renderPruneScriptHistory',
    'personas.distil_notes': 'station:decision.job.personasDistilNotes',
    'personas.write_stories': 'station:decision.job.personasWriteStories',
    'activity.prune_events': 'station:decision.job.activityPruneEvents',
    'schedule.tick': 'station:decision.job.scheduleTick',
    'scrobble.flush': 'station:decision.job.scrobbleFlush',
} as const;

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
    // Resolved on every call rather than once at import, so the sentence follows the language on
    // screen. `Object.hasOwn` rather than an index, because `kind` is free text and `constructor` is a
    // key every object literal answers.
    if (Object.hasOwn(JOB_SENTENCES, kind)) return { sentence: i18n.t(JOB_SENTENCES[kind as keyof typeof JOB_SENTENCES]), source: 'job' };

    if (HTTP_METHOD.test(kind)) return { sentence: i18n.t('station:decision.request', { kind }), source: 'request' };

    // A job this table has not caught up with. `kind` is a dotted queue name by the same convention
    // every entry above follows (`module.verb_noun`), so trading underscores for spaces gets most of
    // the way to a readable sentence without inventing a new one.
    return { sentence: kind.replace(/[._]/g, ' '), source: 'unknown' };
}
