import { createReadStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { CAPTURE_FORMATS, type PlayerConfig } from './config.ts';
import { startCapture, sinkExists } from './capture.ts';
import { PlaybackRefused, playToEnd, type PlayerHandle } from './player.ts';
import { TOKEN_PARAM, verifyToken } from './token.ts';
import { probeWidevine, type WidevineStatus } from './browser.ts';
import type { CdpClient } from './cdp.ts';

/**
 * Four endpoints, mirroring `stream/spotify-shim`'s shape where they do the same job.
 *
 * ```
 * GET /health           → is this container able to play anything, and does it know who it is
 * GET /widevine         → the CDM probe on its own, for a one-line answer in CI
 * GET /selftest         → capture a known tone and report what came back. No Apple account needed
 * GET /track/{id}?t=    → one record, captured in real time, as audio/flac
 * ```
 *
 * `/selftest` is the endpoint this container was built around rather than an afterthought. Three of
 * the four things that can go wrong here — no CDM, no sink, no encoder — are provable on any machine
 * by anyone, and only the fourth needs a subscription. An acceptance test an operator cannot run is
 * not an acceptance test.
 */

/** How long one record may hold the browser, over its own duration. */
const START_TIMEOUT_MS = 45_000;
const STALL_MS = 20_000;

export interface ServerDeps {
    readonly config: PlayerConfig;
    readonly client: CdpClient;
    readonly session: string;
    readonly player: PlayerHandle;
    readonly log: (message: string, detail?: unknown) => void;
    readonly now?: () => number;
}

/**
 * One browser, one record at a time.
 *
 * Not a pool: a second Chrome doubles the memory and the second capture would be recording the same
 * sink as the first, so the lock is the design rather than a limitation of it. The wait is long
 * (`queueMs`) because the caller is `TrackAudioService` warming a cache, which would rather wait
 * fifteen minutes than mark a record uncached — and it is bounded because a browser that has hung
 * must not take every later fetch down with it.
 */
class OnePlayer {
    private busy: Promise<unknown> = Promise.resolve();

    async run<T>(waitMs: number, work: () => Promise<T>): Promise<T> {
        const queued = this.busy;
        let release = (): void => {};
        this.busy = new Promise<void>(resolve => (release = resolve));

        const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('the player is busy with another record')), waitMs));
        try {
            await Promise.race([queued, timeout]);
            return await work();
        } finally {
            release();
        }
    }
}

