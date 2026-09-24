// Telling chats what airs. The rules pinned here are the ones a listener in a chat would notice being
// broken: a break announced as though it were a record, an announcement arriving after the record
// had finished, a chat that removed the bot costing every other chat its message, and a retry that
// never ends.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { MessagingAnnounceTarget, MessagingSendResult, PluginManifest } from '@deadair/plugin-sdk';

import { MessagingAnnouncer, announceDeadline } from '../../../src/modules/messaging/messaging.announcer.js';
import { MessagingAnnounceJob } from '../../../src/modules/messaging/messaging.announce.job.js';
import { MessagingService } from '../../../src/modules/messaging/messaging.service.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import type { Rundown, RundownItem } from '../../../src/modules/playout/rundown.js';
import { RENDER_PLUGIN_ID } from '../../../src/modules/render/segment.source.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

function manifest(id: string): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        capabilities: ['messaging'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

interface PlatformOptions {
    targets?: MessagingAnnounceTarget[] | (() => Promise<MessagingAnnounceTarget[]>);
    accepting?: boolean;
    send?: () => Promise<MessagingSendResult>;
}

function platform(id: string, options: PlatformOptions = {}): PluginRecord {
    const instance: Record<string, unknown> = {
        init: vi.fn(),
        receive: vi.fn(async () => ({ messages: [] })),
        send: vi.fn(options.send ?? (async () => ({ delivered: true }))),
    };
    if (options.targets !== undefined) {
        const targets = options.targets;
        instance.announceTargets = vi.fn(typeof targets === 'function' ? targets : async () => targets);
    }
    if (options.accepting !== undefined) instance.accepting = vi.fn(async () => options.accepting);
    return { id, dir: `/plugins/${id}`, origin: 'bundled', status: 'active', manifest: manifest(id), instance: instance as never };
}

function build(records: PluginRecord[]) {
    const registry = new PluginRegistry();
    registry.setAll(records);
    const invoker = new PluginInvoker(registry, stubPluginLog().log);
    const messaging = new MessagingService(registry, invoker, stubLogger());

    let aired: ((item: RundownItem, passedOver: number) => void) | undefined;
    const rundown = {
        onAired: vi.fn((listener: typeof aired) => {
            aired = listener;
            return () => (aired = undefined);
        }),
    } as unknown as Rundown;
    const jobs = { send: vi.fn(async () => 'job-id') };
    const config = { get: vi.fn((_key: string, fallback: unknown) => (_key === 'stream.title' ? 'Dead Air' : fallback)) } as unknown as AppConfig;

    const announcer = new MessagingAnnouncer(rundown, messaging, invoker, jobs as never, config, stubLogger());
    return { announcer, jobs, messaging, air: (item: RundownItem) => aired?.(item, 0) };
}

const record = (overrides: Partial<RundownItem> = {}): RundownItem => ({
    id: 'item-1',
    pluginId: 'deadair.spotify',
    externalId: 'x',
    title: 'Teardrop',
    artists: ['Massive Attack'],
    artist: 'Massive Attack',
    album: 'Mezzanine',
    durationMs: 330_000,
    ...overrides,
});

describe('when an announcement stops being true', () => {
    it('is when the record stops playing', () => {
        expect(announceDeadline(1_000, 200_000)).toBe(201_000);
    });

    it('gives a record of unknown length a few minutes', () => {
        expect(announceDeadline(0, undefined)).toBe(4 * 60_000);
    });

    it('gives even a very short record time for a retry', () => {
        expect(announceDeadline(0, 5_000)).toBe(60_000);
    });
});

describe('announcing', () => {
    it('sends one job per chat that wants now-playing, with the record in the station’s words', async () => {
        const { announcer, jobs } = build([
            platform('deadair.telegram', {
                targets: [
                    { chatId: '@station', announcements: ['nowPlaying'] },
                    { chatId: '-1', announcements: ['nowPlaying'] },
                ],
            }),
        ]);

        expect(await announcer.announce(record(), 1_000)).toBe(2);
        expect(jobs.send).toHaveBeenCalledWith('messaging.announce', {
            pluginId: 'deadair.telegram',
            chatId: '@station',
            text: 'Now playing on Dead Air: Teardrop by Massive Attack (Mezzanine)',
            notAfter: 331_000,
        });
    });

    it('credits every artist on the record', async () => {
        const { announcer, jobs } = build([platform('p', { targets: [{ chatId: 'c', announcements: ['nowPlaying'] }] })]);

        await announcer.announce(
            record({ artists: ['Daft Punk', 'Pharrell Williams'], artist: 'Daft Punk', album: undefined, title: 'Get Lucky' }),
            0,
        );

        expect(jobs.send).toHaveBeenCalledWith(
            'messaging.announce',
            expect.objectContaining({ text: 'Now playing on Dead Air: Get Lucky by Daft Punk, Pharrell Williams' }),
        );
    });

    it('sends nothing for a platform that announces nowhere', async () => {
        const { announcer, jobs } = build([platform('p')]);

        expect(await announcer.announce(record(), 0)).toBe(0);
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('sends nothing for a platform that is not accepting', async () => {
        const { announcer, jobs } = build([platform('p', { accepting: false, targets: [{ chatId: 'c', announcements: ['nowPlaying'] }] })]);

        expect(await announcer.announce(record(), 0)).toBe(0);
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('still announces on one platform when another cannot say where to', async () => {
        const { announcer, jobs } = build([
            platform('a', { targets: async () => Promise.reject(new Error('boom')) }),
            platform('b', { targets: [{ chatId: 'c', announcements: ['nowPlaying'] }] }),
        ]);

        expect(await announcer.announce(record(), 0)).toBe(1);
        expect(jobs.send).toHaveBeenCalledWith('messaging.announce', expect.objectContaining({ pluginId: 'b' }));
    });
});

describe('the aired edge', () => {
    it('announces a record as it goes to air', async () => {
        const { announcer, jobs, air } = build([platform('p', { targets: [{ chatId: 'c', announcements: ['nowPlaying'] }] })]);
        announcer.start();

        air(record());

        await vi.waitFor(() => expect(jobs.send).toHaveBeenCalledTimes(1));
    });

    it('never announces the station talking as though it were a record', async () => {
        const { announcer, jobs, air } = build([platform('p', { targets: [{ chatId: 'c', announcements: ['nowPlaying'] }] })]);
        announcer.start();

        air(record({ pluginId: RENDER_PLUGIN_ID, title: 'Talk break' }));
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('stops listening when stopped', async () => {
        const { announcer, jobs, air } = build([platform('p', { targets: [{ chatId: 'c', announcements: ['nowPlaying'] }] })]);
        announcer.start();
        announcer.stop();

        air(record());
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(jobs.send).not.toHaveBeenCalled();
    });
});

describe('the announce job', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(100_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const job = (records: PluginRecord[]) => {
        const { messaging } = build(records);
        return new MessagingAnnounceJob(messaging, { id: 'job-1' } as never, {} as never, stubLogger());
    };

    const payload = { pluginId: 'p', chatId: 'c', text: 'Now playing', notAfter: 200_000 };

    it('sends the announcement', async () => {
        const send = vi.fn(async () => ({ delivered: true }));
        await job([platform('p', { send })]).run(payload);

        expect(send).toHaveBeenCalledWith({ chatId: 'c', text: 'Now playing' });
    });

    it('drops an announcement whose record has finished, rather than posting something false', async () => {
        const send = vi.fn(async () => ({ delivered: true }));
        await job([platform('p', { send })]).run({ ...payload, notAfter: 99_999 });

        expect(send).not.toHaveBeenCalled();
    });

    it('throws a refusal worth retrying, which is what hands it to the broker', async () => {
        await expect(
            job([platform('p', { send: async () => ({ delivered: false, reason: 'rate limited', retryable: true }) })]).run(payload),
        ).rejects.toThrow('rate limited');
    });

    it('drops a permanent refusal without throwing, so it is not retried', async () => {
        await expect(
            job([platform('p', { send: async () => ({ delivered: false, reason: 'bot was blocked', retryable: false }) })]).run(payload),
        ).resolves.toBeUndefined();
    });

    it('does nothing with a payload it cannot read', async () => {
        const send = vi.fn(async () => ({ delivered: true }));
        await job([platform('p', { send })]).run({ pluginId: 'p' });

        expect(send).not.toHaveBeenCalled();
    });
});
