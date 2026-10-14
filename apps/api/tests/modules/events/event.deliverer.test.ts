// One event to one destination. What matters: a delivery is an EVENT, so only its last attempt counts
// toward switching a destination off; an event past its moment is dropped, and counts as a failure
// only if an attempt at it had already failed; a state event older than one already delivered is
// dropped without sending; and the twentieth failure in a row turns the destination off once, with
// one line on the activity feed.

import { DateTime } from 'luxon';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { describe, expect, it, vi } from 'vitest';

import {
    DELIVER_RETRY_LIMIT,
    DeliveryRetry,
    EventDeliverer,
    FAILURES_BEFORE_DISABLE,
    type DeliverPayload,
} from '../../../src/modules/events/event.deliverer.js';
import { EventDestinationsRepository, type EventDestinationRow } from '../../../src/modules/events/event.destinations.repository.js';
import type { WebhookDelivery } from '../../../src/modules/events/webhook.sender.js';

const NOW = DateTime.fromISO('2026-10-14T20:00:30Z').toMillis();

const destination = (overrides: Partial<EventDestinationRow> = {}): EventDestinationRow => ({
    id: 'dest-1',
    name: 'Hall light',
    url: 'http://192.168.1.20:8123/api/webhook/hall',
    secretSealed: 'sealed(secret)',
    enabled: true,
    events: [],
    consecutiveFailures: 0,
    createdAt: DateTime.fromISO('2026-10-14T10:00:00Z'),
    updatedAt: DateTime.fromISO('2026-10-14T10:00:00Z'),
    ...overrides,
});

const payload = (overrides: Partial<DeliverPayload> = {}): DeliverPayload => ({
    destinationId: 'dest-1',
    envelope: { id: 'evt-1', type: 'track.started', occurredAt: '2026-10-14T20:00:00.000Z', station: { key: 'main', name: 'Dead Air' }, data: {} },
    notAfter: NOW + 60_000,
    state: true,
    ...overrides,
});

const delivered: WebhookDelivery = { outcome: 'delivered', httpStatus: 204, durationMs: 9 };
const busy: WebhookDelivery = { outcome: 'failed', retryable: true, httpStatus: 503, durationMs: 9, error: 'Answered 503.' };
const gone: WebhookDelivery = { outcome: 'failed', retryable: false, httpStatus: 404, durationMs: 9, error: 'Answered 404.' };

function build(options: { row?: EventDestinationRow | undefined; attempts?: number; result?: WebhookDelivery; failuresAfter?: number } = {}) {
    const row = 'row' in options ? options.row : destination();
    const repository = {
        get: vi.fn(async () => row),
        attemptsAt: vi.fn(async () => options.attempts ?? 0),
        recordDelivery: vi.fn(async () => undefined),
        markDelivered: vi.fn(async () => undefined),
        markFailed: vi.fn(async () =>
            row === undefined ? undefined : { consecutiveFailures: options.failuresAfter ?? 1, enabled: row.enabled, name: row.name },
        ),
        disableFailing: vi.fn(async () => true),
    };
    const encryption = { decrypt: (sealed: string) => sealed.slice(7, -1) };
    const scope = {
        get: (token: unknown) => (token === EventDestinationsRepository ? repository : token === EncryptionProvider ? encryption : undefined),
        disposeAsync: async () => undefined,
    };
    const container = { createScopedContainer: () => scope };
    const sender = { send: vi.fn(async () => options.result ?? delivered) };
    const activity = { record: vi.fn(async () => undefined) };
    const deliverer = new EventDeliverer(container as never, sender as never, activity as never, { warn: vi.fn() } as never);
    return { deliverer, repository, sender, activity };
}

