// The desk, against an in-memory table. What is pinned is what a listener would notice: a request
// placed only once its audio is here, the station's own rules still applying, the director asked
// rather than the order written, a request that waits too long let go, and whoever asked from a chat
// told what became of it, once.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { REQUEST_AIR_WINDOW_MS, REQUEST_PLACE_WINDOW_MS, RequestDesk, type Requester } from '../../../src/modules/requests/request.desk.js';
import type { NewRequest, RequestRow, RequestStatus, RequestsRepository } from '../../../src/modules/requests/requests.repository.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() } as unknown as Logger;

const TEARDROP = { trackId: 't-1', title: 'Teardrop', artist: 'Massive Attack' };
const RESOLVED = {
    pluginId: 'deadair.spotify',
    externalId: 'sp-1',
    trackId: 't-1',
    title: 'Teardrop',
    artist: 'Massive Attack',
    artists: ['Massive Attack'],
};

const app = (id = 'a-1'): Requester => ({ key: `user:${id}`, name: 'Robin', actorId: id });
const chat = (id = '7'): Requester => ({
    key: `chat:deadair.telegram:${id}`,
    name: 'Sam',
    chat: { pluginId: 'deadair.telegram', chatId: '42', chatKind: 'direct', messageId: 'm-1' },
});

/** An in-memory `listener_requests`, enough of it for the desk. */
function memoryTable() {
    const rows: RequestRow[] = [];
    let next = 1;
    const repository = {
        rows,
        create: vi.fn(async (request: NewRequest) => {
            const row: RequestRow = {
                ...(request.dedication === undefined ? {} : { dedication: request.dedication }),
                id: `r-${next++}`,
                requesterKey: request.requesterKey,
                requesterName: request.requesterName,
                ...(request.actorId === undefined ? {} : { actorId: request.actorId }),
                ...(request.chat === undefined ? {} : { chat: request.chat }),
                trackId: request.trackId,
                title: request.title,
                artist: request.artist,
                status: request.status,
                ...(request.reason === undefined ? {} : { reason: request.reason }),
                createdAt: DateTime.now(),
            };
            rows.push(row);
            return row;
        }),
        find: vi.fn(async (_: string, id: string) => rows.find(row => row.id === id)),
        open: vi.fn(async () => rows.filter(row => ['waiting', 'pending', 'queued'].includes(row.status))),
        lastGrantedAt: vi.fn(async (_: string, key: string) =>
            rows
                .filter(row => row.requesterKey === key && ['pending', 'queued', 'aired'].includes(row.status))
                .map(row => row.createdAt)
                .at(-1),
        ),
        moveTo: vi.fn(async (_: string, id: string, from: readonly RequestStatus[], to: RequestStatus, reason?: string) => {
            const row = rows.find(candidate => candidate.id === id);
            if (row === undefined || !from.includes(row.status)) return undefined;
            row.status = to;
            if (reason !== undefined) row.reason = reason;
            return { ...row };
        }),
    };
    return repository;
}

interface World {
    dedications?: string;
    onAir?: boolean;
    approval?: string;
    lineup?: boolean;
    resolves?: boolean;
    audio?: 'local' | 'remote' | 'none';
    fetching?: boolean;
    edit?: { ok: true } | { ok: false; reason: string; message: string };
}

function build(world: World = {}) {
    const table = memoryTable();
    const settings: Record<string, unknown> = {
        'requests.approval': world.approval ?? 'auto',
        ...(world.dedications === undefined ? {} : { 'requests.dedications': world.dedications }),
    };
    const config = {
        get: vi.fn((key: string, fallback: unknown) => settings[key] ?? fallback),
        has: vi.fn((key: string) => key in settings),
    } as unknown as AppConfig;
    const jobs = { send: vi.fn(async (_name: string, _payload: unknown) => 'job') };
    const director = { applyEdit: vi.fn(async (_edit: unknown) => world.edit ?? { ok: true }) };
    const segments = { plan: vi.fn(async () => ({ id: 'seg-1' })), markFailed: vi.fn(async () => undefined) };
    const resolver = { resolve: vi.fn(async () => (world.resolves === false ? [] : [RESOLVED])) };
    const audio = {
        findForBindings: vi.fn(async () =>
            world.audio === 'none'
                ? []
                : [
                      {
                          sourceId: 's-1',
                          pluginId: 'deadair.spotify',
                          externalId: 'sp-1',
                          attempts: 0,
                          ...(world.audio === 'remote' ? {} : { checksum: 'abc' }),
                      },
                  ],
        ),
    };

    const desk = new RequestDesk(
        table as unknown as RequestsRepository,
        { stationKey: 'main' } as never,
        config,
        { getNowPlaying: () => ({ onAir: world.onAir ?? true }) } as never,
        { load: vi.fn(async () => (world.lineup === false ? undefined : { mode: 'rotation', rules: undefined, era: undefined })) } as never,
        resolver as never,
        audio as never,
        { isFetching: () => world.fetching ?? false } as never,
        director as never,
        segments as never,
        jobs as never,
        logger,
    );
    const told = () => jobs.send.mock.calls.filter(call => call[0] === 'messaging.announce').map(call => (call[1] as { text: string }).text);
    return { desk, table, jobs, director, resolver, segments, told };
}

