import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPluginError, PluginError, type OutputPlayRequest } from '@deadair/plugin-sdk';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

import { CAST_HEARTBEAT_MS, CAST_SILENCE_MS } from '../../../src/drivers/chromecast/cast.channel.js';
import { CAST_OPENING_GRACE_MS, ChromecastDriver, DEFAULT_MEDIA_RECEIVER, castUrl } from '../../../src/drivers/chromecast/chromecast.driver.js';
import type { SpeakerTarget } from '../../../src/drivers/speaker.driver.js';
import { FakeCastDevice } from '../../fake.cast.device.js';

const target: SpeakerTarget = { id: 'chromecast:192.168.1.20', name: 'Kitchen', address: '192.168.1.20' };

const request: OutputPlayRequest = {
    deviceId: target.id,
    url: 'https://radio.example.com/live.mp3',
    contentType: 'audio/mpeg',
    metadata: { title: 'deadair', subtitle: 'The late show', artworkUrl: 'https://radio.example.com/art.png' },
};

function setup() {
    const host = createFakePluginHost();
    const device = FakeCastDevice.on(host);
    const driver = new ChromecastDriver();
    return { host, device, driver };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('castUrl', () => {
    it.each([
        ['192.168.1.20', 'tls://192.168.1.20:8009'],
        ['192.168.1.20:8010', 'tls://192.168.1.20:8010'],
        ['tls://kitchen.local', 'tls://kitchen.local:8009'],
        ['http://kitchen.local:9000/whatever', 'tls://kitchen.local:9000'],
        ['  10.0.0.5  ', 'tls://10.0.0.5:8009'],
    ])('reads %s as %s', (address, url) => {
        expect(castUrl(address)).toBe(url);
    });
});

describe('ChromecastDriver', () => {
    it('launches the media player, then loads the station as a live stream', async () => {
        const { host, device, driver } = setup();

        await driver.play(host, target, request);

        expect(host.tlsSockets.map(socket => socket.url)).toEqual(['tls://192.168.1.20:8009']);
        expect(host.tlsSockets[0]!.options).toEqual({ verifyCertificate: false });
        expect(device.requests).toEqual(['receiver#GET_STATUS', 'receiver#LAUNCH', 'media#LOAD']);
        expect(device.app?.appId).toBe(DEFAULT_MEDIA_RECEIVER);
        expect(device.loads[0]).toMatchObject({
            autoplay: true,
            media: {
                contentId: request.url,
                contentType: 'audio/mpeg',
                streamType: 'LIVE',
                metadata: { metadataType: 3, title: 'deadair', artist: 'The late show', images: [{ url: 'https://radio.example.com/art.png' }] },
            },
        });
    });

    it('reuses the media player when it is already up, and the connection between calls', async () => {
        const { host, device, driver } = setup();
        await driver.play(host, target, request);

        await driver.play(host, target, { ...request, url: 'https://radio.example.com/live.aac', contentType: 'audio/aac' });

        expect(device.requests.filter(r => r === 'receiver#LAUNCH')).toHaveLength(1);
        expect(host.tlsSockets).toHaveLength(1);
    });

    it('takes over from another app, since being asked to play is being asked to replace it', async () => {
        const { host, device, driver } = setup();
        device.runOther();

        await driver.play(host, target, request);

        expect(device.requests).toContain('receiver#LAUNCH');
        expect(device.app?.appId).toBe(DEFAULT_MEDIA_RECEIVER);
    });

    it('throws an upstream error naming LOAD_FAILED when the device refuses the stream', async () => {
        const { host, device, driver } = setup();
        device.failLoads = true;

        const error = await driver.play(host, target, request).catch((caught: unknown) => caught);

        expect(isPluginError(error) && error.code).toBe('upstream');
        expect((error as PluginError).message).toContain('LOAD_FAILED');
    });

    it('answers unreachable rather than throwing when the device cannot be reached', async () => {
        const { host, driver } = setup();
        host.refuseTls(new PluginError('connect ECONNREFUSED').withCode('upstream'));

        await expect(driver.status(host, target)).resolves.toEqual({ phase: 'unreachable', detail: 'connect ECONNREFUSED' });
    });

    it('reports idle for a device playing nothing of ours', async () => {
        const { host, driver } = setup();

        await expect(driver.status(host, target)).resolves.toEqual({ phase: 'idle' });
    });

    it('reports buffering, then playing, with the URL the device is on', async () => {
        const { host, device, driver } = setup();
        await driver.play(host, target, request);

        await expect(driver.status(host, target)).resolves.toEqual({ phase: 'buffering', url: request.url });

        device.media = { ...device.media, playerState: 'PLAYING' };
        await expect(driver.status(host, target)).resolves.toEqual({ phase: 'playing', url: request.url });
    });

    it('reads IDLE with no reason as opening while the stream starts, and as stopped once it has had time', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const { host, device, driver } = setup();
        await driver.play(host, target, request);
        device.media = { ...device.media, playerState: 'IDLE' };

        await expect(driver.status(host, target)).resolves.toMatchObject({ phase: 'opening' });

        vi.setSystemTime(Date.now() + CAST_OPENING_GRACE_MS + 1);
        await expect(driver.status(host, target)).resolves.toMatchObject({ phase: 'stopped' });
    });

    it('says why a stream stopped', async () => {
        const { host, device, driver } = setup();
        await driver.play(host, target, request);
        device.media = { ...device.media, playerState: 'IDLE', idleReason: 'ERROR' };

        await expect(driver.status(host, target)).resolves.toEqual({
            phase: 'stopped',
            url: request.url,
            detail: 'the device could not play the stream',
        });
    });

    it('reports stopped, naming the app, when somebody casts something else over the station', async () => {
        const { host, device, driver } = setup();
        await driver.play(host, target, request);
        device.runOther('YouTube');

        await expect(driver.status(host, target)).resolves.toEqual({ phase: 'stopped', detail: 'now showing YouTube' });
    });

    it('stops the media player it started', async () => {
        const { host, device, driver } = setup();
        await driver.play(host, target, request);

        await driver.stop(host, target);

        expect(device.app).toBeUndefined();
        expect(device.requests.at(-1)).toBe('receiver#STOP');
    });

    it('leaves another app alone when asked to stop', async () => {
        const { host, device, driver } = setup();
        device.runOther();

        await driver.stop(host, target);

        expect(device.app?.displayName).toBe('Netflix');
        expect(device.requests).not.toContain('receiver#STOP');
    });

    it('opens a fresh connection after the device hangs up', async () => {
        const { host, driver } = setup();
        await driver.status(host, target);

        host.tlsSockets[0]!.closeFromServer('ECONNRESET');
        await driver.status(host, target);

        expect(host.tlsSockets).toHaveLength(2);
    });

    it('closes a connection that has gone quiet, and answers the device’s own pings', async () => {
        vi.useFakeTimers();
        const { host, device, driver } = setup();
        const status = driver.status(host, target);
        await vi.advanceTimersByTimeAsync(0);
        await status;
        const socket = host.tlsSockets[0]!;

        device.mute = true;
        // The fake answers PING with PONG even muted, which counts as hearing it; go fully silent.
        vi.mocked(socket.send).mockImplementation(() => {});
        await vi.advanceTimersByTimeAsync(CAST_SILENCE_MS + CAST_HEARTBEAT_MS);

        expect(socket.closed).toBe(true);
    });

    it('lets go of every connection on dispose', async () => {
        const { host, driver } = setup();
        await driver.status(host, target);

        driver.dispose();
        await vi.waitFor(() => expect(host.tlsSockets[0]!.closed).toBe(true));
    });
});
