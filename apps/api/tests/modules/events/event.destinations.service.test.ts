// The operator's side of event destinations. What matters: the secret is shown in the clear only when
// it is minted and is stored sealed, an address the sender would refuse is refused at the door rather
// than at the first delivery, a test is sent whether or not the destination is on and lands in the
// same log as real traffic, and a missing destination is a 404 everywhere.

import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';

import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import { DESTINATION_TEST } from '../../../src/modules/events/event.catalogue.js';
import { EventDestinationsService } from '../../../src/modules/events/event.destinations.service.js';
import type { EventDestinationRow, NewEventDelivery } from '../../../src/modules/events/event.destinations.repository.js';
import type { WebhookDelivery, WebhookTarget } from '../../../src/modules/events/webhook.sender.js';
import type { EventEnvelope } from '../../../src/modules/events/event.envelope.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const operator = new AuthorizationContext(
    { kind: 'user', sessionToken: 's', actorId: 'op-1', platformRoles: new Set(['admin']), factors: [] },
    { clientAddress: '198.51.100.7' },
);

/** Sealing that is visibly not the clear text, and reversible. */
const encryption = { encrypt: (plain: string) => `sealed(${plain})`, decrypt: (sealed: string) => sealed.slice(7, -1) };

const config = { get: (key: string, fallback: unknown) => (key === 'stream.title' ? 'Dead Air' : fallback) };

const row = (overrides: Partial<EventDestinationRow> = {}): EventDestinationRow => ({
    id: 'dest-1',
    name: 'Hall light',
    url: 'http://192.168.1.20:8123/api/webhook/hall',
    secretSealed: encryption.encrypt('deadair_dest_kept'),
    enabled: true,
    events: [],
    consecutiveFailures: 0,
    createdAt: DateTime.fromISO('2026-10-14T10:00:00Z'),
    updatedAt: DateTime.fromISO('2026-10-14T10:00:00Z'),
    ...overrides,
});

function build(
    stored: EventDestinationRow | undefined = row(),
    delivery: WebhookDelivery = { outcome: 'delivered', httpStatus: 200, durationMs: 12 },
) {
    const repository = {
        list: vi.fn(async () => (stored === undefined ? [] : [stored])),
        get: vi.fn(async (id: string) => (stored?.id === id ? stored : undefined)),
        create: vi.fn(async (values: { name: string; url: string; secretSealed: string; enabled: boolean }) => row({ ...values, id: 'dest-2' })),
        update: vi.fn(async (id: string, changes: Partial<EventDestinationRow>) => (stored?.id === id ? { ...stored, ...changes } : undefined)),
        remove: vi.fn(async (id: string) => stored?.id === id),
        recordDelivery: vi.fn(async (_: NewEventDelivery) => undefined),
        listDeliveries: vi.fn(async () => []),
    };
    const sender = { send: vi.fn(async (_target: WebhookTarget, _envelope: EventEnvelope) => delivery) };
    const service = new EventDestinationsService(
        operator,
        repository as never,
        encryption as never,
        sender as never,
        new StationIdentity(),
        config as never,
    );
    return { service, repository, sender };
}

describe('creating a destination', () => {
    it('mints a secret, hands it back once, and stores only the sealed copy', async () => {
        const { service, repository } = build();

        const created = await service.create({ name: ' Hall light ', url: ' http://192.168.1.20:8123/api/webhook/hall ' });

        expect(created.secret).toMatch(/^deadair_dest_[A-Za-z0-9_-]{43}$/);
        expect(repository.create).toHaveBeenCalledWith({
            name: 'Hall light',
            url: 'http://192.168.1.20:8123/api/webhook/hall',
            secretSealed: `sealed(${created.secret})`,
            enabled: true,
            events: [],
            createdBy: 'op-1',
        });
        expect(created).not.toHaveProperty('secretSealed');
    });

    it('refuses an address the sender could not deliver to, before anything is stored', async () => {
        const { service, repository } = build();

        await expect(service.create({ name: 'x', url: 'ftp://hub.local/hook' })).rejects.toMatchObject({ statusCode: 400 });
        await expect(service.create({ name: 'x', url: 'https://user:pass@hooks.example.com/' })).rejects.toMatchObject({ statusCode: 400 });
        expect(repository.create).not.toHaveBeenCalled();
    });
});

