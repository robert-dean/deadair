import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPluginError, type HostFetchInit, type OutputPlayRequest } from '@deadair/plugin-sdk';
import { createFakePluginHost, fakeHostFetchResponse } from '@deadair/plugin-sdk/testing';

import type { SpeakerTarget } from '../../../src/drivers/speaker.driver.js';
import { descriptionUrl, parseDescription, sinkContentTypes } from '../../../src/drivers/upnp/upnp.device.js';
import { UPNP_OPENING_GRACE_MS, UpnpDriver, didl, fromTransportUri, sonosUri } from '../../../src/drivers/upnp/upnp.driver.js';
import { text, unescapeXml } from '../../../src/drivers/xml.js';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const RECEIVER = 'http://192.168.1.176:44667/description.xml';

const request: OutputPlayRequest = {
    deviceId: 'upnp:x',
    url: 'https://radio.example.com/live.mp3',
    contentType: 'audio/mpeg',
    metadata: { title: 'deadair & friends', subtitle: 'The late show', artworkUrl: 'https://radio.example.com/logo.png' },
};

/**
 * A renderer played from the test: it serves a description and answers AVTransport and
 * ConnectionManager actions the way the receiver and the television on the bench did, keeping the
 * transport's state between calls.
 */
class FakeRenderer {
    state = 'NO_MEDIA_PRESENT';
    uri = '';
    metadata = '';
    readonly actions: string[] = [];
    /** Actions to refuse with a UPnP fault. */
    readonly refuse = new Set<string>();
    down = false;

    constructor(
        private readonly description: string,
        private readonly protocol = fixture('receiver.protocol.xml'),
    ) {}