export function createPlayerServer(deps: ServerDeps): Server {
    const { config, log } = deps;
    const now = deps.now ?? Date.now;
    const lock = new OnePlayer();

    return createServer((request, response) => {
        void handle(request, response).catch(error => {
            log('request failed', error instanceof Error ? error.message : String(error));
            if (!response.headersSent) json(response, 500, { error: 'internal' });
            else response.end();
        });
    });

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url = new URL(request.url ?? '/', 'http://player.invalid');

        if (request.method !== 'GET') return json(response, 405, { error: 'method not allowed' });
        if (url.pathname === '/health') return json(response, 200, await health());
        if (url.pathname === '/widevine') return json(response, 200, await widevine());
        if (url.pathname === '/selftest') return selftest(response);

        const track = /^\/track\/([^/]+)$/.exec(url.pathname);
        if (track !== null) return serveTrack(decodeURIComponent(track[1]!), url, response);

        return json(response, 404, { error: 'no such endpoint' });
    }

    async function widevine(): Promise<WidevineStatus> {
        return probeWidevine(deps.client, deps.session);
    }

    /**
     * Everything that has to be true before a record can be captured, each answered separately.
     *
     * One boolean would be useless here: "not ready" has four causes with four different fixes, and
     * the one an operator hits most (not signed in) is the one that looks least like a fault.
     */
    async function health(): Promise<Record<string, unknown>> {
        const [cdm, sink, authorized] = await Promise.all([widevine(), sinkExists(config.sink), deps.player.authorized().catch(() => false)]);
        // `ensure` rather than a read, so asking after the health of a container whose page has just
        // finished loading also fixes it. A report that says "broken" about something it could have
        // repaired by asking is a worse report.
        const recorder = await deps.player
            .ensure()
            .then(result => result.installed)
            .catch(() => false);

        return {
            ok: cdm.available && sink && authorized && recorder,
            widevine: cdm,
            sink: { name: config.sink, present: sink },
            recorder,
            authorized,
            format: config.format,
            signing: config.secret === '' ? 'no bridge secret: every fetch will be refused' : 'configured',
        };
    }

    /**
     * Play a locally generated tone through the page and capture it.
     *
     * The tone is generated by the page itself with an oscillator — no file to ship, nothing to fetch,
     * no network, no Apple account and no subscription. What it proves is the whole chain below
     * MusicKit: audio played in this browser reaches the sink, ffmpeg records the sink, and the file
     * that comes back is the size three seconds of audio should be. A silent result is the exact
     * failure a real record would hit, and it is the one this container is most likely to have — a
     * Chrome playing into a default sink that is not the one being recorded produces a perfectly valid
     * file of nothing.
     */
    async function selftest(response: ServerResponse): Promise<void> {
        const path = join(config.captureDir, `selftest-${now()}.${config.format}`);
        await mkdir(config.captureDir, { recursive: true });

        try {
            const result = await lock.run(5_000, async () => {
                const capture = startCapture({ sink: config.sink, format: config.format, path, log });
                try {
                    // A three-second 440Hz tone, at a quarter gain so a clipped capture is still
                    // distinguishable from a loud one.
                    await deps.client.evaluate(
                        deps.session,
                        `(async () => {
                            const ctx = new (window.AudioContext || window.webkitAudioContext)();
                            await ctx.resume();
                            const osc = ctx.createOscillator();
                            const gain = ctx.createGain();
                            osc.frequency.value = 440;
                            gain.gain.value = 0.25;
                            osc.connect(gain).connect(ctx.destination);
                            osc.start();
                            await new Promise(r => setTimeout(r, 3000));
                            osc.stop();
                            await ctx.close();
                            return true;
                        })()`,
                    );
                    return await capture.finish();
                } catch (error) {
                    await capture.abandon();
                    throw error;
                }
            });

            json(response, 200, {
                ok: result.bytes > 0,
                bytes: result.bytes,
                // A tone that reached the sink is tens of kilobytes at least. A file of a few hundred
                // bytes is a valid container holding nothing, which is the failure worth naming.
                verdict: result.bytes > 20_000 ? 'audio reached the sink' : 'the file is too small to be three seconds of tone',
            });
            await unlink(result.path).catch(() => undefined);
        } catch (error) {
            json(response, 503, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    }

    async function serveTrack(catalogId: string, url: URL, response: ServerResponse): Promise<void> {
        const refusal = verifyToken(config.secret, catalogId, url.searchParams.get(TOKEN_PARAM) ?? undefined, now());
        if (refusal !== undefined) {
            log('refused a fetch', { catalogId, refusal });
            return json(response, 401, { error: refusal });
        }

        const path = join(config.captureDir, `${catalogId}-${now()}.${config.format}`);
        await mkdir(config.captureDir, { recursive: true });

        let captured: { path: string; bytes: number };
        try {
            captured = await lock.run(config.queueMs, async () => {
                const capture = startCapture({ sink: config.sink, format: config.format, path, log });
                try {
                    await deps.player.start(catalogId, START_TIMEOUT_MS);
                    const played = await playToEnd(deps.player, { slackMs: config.slackMs, stallMs: STALL_MS });
                    const result = await capture.finish();
                    log('captured a record', { catalogId, title: played.title, durationMs: played.durationMs, bytes: result.bytes });
                    return result;
                } catch (error) {
                    await capture.abandon();
                    throw error;
                } finally {
                    await deps.player.stop();
                }
            });
        } catch (error) {
            // 410 is the one status with a meaning agreed with the app: `TrackAudioService` turns it
            // into `UnplayableCopy` and stops asking about this binding. Everything else is a failure
            // it will back off and retry, which is the right answer for a browser having a bad day.
            const unplayable = error instanceof PlaybackRefused && error.unplayable;
            const message = error instanceof Error ? error.message : String(error);
            log('could not capture a record', { catalogId, message, unplayable });
            return json(response, unplayable ? 410 : 502, { error: message });
        }

        response.writeHead(200, {
            'content-type': CAPTURE_FORMATS[config.format].contentType,
            'content-length': String(captured.bytes),
            'cache-control': 'no-store',
        });
        const file = createReadStream(captured.path);
        file.pipe(response);
        // Deleted once it has gone out: the app is caching it, so a second copy here is the container
        // slowly filling its own tmpfs with records nobody will ask it for again.
        file.on('close', () => void unlink(captured.path).catch(() => undefined));
    }
}

function json(response: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) });
    response.end(payload);
}
