// Scrobbling to ListenBrainz. The property the whole design turns on is that a refused token costs
// the scrobbling and nothing else: the host's circuit is per plugin, and a `config` failure thrown
// from here would quarantine this plugin's enrichment and similarity along with it. So every failure
// branch is pinned by what it RETURNS, and only the ones the circuit is meant to see are thrown.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ScrobblePlay } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { MusicBrainzPlugin } from '../src/musicbrainz.plugin.js';
import { musicbrainzManifest, PLUGIN_VERSION } from '../src/musicbrainz.manifest.js';

let host: FakePluginHost;
let plugin: MusicBrainzPlugin;

/** A station with a token and the switch as given. The switch is off unless a case turns it on. */
const initialize = async (options: { token?: string; scrobbling?: boolean } = {}): Promise<void> => {
    host.seedConfig({
        contactEmail: 'station@example.test',
        matchScore: 90,
        ...(options.scrobbling === undefined ? {} : { scrobbling: options.scrobbling }),
    });
    host.seedSecret('listenBrainzToken', options.token ?? 'lb-token');
    await plugin.init(host);
};

const play = (title: string, overrides: Partial<ScrobblePlay> = {}): ScrobblePlay => ({
    title,
    artist: 'Nick Drake',
    album: 'Pink Moon',
    durationMs: 124_000,
    trackNumber: 1,
    playedAt: 1_758_540_000_123,
    ...overrides,
});

const sent = (index = 0): { listen_type: string; payload: Record<string, unknown>[] } => JSON.parse(host.calls[index]?.body ?? '{}');

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new MusicBrainzPlugin();
});

describe('manifest', () => {
    it('declares scrobbling, off by default', () => {
        expect(musicbrainzManifest.capabilities).toContain('scrobble');
        expect(musicbrainzManifest.configFields?.find(field => field.key === 'scrobbling')?.default).toBe(false);
    });
});

describe('accepting', () => {
    it('publishes nothing until the operator switches it on, token or not', async () => {
        await initialize({ scrobbling: false });
        expect(await plugin.accepting()).toBe(false);
    });

    it('publishes nothing without a token, whatever the switch says', async () => {
        await initialize({ token: '', scrobbling: true });
        expect(await plugin.accepting()).toBe(false);
    });

    it('publishes once both are there', async () => {
        await initialize({ scrobbling: true });
        expect(await plugin.accepting()).toBe(true);
    });
});

describe('scrobble', () => {
    it('submits a batch as an import, in seconds, with the token', async () => {
        await initialize({ scrobbling: true });
        host.queueResponse({ body: JSON.stringify({ status: 'ok' }) });

        const result = await plugin.scrobble([play('Pink Moon', { mbid: 'rec-1' }), play('Place To Be')]);

        expect(result).toEqual({ accepted: 2, rejected: [] });
        expect(host.calls[0]?.url).toContain('1/submit-listens');
        expect(host.calls[0]?.headers?.authorization).toBe('Token lb-token');
        expect(sent().listen_type).toBe('import');
        expect(sent().payload[0]).toEqual({
            // Seconds, where the host speaks milliseconds.
            listened_at: 1_758_540_000,
            track_metadata: {
                artist_name: 'Nick Drake',
                track_name: 'Pink Moon',
                release_name: 'Pink Moon',
                additional_info: {
                    duration_ms: 124_000,
                    tracknumber: 1,
                    recording_mbid: 'rec-1',
                    submission_client: 'deadair',
                    submission_client_version: PLUGIN_VERSION,
                },
            },
        });
    });

    it('submits one play as a single, which is what the service asks for', async () => {
        await initialize({ scrobbling: true });
        host.queueResponse({ body: JSON.stringify({ status: 'ok' }) });

        await plugin.scrobble([play('Pink Moon')]);

        expect(sent().listen_type).toBe('single');
    });

    it('keeps every play for later when the token is refused, rather than throwing', async () => {
        // Thrown, a 401 is a `config` failure and quarantines the whole plugin.
        await initialize({ scrobbling: true });
        host.queueResponse({ status: 401, body: '{}' });

        const result = await plugin.scrobble([play('Pink Moon'), play('Place To Be')]);

        expect(result.accepted).toBe(0);
        expect(result.rejected).toEqual([
            { index: 0, reason: expect.stringContaining('refused the token'), retryable: true },
            { index: 1, reason: expect.stringContaining('refused the token'), retryable: true },
        ]);
    });

    it('sends a refused payload again one listen at a time, and names the one that is malformed', async () => {
        // A 400 refuses the whole payload and says nothing about which listen was wrong.
        await initialize({ scrobbling: true });
        host.queueResponse({ status: 400, body: '{}' });
        host.queueResponse({ body: JSON.stringify({ status: 'ok' }) });
        host.queueResponse({ status: 400, body: '{}' });

        const result = await plugin.scrobble([play('Pink Moon'), play('')]);

        expect(result.accepted).toBe(1);
        expect(result.rejected).toEqual([{ index: 1, reason: expect.stringContaining('malformed'), retryable: false }]);
        expect(sent(1).listen_type).toBe('single');
        expect(sent(2).listen_type).toBe('single');
    });

    it('throws for a service that is down, which the circuit is meant to see and probe again', async () => {
        await initialize({ scrobbling: true });
        host.queueResponse({ status: 503, body: '{}' });

        await expect(plugin.scrobble([play('Pink Moon')])).rejects.toMatchObject({ status: 503 });
    });

    it('asks nothing of the service for an empty batch', async () => {
        await initialize({ scrobbling: true });

        expect(await plugin.scrobble([])).toEqual({ accepted: 0, rejected: [] });
        expect(host.calls).toHaveLength(0);
    });
});

describe('nowPlaying', () => {
    it('says what is on air as playing_now, with no time on it', async () => {
        await initialize({ scrobbling: true });
        host.queueResponse({ body: JSON.stringify({ status: 'ok' }) });

        await plugin.nowPlaying(play('Pink Moon'));

        expect(sent().listen_type).toBe('playing_now');
        expect(sent().payload[0]).not.toHaveProperty('listened_at');
    });

    it('never throws, whatever the service says', async () => {
        await initialize({ scrobbling: true });
        host.queueResponse({ status: 401, body: '{}' });

        await expect(plugin.nowPlaying(play('Pink Moon'))).resolves.toBeUndefined();
    });

    it('says nothing while scrobbling is off', async () => {
        await initialize({ scrobbling: false });

        await plugin.nowPlaying(play('Pink Moon'));

        expect(host.calls).toHaveLength(0);
    });
});
