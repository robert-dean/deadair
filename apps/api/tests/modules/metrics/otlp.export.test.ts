// The OTLP export is a second destination for the minute the station has just written for itself, so
// what is pinned is the switch (nothing at all until an endpoint is set), the reading of a pasted
// collector address and its headers, what kind each metric goes out as, and that a collector being
// down is logged at its edges and never thrown.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import { aggregateOf, labelsKey, type MetricBucket } from '@maroonedsoftware/telemetry';
import { DateTime } from 'luxon';

import { OTLP_KEYS, otlpSignalUrl, resolveOtlpSettings } from '../../../src/modules/metrics/metrics.settings.js';
import { metricKind, OtlpExport } from '../../../src/modules/metrics/otlp.export.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const config = (values: Record<string, string>): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) }) as unknown as AppConfig;
const plain = (raw: string) => raw;

describe('resolveOtlpSettings', () => {
    it('is off with no endpoint, a blank one, or one that is not an http address', () => {
        expect(resolveOtlpSettings(config({}), plain)).toBeUndefined();
        expect(resolveOtlpSettings(config({ [OTLP_KEYS.endpoint]: '  ' }), plain)).toBeUndefined();
        expect(resolveOtlpSettings(config({ [OTLP_KEYS.endpoint]: 'collector:4318' }), plain)).toBeUndefined();
        expect(resolveOtlpSettings(config({ [OTLP_KEYS.endpoint]: 'ftp://collector' }), plain)).toBeUndefined();
    });

    it('reads headers the way OTEL_EXPORTER_OTLP_HEADERS writes them, decrypted, skipping a pair it cannot read', () => {
        const settings = resolveOtlpSettings(config({ [OTLP_KEYS.endpoint]: 'http://collector:4318/', [OTLP_KEYS.headers]: 'sealed' }), raw =>
            raw === 'sealed' ? 'Authorization=Bearer%20abc, x-scope = team ,nonsense' : raw,
        );

        expect(settings).toEqual({
            endpoint: 'http://collector:4318',
            headers: { Authorization: 'Bearer abc', 'x-scope': 'team' },
            exportMetrics: true,
        });
    });

    it('keeps a header typed in plain text when it cannot be decrypted', () => {
        const settings = resolveOtlpSettings(config({ [OTLP_KEYS.endpoint]: 'http://c', [OTLP_KEYS.headers]: 'k=v' }), () => {
            throw new Error('not ciphertext');
        });

        expect(settings?.headers).toEqual({ k: 'v' });
    });

    it('reads the metrics switch as a setting string, so "false" turns it off', () => {
        expect(resolveOtlpSettings(config({ [OTLP_KEYS.endpoint]: 'http://c', [OTLP_KEYS.exportMetrics]: 'false' }), plain)?.exportMetrics).toBe(
            false,
        );
    });
});

describe('otlpSignalUrl', () => {
    it('adds the signal path to a base address, and leaves a full one alone', () => {
        expect(otlpSignalUrl('http://c:4318', 'metrics')).toBe('http://c:4318/v1/metrics');
        expect(otlpSignalUrl('https://otlp.example/v1/metrics', 'metrics')).toBe('https://otlp.example/v1/metrics');
    });
});

describe('metricKind', () => {
    it('sends durations as histograms, tokens and failures as counters, and the rest as gauges', () => {
        expect(metricKind('work.job.ms')).toBe('histogram');
        expect(metricKind('model.tokens.input')).toBe('counter');
        expect(metricKind('work.failed')).toBe('counter');
        expect(metricKind('station.listeners')).toBe('gauge');
        expect(metricKind('library.cached')).toBe('gauge');
    });
});

describe('OtlpExport', () => {
    const bucket = (): MetricBucket => ({
        name: 'station.listeners',
        labels: {},
        labelsKey: labelsKey({}),
        start: DateTime.utc(2026, 10, 17, 12),
        aggregate: aggregateOf(3),
    });
    const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
    const container = (decrypt: (raw: string) => string = raw => raw) =>
        ({ createScopedContainer: () => ({ get: () => ({ decrypt }), disposeAsync: async () => {} }) }) as never;

    it('decrypts the stored headers in a scope of its own, and only again when they change', async () => {
        const decrypt = vi.fn((raw: string) => raw.replace('sealed:', ''));
        const values: Record<string, string> = { [OTLP_KEYS.endpoint]: 'http://c', [OTLP_KEYS.headers]: 'sealed:k=v' };
        const otlp = new OtlpExport(container(decrypt), config(values), new StationIdentity(), logger() as never);

        expect((await otlp.settings())?.headers).toEqual({ k: 'v' });
        expect((await otlp.settings())?.headers).toEqual({ k: 'v' });
        values[OTLP_KEYS.headers] = 'sealed:k=w';
        expect((await otlp.settings())?.headers).toEqual({ k: 'w' });
        expect(decrypt).toHaveBeenCalledTimes(2);
    });

    it('sends nothing, and builds no exporter, while no endpoint is set', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch');
        const otlp = new OtlpExport(container(), config({}), new StationIdentity(), logger() as never);

        await otlp.exportMetrics([bucket()]);

        expect(fetch).not.toHaveBeenCalled();
        fetch.mockRestore();
    });

    it('logs an unreachable collector once, by its address and never its headers, and does not throw', async () => {
        const log = logger();
        const otlp = new OtlpExport(
            container(),
            config({ [OTLP_KEYS.endpoint]: 'http://127.0.0.1:9', [OTLP_KEYS.headers]: 'Authorization=Bearer secret-token' }),
            new StationIdentity(),
            log as never,
        );

        await expect(otlp.exportMetrics([bucket()])).resolves.toBeUndefined();
        await expect(otlp.exportMetrics([bucket()])).resolves.toBeUndefined();
        await otlp.close();

        expect(log.warn).toHaveBeenCalledTimes(1);
        expect(log.warn.mock.calls[0]?.[0]).toContain('http://127.0.0.1:9');
        expect(log.warn.mock.calls[0]?.[0]).not.toContain('secret-token');
    }, 30_000);
});
