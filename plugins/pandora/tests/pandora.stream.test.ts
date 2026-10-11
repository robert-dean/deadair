// Playing a chosen record and telling Pandora what became of it. The playback answer is a recorded
// one (from a station, which is what a free account can play; a chosen record's answer has the same
// shape), and the refusal is the one a free account really got.

import { describe, expect, it } from 'vitest';

import { BUSY_RETRY_MS } from '../src/pandora.manifest.js';
import { PandoraPlugin } from '../src/pandora.plugin.js';
import { fakePandora, fixture, type FakePandora } from './pandora.fake.js';

const TRACK = 'TR:47605';
const ALBUM = 'AL:3806';

const recorded = fixture('playback.source.station').body as { item: Record<string, unknown>; annotations: Record<string, unknown> };

async function build(playback?: (body: any) => { status?: number; body: unknown }): Promise<{ fake: FakePandora; plugin: PandoraPlugin }> {
    const fake = fakePandora();
    fake.web['v4/catalog/annotateObjects'] = { body: recorded.annotations };
    fake.web['v1/playback/source'] = playback ?? (() => ({ body: recorded }));
    fake.web['v1/station/trackStarted'] = { body: fixture('track.started').body };
    fake.web['v1/event/ended'] = { body: fixture('event.ended').body };

    const plugin = new PandoraPlugin();
    await plugin.init(fake.host);
    return { fake, plugin };
}

const callsTo = (fake: FakePandora, endpoint: string) => fake.webCalls.filter(call => call.endpoint === endpoint);

describe('resolveStreamUrl', () => {
    it("plays the record from its album, starting at it, and hands back Pandora's CDN link", async () => {
        const { fake, plugin } = await build();

        const stream = await plugin.resolveStreamUrl(TRACK);

        expect(callsTo(fake, 'v1/playback/source')[0]!.body).toMatchObject({ sourceId: ALBUM, itemId: TRACK, includeItem: true });
        expect(new URL(stream!.url).hostname).toBe('audio-usc-mp1-t1-1-v4v6.pandora.com');
        expect(stream!.mimeType).toBe('audio/mp4');
    });

    it('is known to Pandora as one device, made once and kept', async () => {
        const { fake, plugin } = await build();

        await plugin.resolveStreamUrl(TRACK);
        await plugin.resolveStreamUrl(TRACK);

        const [first, second] = callsTo(fake, 'v1/playback/source').map(call => call.body.deviceUuid);
        expect(first).toMatch(/^[0-9a-f-]{36}$/);
        expect(second).toBe(first);
        expect(fake.host.getStorageEntry('deviceUuid')).toBe(first);
    });

    it("asks for a record's album only once", async () => {
        const { fake, plugin } = await build();

        await plugin.resolveStreamUrl(TRACK);
        await plugin.resolveStreamUrl(TRACK);

        expect(callsTo(fake, 'v4/catalog/annotateObjects')).toHaveLength(1);
    });

    it("says an account without Premium cannot play a chosen record, as a refusal about the record", async () => {
        const refused = fixture('playback.source.no.entitlements');
        const { plugin } = await build(() => refused);

        await expect(plugin.resolveStreamUrl(TRACK)).rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('Premium') });
    });

    it('does not ask to play a record Pandora has no on-demand rights for', async () => {
        const { fake, plugin } = await build();
        fake.web['v4/catalog/annotateObjects'] = { body: { [TRACK]: { name: 'High and Dry', albumId: ALBUM, rightsInfo: { hasInteractive: false } } } };

        await expect(plugin.resolveStreamUrl(TRACK)).rejects.toMatchObject({ code: 'forbidden' });
        expect(callsTo(fake, 'v1/playback/source')).toHaveLength(0);
    });

    it('says the account is busy, with a wait, when it is playing on another device', async () => {
        const { plugin } = await build(() => ({ body: { item: { type: 'SimStreamViolation' } } }));

        await expect(plugin.resolveStreamUrl(TRACK)).rejects.toMatchObject({ code: 'unavailable', retryAfterMs: BUSY_RETRY_MS });
    });

    it('refuses to hand over a different record than the one asked for', async () => {
        const { plugin } = await build(() => ({ body: { ...recorded, item: { ...recorded.item, pandoraId: 'TR:1' } } }));

        await expect(plugin.resolveStreamUrl(TRACK)).rejects.toMatchObject({ code: 'upstream' });
    });

    it('says when Pandora gave no audio at all', async () => {
        const { plugin } = await build(() => ({ body: { item: { type: 'Track', pandoraId: TRACK } } }));

        await expect(plugin.resolveStreamUrl(TRACK)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('fetches over TLS even when Pandora handed out a plain-http link', async () => {
        const { plugin } = await build(() => ({ body: { ...recorded, item: { ...recorded.item, audioUrl: 'http://t1-1.p-cdn.us/access/?token=x' } } }));

        await expect(plugin.resolveStreamUrl(TRACK)).resolves.toMatchObject({ url: 'https://t1-1.p-cdn.us/access/?token=x' });
    });

    it('has nothing to say about an id that is not a Pandora track', async () => {
        const { fake, plugin } = await build();

        await expect(plugin.resolveStreamUrl('spotify:track:1')).resolves.toBeUndefined();
        expect(fake.webCalls).toHaveLength(0);
    });
});

describe('reportPlayback', () => {
    it("reports a record starting with the token it was served under", async () => {
        const { fake, plugin } = await build();
        await plugin.resolveStreamUrl(TRACK);

        await plugin.reportPlayback(TRACK, { event: 'started', startedAt: 1_000 });

        expect(callsTo(fake, 'v1/station/trackStarted')[0]!.body).toEqual({ trackToken: 'TRACK-TOKEN' });
    });

    it('reports it ending, in whole seconds, against where it was served from', async () => {
        const { fake, plugin } = await build();
        await plugin.resolveStreamUrl(TRACK);
        const deviceUuid = callsTo(fake, 'v1/playback/source')[0]!.body.deviceUuid;

        await plugin.reportPlayback(TRACK, { event: 'ended', startedAt: 1_000, elapsedMs: 180_400 });

        expect(callsTo(fake, 'v1/event/ended')[0]!.body).toEqual({
            deviceUuid,
            sourceId: (recorded as { source: { pandoraId: string } }).source.pandoraId,
            index: 0,
            elapsedTime: 180,
            reason: 'NORMAL',
        });
    });

    it('forgets a copy once it has ended, so a late repeat reports nothing twice', async () => {
        const { fake, plugin } = await build();
        await plugin.resolveStreamUrl(TRACK);
        await plugin.reportPlayback(TRACK, { event: 'ended', startedAt: 1_000, elapsedMs: 5_000 });

        await plugin.reportPlayback(TRACK, { event: 'ended', startedAt: 1_000, elapsedMs: 5_000 });

        expect(callsTo(fake, 'v1/event/ended')).toHaveLength(1);
    });

    it('says nothing about a copy it never served, such as one fetched before a restart', async () => {
        const { fake, plugin } = await build();

        await plugin.reportPlayback(TRACK, { event: 'started', startedAt: 1_000 });

        expect(fake.webCalls).toHaveLength(0);
    });

    it("lets Pandora's refusal through, so the station can retry what is worth retrying", async () => {
        const { fake, plugin } = await build();
        await plugin.resolveStreamUrl(TRACK);
        fake.web['v1/station/trackStarted'] = { status: 503, body: { message: 'down' } };

        await expect(plugin.reportPlayback(TRACK, { event: 'started', startedAt: 1_000 })).rejects.toMatchObject({ code: 'unavailable' });
    });
});