    handle = async (url: string, init?: HostFetchInit): Promise<Response> => {
        if (this.down) throw new Error('connect EHOSTUNREACH');
        if (init?.method !== 'POST') return fakeHostFetchResponse({ body: this.description, headers: { 'content-type': 'text/xml' }, url });

        const action = (init.headers?.soapaction ?? '').replace(/"/g, '').split('#')[1] ?? '';
        this.actions.push(action);
        if (this.refuse.has(action)) {
            return fakeHostFetchResponse({
                status: 500,
                body: '<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>714</errorCode><errorDescription>Illegal MIME-type</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>',
            });
        }

        const body = init.body ?? '';
        switch (action) {
            case 'GetProtocolInfo':
                return this.reply(this.protocol);
            case 'SetAVTransportURI':
                this.uri = unescapeXml(text(body, 'CurrentURI') ?? '');
                this.metadata = text(body, 'CurrentURIMetaData') ?? '';
                this.state = 'STOPPED';
                return this.reply('<u:SetAVTransportURIResponse/>');
            case 'Play':
                this.state = 'TRANSITIONING';
                return this.reply('<u:PlayResponse/>');
            case 'Stop':
                this.state = 'STOPPED';
                return this.reply('<u:StopResponse/>');
            case 'GetTransportInfo':
                return this.reply(
                    `<u:GetTransportInfoResponse><CurrentTransportState>${this.state}</CurrentTransportState></u:GetTransportInfoResponse>`,
                );
            case 'GetMediaInfo':
                return this.reply(`<u:GetMediaInfoResponse><CurrentURI>${this.uri.replace(/&/g, '&amp;')}</CurrentURI></u:GetMediaInfoResponse>`);
            default:
                return fakeHostFetchResponse({ status: 500, body: '' });
        }
    };

    private reply(inner: string): Response {
        return fakeHostFetchResponse({
            body: `<?xml version="1.0"?><s:Envelope><s:Body>${inner}</s:Body></s:Envelope>`,
            headers: { 'content-type': 'text/xml' },
        });
    }
}

function setup(description = fixture('receiver.description.xml'), address = RECEIVER, protocol?: string) {
    const host = createFakePluginHost();
    const renderer = new FakeRenderer(description, protocol);
    host.setFetchImpl(renderer.handle);
    const target: SpeakerTarget = { id: `upnp:${address}`, name: 'Receiver', address };
    return { host, renderer, target, driver: new UpnpDriver() };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('descriptionUrl', () => {
    it('uses a full URL as it is, since most renderers choose their own port and path', () => {
        expect(descriptionUrl(RECEIVER)).toBe(RECEIVER);
    });

    it('takes a bare address to be a Sonos, whose description is always in the same place', () => {
        expect(descriptionUrl('192.168.1.30')).toBe('http://192.168.1.30:1400/xml/device_description.xml');
        expect(descriptionUrl('192.168.1.30:1401')).toBe('http://192.168.1.30:1401/xml/device_description.xml');
    });
});

describe('parseDescription', () => {
    it('finds the AVTransport and ConnectionManager at the versions the device declares', () => {
        const renderer = parseDescription(fixture('receiver.description.xml'), RECEIVER);

        expect(renderer).toEqual({
            avTransport: {
                type: 'urn:schemas-upnp-org:service:AVTransport:2',
                controlUrl: 'http://192.168.1.176:44667/Control/LibRygelRenderer/RygelAVTransport',
            },
            connectionManager: {
                type: 'urn:schemas-upnp-org:service:ConnectionManager:2',
                controlUrl: 'http://192.168.1.176:44667/Control/LibRygelRenderer/RygelSinkConnectionManager',
            },
            friendlyName: 'Living room receiver',
            manufacturer: 'Anthem',
            model: 'MRX 740',
            sonos: false,
        });
    });

    it('reads a television whose description is laid out over several lines, unescaping its name', () => {
        const renderer = parseDescription(fixture('television.description.xml'), 'http://192.168.1.56:9197/dmr');

        expect(renderer.friendlyName).toBe('50" The Frame');
        expect(renderer.avTransport.controlUrl).toBe('http://192.168.1.56:9197/upnp/control/AVTransport1');
    });

    it('recognises a Sonos, whose renderer is a device nested inside its own', () => {
        const renderer = parseDescription(fixture('sonos.description.xml'), 'http://192.168.1.30:1400/xml/device_description.xml');

        expect(renderer.sonos).toBe(true);
        expect(renderer.avTransport.controlUrl).toBe('http://192.168.1.30:1400/MediaRenderer/AVTransport/Control');
    });

    it('refuses a device with no AVTransport, which is a server rather than a renderer', () => {
        expect(() => parseDescription('<root><device><serviceList></serviceList></device></root>', RECEIVER)).toThrow(/not a media renderer/);
    });
});

describe('sinkContentTypes', () => {
    it("reads the receiver's list, folding the names devices give AAC to the station's", () => {
        const types = sinkContentTypes(fixture('receiver.protocol.xml'));

        expect(types).toEqual(expect.arrayContaining(['audio/mpeg', 'audio/aac', 'audio/ogg', 'audio/flac']));
        expect(types).not.toContain('audio/x-aac');
    });

    it('keeps only what a stream can be, leaving out the pictures and documents a renderer also shows', () => {
        const types = sinkContentTypes(fixture('television.protocol.xml'));

        expect(types.every(type => type.startsWith('audio/') || type === 'application/vnd.apple.mpegurl')).toBe(true);
    });

    it("reads the television's, which names AAC only as ADTS", () => {
        expect(sinkContentTypes(fixture('television.protocol.xml'))).toEqual(expect.arrayContaining(['audio/mpeg', 'audio/aac']));
    });
});

describe('Sonos URIs', () => {
    it('puts a plain-HTTP stream under the radio scheme, and takes it back off', () => {
        expect(sonosUri('http://radio.example.com/live.mp3')).toBe('x-rincon-mp3radio://radio.example.com/live.mp3');
        expect(fromTransportUri('x-rincon-mp3radio://radio.example.com/live.mp3')).toBe('http://radio.example.com/live.mp3');
    });

    it('leaves an HTTPS stream as it is', () => {
        expect(sonosUri('https://radio.example.com/live.mp3')).toBe('https://radio.example.com/live.mp3');
    });
});

describe('didl', () => {
    it('escapes what it carries, so a title with an ampersand is still a document', () => {
        const metadata = didl(request, request.url);

        expect(metadata).toContain('<dc:title>deadair &amp; friends</dc:title>');
        expect(metadata).toContain('<res protocolInfo="http-get:*:audio/mpeg:*">https://radio.example.com/live.mp3</res>');
        expect(metadata).toContain('object.item.audioItem.audioBroadcast');
    });
});

describe('UpnpDriver', () => {
    it('describes a receiver by what it says it plays, MP3 first, with its make and model', async () => {
        const { host, target, driver } = setup();

        const traits = await driver.describe(host, target);

        expect(traits.accepts[0]).toBe('audio/mpeg');
        expect(traits.accepts).toContain('audio/aac');
        expect(traits).toMatchObject({ followsMetadata: false, model: 'Anthem MRX 740' });
    });

    it('describes a Sonos as MP3 and AAC without asking it', async () => {
        const { host, target, driver, renderer } = setup(fixture('sonos.description.xml'), '192.168.1.30');

        await expect(driver.describe(host, target)).resolves.toMatchObject({ accepts: ['audio/mpeg', 'audio/aac'] });
        expect(renderer.actions).not.toContain('GetProtocolInfo');
    });

    it('still describes a renderer that does not answer, as MP3', async () => {
        const { host, target, driver, renderer } = setup();
        renderer.down = true;

        await expect(driver.describe(host, target)).resolves.toEqual({ accepts: ['audio/mpeg'], followsMetadata: false });
    });

    it('sets the stream with its metadata, then plays it', async () => {
        const { host, target, driver, renderer } = setup();

        await driver.play(host, target, request);

        expect(renderer.actions).toEqual(['SetAVTransportURI', 'Play']);
        expect(renderer.uri).toBe(request.url);
        // One level of escaping undone by reading the SOAP argument, which leaves the DIDL's own.
        expect(renderer.metadata).toContain('<dc:title>deadair &amp; friends</dc:title>');
    });

    it('hands a Sonos a plain-HTTP stream under its radio scheme', async () => {
        const { host, target, driver, renderer } = setup(fixture('sonos.description.xml'), '192.168.1.30');

        await driver.play(host, target, { ...request, url: 'http://radio.example.com/live.mp3' });

        expect(renderer.uri).toBe('x-rincon-mp3radio://radio.example.com/live.mp3');
    });

    it("names the device's own refusal when it will not take the stream", async () => {
        const { host, target, driver, renderer } = setup();
        renderer.refuse.add('SetAVTransportURI');

        const error = await driver.play(host, target, request).catch((caught: unknown) => caught);

        expect(isPluginError(error) && error.code).toBe('upstream');
        expect((error as Error).message).toContain('Illegal MIME-type (714)');
    });

    it('reports the transport as an output phase, with the URL it is on', async () => {
        const { host, target, driver, renderer } = setup();
        await driver.play(host, target, request);

        await expect(driver.status(host, target)).resolves.toEqual({ phase: 'buffering', url: request.url });
        renderer.state = 'PLAYING';
        await expect(driver.status(host, target)).resolves.toEqual({ phase: 'playing', url: request.url });
        renderer.state = 'PAUSED_PLAYBACK';
        await expect(driver.status(host, target)).resolves.toMatchObject({ phase: 'stopped', detail: 'paused on the device' });
    });

    it('reads STOPPED as starting just after a play, and as stopped once it has had time', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const { host, target, driver, renderer } = setup();
        await driver.play(host, target, request);
        renderer.state = 'STOPPED';

        await expect(driver.status(host, target)).resolves.toMatchObject({ phase: 'opening' });
        vi.setSystemTime(Date.now() + UPNP_OPENING_GRACE_MS + 1);
        await expect(driver.status(host, target)).resolves.toEqual({ phase: 'stopped', url: request.url });
    });

    it('maps a Sonos radio URI back to the URL the station handed it', async () => {
        const { host, target, driver, renderer } = setup(fixture('sonos.description.xml'), '192.168.1.30');
        await driver.play(host, target, { ...request, url: 'http://radio.example.com/live.mp3' });
        renderer.state = 'PLAYING';

        await expect(driver.status(host, target)).resolves.toMatchObject({ url: 'http://radio.example.com/live.mp3' });
    });

    it('reports idle for a renderer with nothing loaded, and unreachable for one that does not answer', async () => {
        const { host, target, driver, renderer } = setup();

        await expect(driver.status(host, target)).resolves.toEqual({ phase: 'idle' });
        renderer.down = true;
        await expect(driver.status(host, target)).resolves.toMatchObject({ phase: 'unreachable' });
    });

    it('stops the stream it started', async () => {
        const { host, target, driver, renderer } = setup();
        await driver.play(host, target, request);

        await driver.stop(host, target);

        expect(renderer.actions.at(-1)).toBe('Stop');
    });

    it('leaves something else alone that somebody put on the receiver since', async () => {
        const { host, target, driver, renderer } = setup();
        await driver.play(host, target, request);
        renderer.uri = 'http://nas.local/album.flac';

        await driver.stop(host, target);

        expect(renderer.actions).not.toContain('Stop');
    });

    it('reads the description again after a call fails, since the device may have moved', async () => {
        const { host, target, driver, renderer } = setup();
        await driver.status(host, target);
        renderer.down = true;
        await driver.status(host, target);
        renderer.down = false;

        await driver.status(host, target);

        expect(host.calls.filter(call => call.method !== 'POST')).toHaveLength(2);
    });
});
