import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPluginError, type HostFetchInit, type OutputPlayRequest } from '@deadair/plugin-sdk';
import { createFakePluginHost, fakeHostFetchResponse } from '@deadair/plugin-sdk/testing';

import { BluOsDriver, bluosBase, match, phaseOf, stopFirst } from '../../../src/drivers/bluos/bluos.driver.js';
import type { SpeakerTarget } from '../../../src/drivers/speaker.driver.js';
import { text } from '../../../src/drivers/xml.js';

// The fixtures are the desktop app's, several of them measured against a real M10 V2.
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const OURS = 'https://radio.example.com/live.mp3';
const target: SpeakerTarget = { id: 'bluos:192.168.1.40', name: 'Office', address: '192.168.1.40' };

const request: OutputPlayRequest = {
    deviceId: target.id,
    url: OURS,
    contentType: 'audio/mpeg',
    metadata: { title: 'deadair', artworkUrl: 'https://radio.example.com/logo.png' },
};

/** A player whose `/Status` the test sets, recording every path it is asked for. */
function player(status = fixture('status-quiet.xml')) {
    const host = createFakePluginHost();
    const state = { status, down: false, paths: [] as string[] };
    host.setFetchImpl(async (url: string, _init?: HostFetchInit) => {
        if (state.down) throw new Error('connect EHOSTUNREACH');
        const path = url.replace('http://192.168.1.40:11000/', '');
        state.paths.push(path);
        if (path === 'Status') return fakeHostFetchResponse({ body: state.status, headers: { 'content-type': 'text/xml' } });
        if (path === 'SyncStatus') return fakeHostFetchResponse({ body: fixture('syncstatus.xml'), headers: { 'content-type': 'text/xml' } });
        return fakeHostFetchResponse({ body: fixture('state.xml'), headers: { 'content-type': 'text/xml' } });
    });
    return { host, state, driver: new BluOsDriver() };
}

describe('bluosBase', () => {
    it.each([
        ['192.168.1.40', 'http://192.168.1.40:11000'],
        ['192.168.1.40:11010', 'http://192.168.1.40:11010'],
        ['http://office.local:11000/Status', 'http://office.local:11000'],
    ])('reads %s as %s', (address, base) => {
        expect(bluosBase(address)).toBe(base);
    });
});

describe('match and stopFirst', () => {
    it("reads a station filed under TuneIn as ours, and a Deezer track as somebody else's", () => {
        expect(match(`TuneIn:${OURS}`, OURS)).toBe('ours');
        expect(match('Deezer:142986206', OURS)).toBe('other');
        expect(match(undefined, OURS)).toBe('absent');
    });

    it('stops first only when the player is on our stream and not already stopped', () => {
        expect(stopFirst('pause', 'ours')).toBe(true);
        expect(stopFirst('stop', 'ours')).toBe(false);
        expect(stopFirst('stream', 'other')).toBe(false);
    });
});

describe('phaseOf', () => {
    const read = (name: string) => {
        const status = fixture(name);
        const secs = text(status, 'secs');
        return phaseOf(text(status, 'state'), secs === undefined ? undefined : Number(secs), text(status, 'streamUrl'));
    };

    it('reads the measured status of a stream starting as opening', () => {
        expect(read('status-connecting.xml')).toEqual({ phase: 'opening', url: OURS });
    });

    it('reads a stream with seconds on the clock as playing', () => {
        expect(read('status-stream-measured.xml')).toEqual({ phase: 'playing', url: OURS });
    });

    it('unwraps the TuneIn prefix, so the URL matches the one the station handed over', () => {
        expect(read('status-stream.xml')).toEqual({ phase: 'playing', url: OURS });
    });

    it("reports another source's pause as stopped on that source's URL", () => {
        expect(read('status-another-source.xml')).toMatchObject({ phase: 'stopped', url: 'Deezer:142986206' });
    });

    it('reads a player sitting with nothing on as idle', () => {
        expect(read('status-quiet.xml')).toEqual({ phase: 'idle' });
    });

    it('reads a stream with no seconds yet as buffering', () => {
        expect(phaseOf('stream', 0, OURS)).toEqual({ phase: 'buffering', url: OURS });
    });
});

describe('BluOsDriver', () => {
    it('describes a player by its brand and model', async () => {
        const { host, driver } = player();

        await expect(driver.describe(host, target)).resolves.toEqual({
            accepts: ['audio/mpeg', 'audio/aac'],
            followsMetadata: false,
            model: 'NAD M10 V2',
        });
    });

    it('plays the stream with its title and artwork, without a stop when nothing of ours is on', async () => {
        const { host, state, driver } = player();

        await driver.play(host, target, request);

        expect(state.paths).toEqual([
            'Status',
            `Play?url=${encodeURIComponent(OURS)}&title1=deadair&image=${encodeURIComponent('https://radio.example.com/logo.png')}`,
        ]);
    });

    it('stops first when the player is already on our stream, since /Play on the same URL does nothing', async () => {
        const { host, state, driver } = player(fixture('status-stream-measured.xml'));

        await driver.play(host, target, request);

        expect(state.paths.slice(0, 2)).toEqual(['Status', 'Stop']);
    });

    it('stops our stream, and leaves another source alone', async () => {
        const ours = player();
        await ours.driver.play(ours.host, target, request);
        ours.state.status = fixture('status-stream-measured.xml');
        await ours.driver.stop(ours.host, target);
        expect(ours.state.paths.at(-1)).toBe('Stop');

        const other = player();
        await other.driver.play(other.host, target, request);
        other.state.status = fixture('status-another-source.xml');
        await other.driver.stop(other.host, target);
        expect(other.state.paths).not.toContain('Stop');
    });

    it('answers unreachable for a player that does not answer', async () => {
        const { host, state, driver } = player();
        state.down = true;

        await expect(driver.status(host, target)).resolves.toMatchObject({ phase: 'unreachable' });
    });

    it('names the refusal when the player answers /Play with an error', async () => {
        const host = createFakePluginHost();
        host.setFetchImpl(async url =>
            fakeHostFetchResponse({ body: url.endsWith('/Status') ? fixture('status-quiet.xml') : '<error>Unsupported stream</error>' }),
        );

        const error = await new BluOsDriver().play(host, target, request).catch((caught: unknown) => caught);

        expect(isPluginError(error) && error.code).toBe('upstream');
        expect((error as Error).message).toContain('Unsupported stream');
    });
});
