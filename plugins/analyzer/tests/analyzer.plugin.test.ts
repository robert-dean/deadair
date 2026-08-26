// The adapter does one thing that is not plumbing: it decides whether an answer from the analyzer
// can be believed. That is where this file spends itself.
//
// Two fields carry the weight, and each has a plausible-looking wrong default. A missing
// `schemaVersion` defaulted to anything makes a payload of unknown shape read as a known one. A
// missing `complete` defaulted to `true` asserts that a truncated download was whole -- which is the
// exact claim the flag exists to stop anyone making, since the host never sees the bytes and cannot
// check it. Neither has a safe default, so both absences are faults.

import { describe, expect, it } from 'vitest';
import { isPluginError, type HostFetchInit, type PluginError } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { AnalyzerPlugin } from '../src/analyzer.plugin.js';
import { ANALYZE_TIMEOUT_MS, JOIN_TIMEOUT_MS } from '../src/analyzer.manifest.js';

const BASE_URL = 'http://analysis.test:9321';

const REF = {
    trackId: 'track-1',
    audioUrl: 'http://shim.test/track/abc?sig=x',
    durationMs: 214_000,
};

/** A well-formed v1 answer. Tests override one field at a time from here. */
const goodBody = () => ({
    schemaVersion: 1,
    analyzer: 'deadair-analysis/0.1.0',
    complete: true,
    durationMs: 213_880,
    data: { cueIn: 180, introEnd: 12_400, outroStart: 198_200, cueOut: 213_600 },
});

interface FakeHostOptions {
    config?: Record<string, unknown>;
    /** Status and body for `/analyze`. */
    analyze?: { status?: number; body?: unknown };
    /** Status and body for `/health`. */
    health?: { status?: number; body?: unknown };
    /**
     * The whole response for `/join`, because that one answers AUDIO.
     *
     * A builder rather than a body, since what the tests turn on is the headers
     * beside the bytes: what the audio IS, and how long it runs.
     */
    join?: () => Response;
}

/** What the sidecar answers a join with: some bytes, a media type and a duration. */
const joinedResponse = (): Response =>
    new Response(new Uint8Array([0x66, 0x4c, 0x61, 0x43]), {
        status: 200,
        headers: { 'content-type': 'audio/flac', 'x-duration-ms': '184320' },
    });

function fakeHost(options: FakeHostOptions = {}) {
    // Recorded locally rather than read off `host.calls`: a test below asserts
    // `timeoutMs`, which `RecordedFetchCall` deliberately leaves out and the
    // shared fake has no reason to carry for every plugin.
    const calls: { url: string; init?: HostFetchInit }[] = [];

    const host: FakePluginHost = createFakePluginHost();

    host.setFetchImpl(async (url: string, init?: HostFetchInit): Promise<Response> => {
        calls.push({ url, init });

        if (url.endsWith('/join')) return (options.join ?? joinedResponse)();

        const chosen = url.endsWith('/analyze') ? options.analyze : options.health;
        const status = chosen?.status ?? 200;
        const body = chosen?.body ?? (url.endsWith('/analyze') ? goodBody() : { status: 'ok', schemaVersion: 1, analyzer: 'deadair-analysis/0.1.0' });

        return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
        });
    });

    host.seedConfig({ baseUrl: BASE_URL, ...options.config });

    return { host, calls };
}

async function started(options: FakeHostOptions = {}) {
    const fake = fakeHost(options);
    const plugin = new AnalyzerPlugin();
    await plugin.init(fake.host);
    return { ...fake, plugin };
}

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
    const error = await promise.then(
        value => {
            throw new Error(`expected a rejection, got ${JSON.stringify(value)}`);
        },
        (thrown: unknown) => thrown,
    );
    expect(isPluginError(error), `expected a PluginError, got ${String(error)}`).toBe(true);
    return (error as PluginError).code;
}

