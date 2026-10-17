// The ingest route writes other services' numbers into the station's own table, so what is pinned is
// the gate (nothing until an operator turns it on, and then a 404 rather than a 403 while it is off),
// the answer OTLP senders read (partial success with a count, never a retry-inducing error for points
// dropped on purpose), and that the cap holds across requests because the receiver outlives them.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { OTLP_RECEIVE_KEYS, resolveOtlpMaxSeriesPerName } from '../../../src/modules/metrics/metrics.settings.js';
import { OtlpIngest } from '../../../src/modules/metrics/otlp.ingest.js';
import { OtlpReceiveService } from '../../../src/modules/metrics/otlp.receive.service.js';

const config = (values: Record<string, string>): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) }) as unknown as AppConfig;

const at = `${Date.UTC(2026, 9, 17, 12)}000000`;
const gauge = (name: string, value: number, labels: Record<string, string> = {}) => ({
    name,
    gauge: {
        dataPoints: [
            { timeUnixNano: at, asDouble: value, attributes: Object.entries(labels).map(([key, v]) => ({ key, value: { stringValue: v } })) },
        ],
    },
});
const body = (...metrics: unknown[]) => ({
    resourceMetrics: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'ytaudio' } }] }, scopeMetrics: [{ metrics }] }],
});

function harness(values: Record<string, string> = { [OTLP_RECEIVE_KEYS.receive]: 'true' }, ingest = new OtlpIngest()) {
    const metrics = { upsertMinutes: vi.fn(async () => 1) };
    return { service: new OtlpReceiveService(config(values), ingest, metrics as never), metrics };
}

describe('OtlpReceiveService', () => {
    it('answers 404 until receiving is switched on, and writes nothing', async () => {
        const { service, metrics } = harness({ [OTLP_RECEIVE_KEYS.receive]: 'false' });

        await expect(service.receive(body(gauge('queue.depth', 1)))).rejects.toMatchObject({ statusCode: 404 });
        expect(metrics.upsertMinutes).not.toHaveBeenCalled();
    });

    it('writes what it reads as received rows, labelled with the sender, and answers with nothing to report', async () => {
        const { service, metrics } = harness();

        expect(await service.receive(body(gauge('queue.depth', 4)))).toEqual({});
        expect(metrics.upsertMinutes).toHaveBeenCalledWith(
            [expect.objectContaining({ name: 'queue.depth', labels: { 'service.name': 'ytaudio' } })],
            'otlp',
        );
    });

    it('answers a partial success naming what it did not take, rather than an error a sender would retry', async () => {
        const { service } = harness({ [OTLP_RECEIVE_KEYS.receive]: 'true', [OTLP_RECEIVE_KEYS.maxSeriesPerName]: '1' });

        const answer = await service.receive(
            body(gauge('m', 1, { id: 'a' }), gauge('m', 1, { id: 'b' }), { name: 'x', summary: { dataPoints: [{}] } }),
        );

        expect(answer.partialSuccess?.rejectedDataPoints).toBe('2');
        expect(answer.partialSuccess?.errorMessage).toContain("1 over the station's series limit");
    });

    it('refuses a body that is not a metrics export with a 400', async () => {
        const { service } = harness();

        await expect(service.receive({ resourceMetrics: 'nope' } as never)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('holds the cap across requests, because the receiver outlives them', async () => {
        const ingest = new OtlpIngest();
        const values = { [OTLP_RECEIVE_KEYS.receive]: 'true', [OTLP_RECEIVE_KEYS.maxSeriesPerName]: '1' };

        await harness(values, ingest).service.receive(body(gauge('m', 1, { id: 'a' })));
        const second = await harness(values, ingest).service.receive(body(gauge('m', 1, { id: 'b' })));

        expect(second.partialSuccess?.rejectedDataPoints).toBe('1');
    });
});

describe('resolveOtlpMaxSeriesPerName', () => {
    it('clamps a stored figure into its range, and takes the default for one nobody can read', () => {
        expect(resolveOtlpMaxSeriesPerName(config({}))).toBe(50);
        expect(resolveOtlpMaxSeriesPerName(config({ [OTLP_RECEIVE_KEYS.maxSeriesPerName]: '0' }))).toBe(1);
        expect(resolveOtlpMaxSeriesPerName(config({ [OTLP_RECEIVE_KEYS.maxSeriesPerName]: '99999' }))).toBe(1000);
        expect(resolveOtlpMaxSeriesPerName(config({ [OTLP_RECEIVE_KEYS.maxSeriesPerName]: 'lots' }))).toBe(50);
    });
});