describe('EventDeliverer', () => {
    it('sends with the unsealed secret, logs it, and moves the state mark forward', async () => {
        const { deliverer, repository, sender } = build();

        expect(await deliverer.deliver(payload(), undefined, NOW)).toBe('delivered');
        expect(sender.send).toHaveBeenCalledWith(
            { url: 'http://192.168.1.20:8123/api/webhook/hall', secret: 'secret' },
            payload().envelope,
            undefined,
        );
        expect(repository.recordDelivery).toHaveBeenCalledWith({
            destinationId: 'dest-1',
            eventId: 'evt-1',
            eventType: 'track.started',
            attempt: 1,
            outcome: 'delivered',
            httpStatus: 204,
            durationMs: 9,
        });
        expect(repository.markDelivered).toHaveBeenCalledWith('dest-1', '2026-10-14T20:00:00.000Z');
    });

    it.each([
        ['deleted', undefined],
        ['turned off', destination({ enabled: false })],
        ['not asking for this type', destination({ events: ['talk.started'] })],
    ])('skips a destination that is %s, writing nothing', async (_, row) => {
        const { deliverer, repository, sender } = build({ row });

        expect(await deliverer.deliver(payload(), undefined, NOW)).toBe('skipped');
        expect(sender.send).not.toHaveBeenCalled();
        expect(repository.recordDelivery).not.toHaveBeenCalled();
    });

    it('hands an attempt that may yet arrive back to the broker, without counting a failure', async () => {
        const { deliverer, repository } = build({ result: busy, attempts: DELIVER_RETRY_LIMIT - 1 });

        await expect(deliverer.deliver(payload(), undefined, NOW)).rejects.toBeInstanceOf(DeliveryRetry);
        expect(repository.recordDelivery).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed', attempt: DELIVER_RETRY_LIMIT }));
        expect(repository.markFailed).not.toHaveBeenCalled();
    });

    it('counts the failure on the last attempt', async () => {
        const { deliverer, repository } = build({ result: busy, attempts: DELIVER_RETRY_LIMIT });

        expect(await deliverer.deliver(payload(), undefined, NOW)).toBe('failed');
        expect(repository.markFailed).toHaveBeenCalledWith('dest-1', 'Answered 503.');
    });

    it('counts a refusal not worth repeating at once', async () => {
        const { deliverer, repository } = build({ result: gone });

        expect(await deliverer.deliver(payload(), undefined, NOW)).toBe('failed');
        expect(repository.markFailed).toHaveBeenCalledOnce();
    });

    it('drops an event past its moment, counting a failure only if an attempt at it had failed', async () => {
        const late = payload({ notAfter: NOW - 1 });

        const first = build();
        expect(await first.deliverer.deliver(late, undefined, NOW)).toBe('dropped');
        expect(first.sender.send).not.toHaveBeenCalled();
        expect(first.repository.markFailed).not.toHaveBeenCalled();

        const retried = build({ attempts: 2 });
        expect(await retried.deliverer.deliver(late, undefined, NOW)).toBe('dropped');
        expect(retried.repository.markFailed).toHaveBeenCalledOnce();
    });

    it('drops a state event older than one already delivered, and sends one that is not a state event', async () => {
        const row = destination({ lastStateAt: DateTime.fromISO('2026-10-14T20:00:10Z') });

        const stale = build({ row });
        expect(await stale.deliverer.deliver(payload(), undefined, NOW)).toBe('dropped');
        expect(stale.sender.send).not.toHaveBeenCalled();

        const notState = build({ row });
        expect(await notState.deliverer.deliver(payload({ state: false }), undefined, NOW)).toBe('delivered');
        expect(notState.repository.markDelivered).toHaveBeenCalledWith('dest-1', undefined);
    });

    it(`turns the destination off at the ${FAILURES_BEFORE_DISABLE}th failure in a row, and says so on the feed`, async () => {
        const { deliverer, repository, activity } = build({ result: gone, failuresAfter: FAILURES_BEFORE_DISABLE });

        await deliverer.deliver(payload(), undefined, NOW);

        expect(repository.disableFailing).toHaveBeenCalledWith('dest-1');
        expect(activity.record).toHaveBeenCalledWith(
            expect.objectContaining({ module: 'events', kind: 'destination.disabled', severity: 'warn', data: { destinationId: 'dest-1' } }),
        );
    });

    it('leaves it on below the line', async () => {
        const { deliverer, repository, activity } = build({ result: gone, failuresAfter: FAILURES_BEFORE_DISABLE - 1 });

        await deliverer.deliver(payload(), undefined, NOW);

        expect(repository.disableFailing).not.toHaveBeenCalled();
        expect(activity.record).not.toHaveBeenCalled();
    });
});