describe('AnalyzerPlugin.analyzeTrack', () => {
    it('posts the url and the claimed duration, and asks for minutes rather than seconds', async () => {
        const { plugin, calls } = await started();
        await plugin.analyzeTrack(REF);

        const call = calls.find(candidate => candidate.url.endsWith('/analyze'));
        expect(JSON.parse((call?.init?.body as string) ?? '{}')).toEqual({ url: REF.audioUrl, durationMs: REF.durationMs });

        // The host's own default is fifteen seconds, which no full decode fits inside. Left on it,
        // every track fails at the same moment and it looks like a broken analyzer.
        expect(call?.init?.timeoutMs).toBe(ANALYZE_TIMEOUT_MS);
    });

    it('passes data through unread, so a newer schema needs no change here', async () => {
        // A v2-shaped payload the adapter has never heard of. It must survive intact: the host
        // stores it as an opaque blob under the version the analyzer reported.
        const body = { ...goodBody(), schemaVersion: 2, data: { ...goodBody().data, bpm: 126.02, downbeats: [1840, 3744] } };
        const { plugin } = await started({ analyze: { body } });

        const result = await plugin.analyzeTrack(REF);

        expect(result.schemaVersion).toBe(2);
        expect(result.data).toEqual(body.data);
    });

    it('keeps the analyzer name for provenance', async () => {
        const { plugin } = await started();
        expect((await plugin.analyzeTrack(REF)).analyzer).toBe('deadair-analysis/0.1.0');
    });

    it('reports an incomplete measurement rather than quietly correcting it', async () => {
        const { plugin } = await started({ analyze: { body: { ...goodBody(), complete: false } } });
        expect((await plugin.analyzeTrack(REF)).complete).toBe(false);
    });

    it('refuses an answer with no `complete`, because there is no safe default for it', async () => {
        const { complete: _dropped, ...withoutComplete } = goodBody();
        const { plugin } = await started({ analyze: { body: withoutComplete } });

        expect(await rejectionCode(plugin.analyzeTrack(REF))).toBe('upstream');
    });

    it('refuses an answer with no `schemaVersion`, so an unknown shape cannot read as a known one', async () => {
        const { schemaVersion: _dropped, ...withoutVersion } = goodBody();
        const { plugin } = await started({ analyze: { body: withoutVersion } });

        expect(await rejectionCode(plugin.analyzeTrack(REF))).toBe('upstream');
    });

    it('refuses an answer with no `data`', async () => {
        const { data: _dropped, ...withoutData } = goodBody();
        const { plugin } = await started({ analyze: { body: withoutData } });

        expect(await rejectionCode(plugin.analyzeTrack(REF))).toBe('upstream');
    });

    it('refuses a body that is not JSON at all, which is what a wrong address answers with', async () => {
        const { plugin } = await started({ analyze: { body: '<html>not an analyzer</html>' } });
        expect(await rejectionCode(plugin.analyzeTrack(REF))).toBe('upstream');
    });

    it("carries the analyzer's own failure code into the message, since the status cannot say which", async () => {
        // 502 covers both "that URL served nothing" and "that URL served a web page", and the
        // operator fixing it needs to know which.
        const { plugin } = await started({
            analyze: { status: 502, body: { error: { code: 'undecodable', message: 'moov atom not found' } } },
        });

        const error = await plugin.analyzeTrack(REF).catch((thrown: unknown) => thrown);
        expect((error as PluginError).code).toBe('upstream');
        expect((error as Error).message).toContain('undecodable');
        expect((error as Error).message).toContain('moov atom not found');
    });

    it('calls an unrecognised failure internal rather than blaming the upstream', async () => {
        const { plugin } = await started({ analyze: { status: 500, body: { error: { code: 'something_new', message: 'x' } } } });
        expect(await rejectionCode(plugin.analyzeTrack(REF))).toBe('internal');
    });

    it('is a config error, not an upstream one, when no URL is set', async () => {
        const { plugin } = await started({ config: { baseUrl: '' } });
        expect(await rejectionCode(plugin.analyzeTrack(REF))).toBe('config');
    });
});