beforeEach(() => vi.clearAllMocks());

describe('submitting', () => {
    it('places a request whose audio is here, through the director, and answers it queued', async () => {
        const { desk, director } = build();

        const row = await desk.submit(app(), TEARDROP);

        expect(row.status).toBe('queued');
        expect(director.applyEdit).toHaveBeenCalledWith({ kind: 'insertRequested', track: RESOLVED, requestId: row.id });
    });

    it('fetches a record that is not here yet and holds the request pending, rather than holding the station', async () => {
        const { desk, director, jobs } = build({ audio: 'remote' });

        const row = await desk.submit(app(), TEARDROP);

        expect(row.status).toBe('pending');
        expect(director.applyEdit).not.toHaveBeenCalled();
        expect(jobs.send).toHaveBeenCalledWith('playout.cache_track', { sourceId: 's-1' });
    });

    it('does not ask for a fetch already on its way', async () => {
        const { desk, jobs } = build({ audio: 'remote', fetching: true });

        await desk.submit(app(), TEARDROP);

        expect(jobs.send).not.toHaveBeenCalledWith('playout.cache_track', expect.anything());
    });

    it('turns down a record the station’s own rules rule out, and says why', async () => {
        const { desk } = build({ resolves: false });

        const row = await desk.submit(app(), TEARDROP);

        expect(row).toMatchObject({ status: 'declined', reason: expect.stringContaining('aired lately') });
    });

    it('turns down a record no source can play', async () => {
        const { desk } = build({ audio: 'none' });

        expect((await desk.submit(app(), TEARDROP)).status).toBe('declined');
    });

    it('holds a request pending when there is no quiet place near the head just now', async () => {
        const { desk } = build({ edit: { ok: false, reason: 'no-gap', message: 'no quiet place' } });

        expect((await desk.submit(app(), TEARDROP)).status).toBe('pending');
    });

    it('records a refusal as a declined row, so whoever asked is told why in the same breath', async () => {
        const { desk } = build({ onAir: false });

        const row = await desk.submit(app(), TEARDROP);

        expect(row).toMatchObject({ status: 'declined', reason: expect.stringContaining('off the air') });
    });

    it('holds one person to one request, from an app and a chat alike', async () => {
        const { desk } = build({ audio: 'remote' });
        await desk.submit(app('a-1'), TEARDROP);

        const second = await desk.submit(app('a-1'), { trackId: 't-2', title: 'Angel', artist: 'Massive Attack' });

        expect(second).toMatchObject({ status: 'declined', reason: expect.stringContaining('One at a time') });
    });

    it('waits for an operator when the station asks for one', async () => {
        const { desk, director } = build({ approval: 'operator' });

        expect((await desk.submit(app(), TEARDROP)).status).toBe('waiting');
        expect(director.applyEdit).not.toHaveBeenCalled();
    });

    it('tells a chat nothing on submit: the command answers with the row itself', async () => {
        const { desk, told } = build();

        await desk.submit(chat(), TEARDROP);

        expect(told()).toEqual([]);
    });
});

