// What goes on air, as the event a destination receives. The rules that matter: a record, a break, a
// production and a programme each become their own type; a production fires once however many beats
// it airs as; a segment the station cannot identify fires nothing; and `endsAt` and `notAfter` come
// from the item's own length, because a light switched for a record that has finished is wrong.

import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';

import { AIR_CHANGE_WINDOW_MS, EventAnnouncer, airChangedEvent, airedEvent } from '../../../src/modules/events/event.announcer.js';
import { EventDestinationsRepository } from '../../../src/modules/events/event.destinations.repository.js';
import type { RundownItem } from '../../../src/modules/playout/rundown.js';
import { ProductionRepository } from '../../../src/modules/productions/production.repository.js';
import { RENDER_PLUGIN_ID } from '../../../src/modules/render/segment.source.js';
import { SegmentRepository } from '../../../src/modules/render/segment.repository.js';
import { StationBus } from '../../../src/modules/shared/station.bus.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const AIRED_AT = DateTime.fromISO('2026-10-14T20:00:00Z').toMillis();

const record = (overrides: Partial<RundownItem> = {}): RundownItem =>
    ({
        id: 'item-1',
        pluginId: 'deadair.navidrome',
        externalId: 'nd-42',
        title: 'Pink Moon',
        artists: ['Nick Drake'],
        artist: 'Nick Drake',
        album: 'Pink Moon',
        year: 1972,
        durationMs: 124_000,
        ...overrides,
    }) as RundownItem;

const segment = (overrides: Partial<RundownItem> = {}): RundownItem =>
    ({
        id: 'item-2',
        pluginId: RENDER_PLUGIN_ID,
        externalId: 'seg-1',
        title: 'Talk break',
        artists: [],
        artist: '',
        durationMs: 30_000,
        ...overrides,
    }) as RundownItem;

describe('airedEvent', () => {
    it('makes a record track.started, with when it ends and the artwork it was given', () => {
        const event = airedEvent(record(), AIRED_AT, undefined, { artworkUrl: 'https://radio.example.com/api/art/x/cover.jpg' });

        expect(event).toEqual({
            type: 'track.started',
            notAfter: AIRED_AT + 124_000,
            data: {
                itemId: 'item-1',
                title: 'Pink Moon',
                artists: ['Nick Drake'],
                artist: 'Nick Drake',
                album: 'Pink Moon',
                year: 1972,
                durationMs: 124_000,
                endsAt: '2026-10-14T20:02:04.000Z',
                artworkUrl: 'https://radio.example.com/api/art/x/cover.jpg',
            },
        });
    });

    it('gives a record of unknown length no endsAt, and the announcer window as notAfter', () => {
        const event = airedEvent(record({ durationMs: undefined }), AIRED_AT, undefined);

        expect(event?.data).not.toHaveProperty('endsAt');
        expect(event?.notAfter).toBe(AIRED_AT + 4 * 60_000);
    });

    it('sends nothing for a record with no title', () => {
        expect(airedEvent(record({ title: '  ' }), AIRED_AT, undefined)).toBeUndefined();
    });

    it('makes a break talk.started, with its own kind and only the listener label', () => {
        const event = airedEvent(segment({ listenerLabel: 'The weather' }), AIRED_AT, { kind: 'weather' });

        expect(event).toMatchObject({ type: 'talk.started', data: { segmentId: 'seg-1', kind: 'weather', label: 'The weather' } });
    });

    it('makes a segment of a production production.started, named by the production', () => {
        const facts = { kind: 'callin', productionId: 'prod-1', production: { kind: 'callin', title: 'Your calls' } };

        expect(airedEvent(segment(), AIRED_AT, facts)).toMatchObject({
            type: 'production.started',
            data: { productionId: 'prod-1', kind: 'callin', title: 'Your calls' },
        });
        expect(airedEvent(segment(), AIRED_AT, facts, { productionAlreadyFired: true })).toBeUndefined();
    });

    it('makes a programme programme.started from the item alone, podcast or reading by who voiced it', () => {
        const episode = segment({ programme: true, title: 'Episode 12', artists: ['The Long Wave'] });
        const reading = segment({ programme: true, stationVoiced: true, title: 'Chapter 3', artists: [] });

        expect(airedEvent(episode, AIRED_AT, undefined)).toMatchObject({
            type: 'programme.started',
            data: { source: 'podcast', show: 'The Long Wave', episode: 'Episode 12' },
        });
        expect(airedEvent(reading, AIRED_AT, undefined)).toMatchObject({
            type: 'programme.started',
            data: { source: 'narration', episode: 'Chapter 3' },
        });
        expect(airedEvent(reading, AIRED_AT, undefined)?.data).not.toHaveProperty('show');
    });

    it('sends nothing for a segment whose row is gone', () => {
        expect(airedEvent(segment(), AIRED_AT, undefined)).toBeUndefined();
    });
});