describe('AnalyzerPlugin.join', () => {
    const REQUEST = { parts: [{ url: 'http://api.test/segments/a/audio' }, { url: 'http://api.test/segments/b/audio' }], gapMs: 200 };

    it('posts the parts in order and asks for the trim, which is what makes the gap the gap', async () => {
        const { plugin, calls } = await started();
        await plugin.join(REQUEST);

        const call = calls.find(candidate => candidate.url.endsWith('/join'));
        expect(JSON.parse((call?.init?.body as string) ?? '{}')).toEqual({
            parts: [{ url: REQUEST.parts[0]!.url }, { url: REQUEST.parts[1]!.url }],
            gapMs: 200,
            trim: true,
        });
        expect(call?.init?.timeoutMs).toBe(JOIN_TIMEOUT_MS);
    });

    it('passes a caller that asked for no trim through as it is', async () => {
        const { plugin, calls } = await started();
        await plugin.join({ ...REQUEST, trim: false });

        const call = calls.find(candidate => candidate.url.endsWith('/join'));
        expect(JSON.parse((call?.init?.body as string) ?? '{}').trim).toBe(false);
    });

    it('answers with what the audio is and how long it runs', async () => {
        const { plugin } = await started();
        const joined = await plugin.join(REQUEST);

        // The mime is what the host stores and serves the bytes under, so a wrong one fails as
        // silence rather than as an error anybody sees.
        expect(joined.mime).toBe('audio/flac');
        expect(joined.durationMs).toBe(184_320);
        expect(await new Response(joined.audio).arrayBuffer()).toHaveProperty('byteLength', 4);
    });

    it('says the duration is unknown rather than zero when the analyzer did not report one', async () => {
        const { plugin } = await started({ join: () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/flac' } }) });
        const joined = await plugin.join(REQUEST);

        expect(joined.durationMs).toBeUndefined();
    });

    it('reports an analyzer that has no join as `unsupported`, which is a state and not a fault', async () => {
        // An older analyzer is a perfectly good analyzer. The station reading this has somewhere to
        // go: the production airs as a block of beats, exactly as it did before joining existed.
        const { plugin } = await started({ join: () => new Response('', { status: 404 }) });

        expect(await rejectionCode(plugin.join(REQUEST))).toBe('unsupported');
    });

    it('carries the analyzer own code up for a part it could not fetch', async () => {
        const { plugin } = await started({
            join: () =>
                new Response(JSON.stringify({ error: { code: 'unfetchable', message: 'HTTP 404 from the audio url' } }), {
                    status: 502,
                    headers: { 'content-type': 'application/json' },
                }),
        });

        expect(await rejectionCode(plugin.join(REQUEST))).toBe('upstream');
    });

    it('refuses audio the analyzer would not name, rather than storing bytes under a guess', async () => {
        const { plugin } = await started({ join: () => new Response(new Uint8Array([1]), { headers: { 'content-type': '' } }) });

        expect(await rejectionCode(plugin.join(REQUEST))).toBe('upstream');
    });

    it('is a config error, not an upstream one, when no URL is set', async () => {
        const { plugin } = await started({ config: { baseUrl: '' } });
        expect(await rejectionCode(plugin.join(REQUEST))).toBe('config');
    });
});

describe('AnalyzerPlugin.testConnection', () => {
    it('reports the analyzer it reached', async () => {
        const { plugin } = await started();
        const result = await plugin.testConnection();

        expect(result.ok).toBe(true);
        expect(result.message).toContain('deadair-analysis/0.1.0');
    });

    it('names a schema mismatch, because this is the one moment an operator is looking', async () => {
        // Not refused: the host stores what it is told and its own staleness rule decides. But
        // silently writing rows nothing can read is worth saying out loud.
        const { plugin } = await started({ health: { body: { status: 'ok', schemaVersion: 9, analyzer: 'other/1.0' } } });
        const result = await plugin.testConnection();

        expect(result.ok).toBe(true);
        expect(result.message).toMatch(/v9/);
        expect(result.message).toMatch(/stored and then ignored/);
    });

    it('repeats the decode ceiling, so asking the station for more than it is visible here', async () => {
        const { plugin } = await started({
            health: { body: { status: 'ok', schemaVersion: 1, analyzer: 'deadair-analysis/0.1.0', maxConcurrent: 4 } },
        });
        const result = await plugin.testConnection();

        expect(result.ok).toBe(true);
        expect(result.message).toContain('up to 4 at once');
    });

    it('says nothing about a ceiling an analyzer did not report, since anything answering these two endpoints is one', async () => {
        // The default health body in `fakeHost` carries no `maxConcurrent`: the field is newer than
        // the contract, and inventing a number for an analyzer that named none would be a claim.
        const { plugin } = await started();
        const result = await plugin.testConnection();

        expect(result.message).not.toMatch(/at once/);
    });

    it('says so when there is no URL set at all', async () => {
        const { plugin } = await started({ config: { baseUrl: '' } });
        expect(await plugin.testConnection()).toEqual({ ok: false, message: 'No analyzer URL set.' });
    });

    it('reports a non-2xx as unreachable rather than throwing', async () => {
        const { plugin } = await started({ health: { status: 503 } });
        const result = await plugin.testConnection();

        expect(result.ok).toBe(false);
        expect(result.message).toContain('503');
    });
});