describe('an operator deciding', () => {
    it('grants a waiting request and places it', async () => {
        const { desk } = build({ approval: 'operator' });
        const row = await desk.submit(chat(), TEARDROP);

        expect((await desk.grant(row.id))?.status).toBe('queued');
    });

    it('tells a chat when its request is granted', async () => {
        const { desk, told } = build({ approval: 'operator' });
        const row = await desk.submit(chat(), TEARDROP);

        await desk.grant(row.id);

        expect(told()).toEqual(['Your request is in: Teardrop by Massive Attack, a few records from now.']);
    });

    it('declines with the operator’s words, and tells the chat', async () => {
        const { desk, told } = build({ approval: 'operator' });
        const row = await desk.submit(chat(), TEARDROP);

        expect(await desk.decline(row.id, 'Not tonight.')).toMatchObject({ status: 'declined', reason: 'Not tonight.' });
        expect(told()).toEqual(['Sorry, not this time: Teardrop by Massive Attack. Not tonight.']);
    });

    it('will not grant a request that is not waiting, or decline one already in the order', async () => {
        const { desk } = build();
        const row = await desk.submit(app(), TEARDROP);

        expect(await desk.grant(row.id)).toBeUndefined();
        expect(await desk.decline(row.id, undefined)).toBeUndefined();
    });
});

describe('the tick', () => {
    it('places a pending request once its audio has arrived, and tells the chat', async () => {
        const world: World = { audio: 'remote' };
        const { desk, told } = build(world);
        const row = await desk.submit(chat(), TEARDROP);
        world.audio = 'local';

        expect(await desk.tick()).toBe(1);
        expect((await desk['repository'].find('main', row.id))?.status).toBe('queued');
        expect(told()).toEqual(['Your request is in: Teardrop by Massive Attack, a few records from now.']);
    });

    it('lets go of a request that could not be placed within the hour', async () => {
        const { desk, table, told } = build({ audio: 'remote' });
        const row = await desk.submit(chat(), TEARDROP);

        await desk.tick(row.createdAt.toMillis() + REQUEST_PLACE_WINDOW_MS + 1);

        expect(table.rows[0]).toMatchObject({ status: 'expired', reason: 'It could not be fitted in within the hour.' });
        expect(told()[0]).toContain('has lapsed');
    });

    it('writes off a queued request that never aired', async () => {
        const { desk, table } = build();
        const row = await desk.submit(app(), TEARDROP);

        await desk.tick(row.createdAt.toMillis() + REQUEST_AIR_WINDOW_MS + 1);

        expect(table.rows[0]?.status).toBe('expired');
    });
});

describe('airing', () => {
    it('marks the request heard when its record airs, and tells the chat', async () => {
        const { desk, table, told } = build();
        await desk.submit(chat(), TEARDROP);

        expect(await desk.aired('t-1')).toBe(1);
        expect(table.rows[0]?.status).toBe('aired');
        expect(told()).toEqual(['Playing your request now: Teardrop by Massive Attack.']);
    });

    it('ignores a record nobody asked for', async () => {
        const { desk } = build();
        await desk.submit(app(), TEARDROP);

        expect(await desk.aired('t-999')).toBe(0);
    });
});

describe('a dedication', () => {
    const dedication = { to: 'Danielle', message: 'you still owe me twenty bucks' };

    it('plans the words in front of the record, carrying the listener’s parts to the writer and nowhere else', async () => {
        const { desk, director, segments } = build();

        const row = await desk.submit(chat(), TEARDROP, dedication);

        expect(segments.plan).toHaveBeenCalledWith({
            kind: 'dedication',
            label: 'Dedication',
            context: { dedicatedBy: 'Sam', dedicateTo: 'Danielle', message: 'you still owe me twenty bucks' },
        });
        expect(director.applyEdit).toHaveBeenCalledWith({
            kind: 'insertRequested',
            track: RESOLVED,
            requestId: row.id,
            dedication: { segmentId: 'seg-1', segmentKind: 'dedication' },
        });
        expect(row.dedication).toEqual(dedication);
    });

    it('writes the planned words off when the record could not go in, rather than leave them looking like a break to come', async () => {
        const { desk, segments } = build({ edit: { ok: false, reason: 'no-gap', message: 'no quiet place' } });

        await desk.submit(chat(), TEARDROP, dedication);

        expect(segments.markFailed).toHaveBeenCalledWith('seg-1', expect.any(String), 'planned');
    });

    it('plays the record without the words when the operator has turned dedications off, and keeps the dedication for them', async () => {
        const { desk, director, segments } = build({ dedications: 'false' });

        const row = await desk.submit(chat(), TEARDROP, dedication);

        expect(segments.plan).not.toHaveBeenCalled();
        expect(director.applyEdit).toHaveBeenCalledWith(expect.not.objectContaining({ dedication: expect.anything() }));
        expect(row.dedication).toEqual(dedication);
    });

    it('plans nothing for a request with no dedication', async () => {
        const { desk, segments } = build();

        await desk.submit(app(), TEARDROP);

        expect(segments.plan).not.toHaveBeenCalled();
    });
});