describe('EventAnnouncer', () => {
    function build(segments: Record<string, { kind: string; productionId?: string }>, subscribers: string[] = ['dest-1']) {
        const repositories = new Map<unknown, unknown>([
            [SegmentRepository, { kindOf: vi.fn(async (id: string) => segments[id]) }],
            [ProductionRepository, { findById: vi.fn(async (id: string) => ({ id, kind: 'callin', title: 'Your calls' })) }],
            [EventDestinationsRepository, { subscribedTo: vi.fn(async () => subscribers) }],
        ]);
        const scope = { get: (token: unknown) => repositories.get(token), disposeAsync: async () => undefined };
        const container = { createScopedContainer: () => scope };
        const jobs = { send: vi.fn(async () => 'job') };
        const config = { get: (key: string, fallback: unknown) => (key === 'stream.title' ? 'Dead Air' : fallback) };
        const bus = new StationBus({ warn: vi.fn() } as never);
        const announcer = new EventAnnouncer(
            { onAired: () => () => undefined } as never,
            bus,
            jobs as never,
            container as never,
            new StationIdentity(),
            config as never,
            { warn: vi.fn() } as never,
        );
        return { announcer, jobs, bus };
    }

    it('sends one job per subscribed destination, carrying the envelope and when it stops being true', async () => {
        const { announcer, jobs } = build({}, ['dest-1', 'dest-2']);

        expect(await announcer.announce(record(), AIRED_AT)).toBe(2);
        expect(jobs.send).toHaveBeenCalledWith('events.deliver', {
            destinationId: 'dest-1',
            envelope: expect.objectContaining({
                type: 'track.started',
                occurredAt: '2026-10-14T20:00:00.000Z',
                station: { key: 'main', name: 'Dead Air' },
            }),
            notAfter: AIRED_AT + 124_000,
            state: true,
        });
    });

    it('sends nothing when nobody wants it', async () => {
        const { announcer, jobs } = build({}, []);

        expect(await announcer.announce(record(), AIRED_AT)).toBe(0);
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('announces a production aired as a block of beats once, and the next one again', async () => {
        const { announcer, jobs } = build({
            'beat-1': { kind: 'callin', productionId: 'prod-1' },
            'beat-2': { kind: 'callin', productionId: 'prod-1' },
            'beat-3': { kind: 'callin', productionId: 'prod-2' },
        });

        await announcer.announce(segment({ externalId: 'beat-1' }), AIRED_AT);
        await announcer.announce(segment({ externalId: 'beat-2' }), AIRED_AT + 1);
        await announcer.announce(segment({ externalId: 'beat-3' }), AIRED_AT + 2);

        const types = (jobs.send.mock.calls as unknown[][]).map(
            call => (call[1] as { envelope: { data: { productionId: string } } }).envelope.data.productionId,
        );
        expect(types).toEqual(['prod-1', 'prod-2']);
    });
});

describe('the station going on and off air', () => {
    it('becomes station.onAir or station.offAir, true for ten minutes', () => {
        expect(airChangedEvent({ on: true, reason: 'programme', programme: 'Late Night Lows', at: AIRED_AT })).toEqual({
            type: 'station.onAir',
            data: { reason: 'programme', programme: 'Late Night Lows' },
            notAfter: AIRED_AT + AIR_CHANGE_WINDOW_MS,
        });
        expect(airChangedEvent({ on: false, reason: 'ranOut', at: AIRED_AT })).toEqual({
            type: 'station.offAir',
            data: { reason: 'ranOut' },
            notAfter: AIRED_AT + AIR_CHANGE_WINDOW_MS,
        });
    });

    it('is heard off the bus once started, at the moment the director decided, and not after stopping', async () => {
        const repositories = new Map<unknown, unknown>([[EventDestinationsRepository, { subscribedTo: vi.fn(async () => ['dest-1']) }]]);
        const container = {
            createScopedContainer: () => ({ get: (token: unknown) => repositories.get(token), disposeAsync: async () => undefined }),
        };
        const jobs = { send: vi.fn(async () => 'job') };
        const bus = new StationBus({ warn: vi.fn() } as never);
        const config = { get: (_: string, fallback: unknown) => fallback };
        const announcer = new EventAnnouncer(
            { onAired: () => () => undefined } as never,
            bus,
            jobs as never,
            container as never,
            new StationIdentity(),
            config as never,
            { warn: vi.fn() } as never,
        );

        announcer.start();
        bus.publish('air.changed', { on: false, reason: 'stopped', at: AIRED_AT });
        await vi.waitFor(() => expect(jobs.send).toHaveBeenCalledOnce());
        expect(jobs.send).toHaveBeenCalledWith(
            'events.deliver',
            expect.objectContaining({
                envelope: expect.objectContaining({ type: 'station.offAir', occurredAt: '2026-10-14T20:00:00.000Z' }),
                state: true,
            }),
        );

        announcer.stop();
        bus.publish('air.changed', { on: true, reason: 'resumed', at: AIRED_AT + 1 });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(jobs.send).toHaveBeenCalledOnce();
    });
});
