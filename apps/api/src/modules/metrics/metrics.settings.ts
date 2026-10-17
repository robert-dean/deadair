/**
 * How long the station keeps its numbers.
 *
 * Two windows, because the table holds two resolutions and they answer different questions. Minute
 * rows are for "what happened this afternoon", and nobody zooms to the minute a month later; hour
 * rows are for "is the audience growing", which is only answerable over months. Keeping the minutes
 * for a year would cost sixty times the rows for a resolution no chart of a year can draw.
 *
 * Runtime knobs rather than constants, like `activity.retentionDays`: disk is the operator's
 * decision, and the table's size depends on how many series their plugins and queues produce.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { resolveRetentionDays } from '#modules/shared/retention.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

/** The `deadair.settings` keys. */
export const METRICS_KEYS = {
    minuteRetentionDays: 'metrics.minuteRetentionDays',
    hourRetentionDays: 'metrics.hourRetentionDays',
} as const;

export const METRICS_DEFAULTS = {
    /** A week of minutes: enough to compare this afternoon with the same one last week. */
    minuteRetentionDays: 7,
    /** Thirteen months of hours, so this month can be read against the same month last year. */
    hourRetentionDays: 400,
} as const;

/** The longest either window may be set to: ten years, which is "keep it" without saying zero. */
export const MAX_METRICS_RETENTION_DAYS = 3650;

/**
 * How many days of minute rows to keep, or `0` for all of them. Every uncertain reading keeps
 * everything, on `resolveRetentionDays`'s rule.
 */
export function resolveMinuteRetentionDays(config: AppConfig): number {
    return resolveRetentionDays(config, METRICS_KEYS.minuteRetentionDays, METRICS_DEFAULTS.minuteRetentionDays);
}

/** How many days of hour rows to keep, or `0` for all of them. */
export function resolveHourRetentionDays(config: AppConfig): number {
    return resolveRetentionDays(config, METRICS_KEYS.hourRetentionDays, METRICS_DEFAULTS.hourRetentionDays);
}

/**
 * Where the station sends its metrics over OTLP, if anywhere.
 *
 * Off until an endpoint is set: an install that never names a collector pays for nothing, and one
 * that does gets the same minute buckets it keeps for itself, sent on, not a second measurement.
 * The headers are a secret because they are usually a token (`Authorization=Bearer …`, a vendor's
 * API key), and are tied to the endpoint so a save that moves it elsewhere has to type them again.
 */
export const OTLP_KEYS = {
    endpoint: 'metrics.otlpEndpoint',
    headers: 'metrics.otlpHeaders',
    exportMetrics: 'metrics.otlpExportMetrics',
} as const;

export const OTLP_DEFAULTS = {
    endpoint: '',
    /** On, so naming an endpoint is all it takes. The switch is for sending traces without metrics. */
    exportMetrics: true,
} as const;

/** What the OTLP export reads, or nothing when it has nowhere to send. */
export interface OtlpSettings {
    /** The collector's base address, with no signal path: `http://collector:4318`. */
    endpoint: string;
    headers: Record<string, string>;
    exportMetrics: boolean;
}

/**
 * Read the OTLP settings, or `undefined` when no endpoint is set or the one set is not a URL.
 *
 * Headers are written the way `OTEL_EXPORTER_OTLP_HEADERS` is, `key=value,key=value`, since that is
 * what every collector's documentation hands an operator to paste. A pair without an `=` is skipped
 * rather than refusing the whole setting, on the resolver rule that a stored row which will not load
 * should cost one value and not the feature.
 *
 * @param decrypt - Turns the stored secret back into text. Tolerates plaintext, as mail's does.
 */
export function resolveOtlpSettings(config: AppConfig, decrypt: (raw: string) => string): OtlpSettings | undefined {
    const endpoint = String(config.get(OTLP_KEYS.endpoint, OTLP_DEFAULTS.endpoint)).trim().replace(/\/+$/, '');
    if (endpoint.length === 0) return undefined;
    try {
        const url = new URL(endpoint);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    } catch {
        return undefined;
    }

    const raw = String(config.get(OTLP_KEYS.headers, ''));
    let text = raw;
    if (raw.length > 0) {
        try {
            text = decrypt(raw);
        } catch {
            text = raw;
        }
    }

    const headers: Record<string, string> = {};
    for (const pair of text.split(',')) {
        const at = pair.indexOf('=');
        if (at <= 0) continue;
        const key = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        if (key.length > 0) headers[key] = safeDecode(value);
    }

    return { endpoint, headers, exportMetrics: settingIsOn(config, OTLP_KEYS.exportMetrics, OTLP_DEFAULTS.exportMetrics) };
}

/** OTLP header values may be percent-encoded, as the OTel spec allows. A malformed one is kept as typed. */
const safeDecode = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

/**
 * The URL for one signal under a base endpoint, as OTLP/HTTP defines it: `<base>/v1/<signal>`. A base
 * that already ends in that path is used as it is, so pasting a collector's full metrics URL works.
 */
export function otlpSignalUrl(endpoint: string, signal: 'metrics' | 'traces'): string {
    const path = `/v1/${signal}`;
    return endpoint.endsWith(path) ? endpoint : `${endpoint}${path}`;
}