describe('which events a destination asks for', () => {
    it('keeps the types it names, without repeats', async () => {
        const { service, repository } = build();

        await service.create({ name: 'x', url: 'http://hub.local/hook', events: ['talk.started', 'talk.started', 'production.started'] });

        expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ events: ['talk.started', 'production.started'] }));
    });

    it('refuses a type the station does not send, and the test event, which only a test sends', async () => {
        const { service } = build();

        await expect(service.create({ name: 'x', url: 'http://hub.local/hook', events: ['track.stared'] })).rejects.toMatchObject({
            statusCode: 400,
        });
        await expect(service.update('dest-1', { events: ['destination.test'] })).rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('changing a destination', () => {
    it('changes only what was sent', async () => {
        const { service, repository } = build();

        const updated = await service.update('dest-1', { enabled: false });

        expect(repository.update).toHaveBeenCalledWith('dest-1', { enabled: false });
        expect(updated.enabled).toBe(false);
    });

    it('checks a new address as creation does', async () => {
        const { service } = build();

        await expect(service.update('dest-1', { url: 'not a url' })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rotates the secret, returning the new one and sealing it', async () => {
        const { service, repository } = build();

        const { secret } = await service.rotateSecret('dest-1');

        expect(secret).toMatch(/^deadair_dest_/);
        expect(repository.update).toHaveBeenCalledWith('dest-1', { secretSealed: `sealed(${secret})` });
    });
});

describe('a test delivery', () => {
    it('signs with the unsealed secret, sends the test event, and logs the attempt', async () => {
        const { service, sender, repository } = build();

        const result = await service.test('dest-1');

        expect(result).toEqual({ delivered: true, httpStatus: 200, durationMs: 12 });
        const [target, envelope] = sender.send.mock.calls[0]!;
        expect(target).toEqual({ url: 'http://192.168.1.20:8123/api/webhook/hall', secret: 'deadair_dest_kept' });
        expect(envelope).toMatchObject({ type: DESTINATION_TEST, station: { key: 'main', name: 'Dead Air' }, data: { destinationId: 'dest-1' } });
        expect(repository.recordDelivery).toHaveBeenCalledWith({
            destinationId: 'dest-1',
            eventId: envelope.id,
            eventType: DESTINATION_TEST,
            attempt: 1,
            outcome: 'delivered',
            httpStatus: 200,
            durationMs: 12,
        });
    });

    it('is sent to a destination that is off', async () => {
        const { service, sender } = build(row({ enabled: false }));

        await service.test('dest-1');

        expect(sender.send).toHaveBeenCalledOnce();
    });

    it('reports a failure in the station words, and logs it', async () => {
        const { service, repository } = build(row(), { outcome: 'failed', retryable: true, httpStatus: 503, durationMs: 40, error: 'Answered 503.' });

        const result = await service.test('dest-1');

        expect(result).toEqual({ delivered: false, httpStatus: 503, durationMs: 40, error: 'Answered 503.' });
        expect(repository.recordDelivery).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed', error: 'Answered 503.' }));
    });
});

describe('a destination that does not exist', () => {
    it.each([
        ['update', (service: EventDestinationsService) => service.update('nope', { name: 'x' })],
        ['remove', (service: EventDestinationsService) => service.remove('nope')],
        ['rotate', (service: EventDestinationsService) => service.rotateSecret('nope')],
        ['test', (service: EventDestinationsService) => service.test('nope')],
        ['deliveries', (service: EventDestinationsService) => service.listDeliveries('nope')],
    ])('is a 404 to %s', async (_, call) => {
        const { service } = build();

        await expect(call(service)).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('the event types', () => {
    it('describes each with an example stamped with this station', async () => {
        const { service } = build();

        const { types } = await service.listTypes();

        expect(types.map(type => type.type)).toEqual([
            'track.started',
            'talk.started',
            'production.started',
            'programme.started',
            'station.onAir',
            'station.offAir',
            DESTINATION_TEST,
        ]);
        expect(types.at(-1)).toMatchObject({ subscribable: false, example: { type: DESTINATION_TEST, station: { key: 'main', name: 'Dead Air' } } });
        expect(types.filter(type => type.subscribable)).toHaveLength(6);
    });
});
