/**
 * Every metric the station records about itself, by name.
 *
 * One table so a producer and the route that reads it back cannot drift apart over a typo, which is
 * the reason `HEARTBEATS` exists. Dotted, with the unit last where there is one. Names received over
 * OTLP are whatever the sender called them and are not listed here.
 */
export const METRICS = {
    /** How many were listening, Icecast and HLS together. A gauge, sampled once a minute. */
    listeners: 'station.listeners',
} as const;

export type StationMetricName = (typeof METRICS)[keyof typeof METRICS];
