/**
 * Every metric the station records about itself, by name.
 *
 * One table so a producer and the route that reads it back cannot drift apart over a typo, which is
 * the reason `HEARTBEATS` exists. Dotted, with the unit last where there is one. Names received over
 * OTLP are whatever the sender called them and are not listed here.
 *
 * Labels are always from a small closed set (a queue, a plugin and its method, a kind of decision, a
 * model the operator configured). Every distinct label set is a row per minute, so an id or free text
 * in a label is the one mistake this table cannot afford.
 */
export const METRICS = {
    /** How many were listening, Icecast and HLS together. A gauge, sampled once a minute. */
    listeners: 'station.listeners',

    /** How long a job ran, by `queue`. One observation per run. */
    jobMs: 'work.job.ms',
    /** How long a plugin call held, by `plugin` and `op`. */
    pluginMs: 'work.plugin.ms',
    /** Work that failed, by `op` (`job.run`, `plugin.invoke`, `llm.generate`) and the decision `kind`. Counts. */
    failed: 'work.failed',

    /** How long a model call held, by the decision `kind` and the `model`. */
    modelMs: 'model.call.ms',
    /** Tokens a model read, by `kind` and `model`. A counter: read its sum. */
    modelInputTokens: 'model.tokens.input',
    /** Tokens a model wrote, by `kind` and `model`. */
    modelOutputTokens: 'model.tokens.output',
    /** Tokens a model spent reasoning, by `kind` and `model`, where it says. */
    modelReasoningTokens: 'model.tokens.reasoning',

    /** Records in the library. A gauge. */
    libraryTotal: 'library.tracks',
    /** Records whose audio is cached locally. A gauge. */
    libraryCached: 'library.cached',
    /** Records measured by the analysis sidecar. A gauge. */
    libraryMeasured: 'library.measured',
    /** Callers waiting for the model's single slot. A gauge. */
    modelWaiting: 'model.waiting',
    /** Bytes the station's own media takes on disk. A gauge, sampled every fifteen minutes. */
    diskBytes: 'storage.bytes',
} as const;

export type StationMetricName = (typeof METRICS)[keyof typeof METRICS];
