/**
 * What bounds one `host.fetch` once it is on the wire: the headers a redirect drops, `Retry-After`,
 * the deadline a call spends from, and the three caps on the response body a plugin is handed.
 *
 * Split out of `plugin.host.factory.ts` unchanged. The factory decides WHETHER a request may go;
 * this file is what stops one that did from becoming an unbounded socket.
 */
import { PluginError, isPluginError } from '@deadair/plugin-sdk';
import type { PluginManifest } from '@deadair/plugin-sdk';
import { causeText } from '#modules/shared/error.text.js';

/**
 * How long a response body may produce nothing before the host gives up on it.
 *
 * A stalled body is just as effective a hang as a stalled connect, and the
 * fetch deadline cannot cover it: that one ends when the response arrives, and
 * a large body is read long afterwards, sometimes from later invocations
 * entirely. Generous, because it bounds silence rather than total time, and an
 * upstream generating audio genuinely does pause.
 */
export const PLUGIN_BODY_IDLE_TIMEOUT_MS = 30_000;

/**
 * The longest a response body may stay open at all, from the moment the
 * response is handed to the plugin to its last byte.
 *
 * The load-bearing bound of the three, and the reason the other two are not
 * enough. Reading a body is deliberately NOT capped by the invocation that
 * started the request, because a legitimate large body outlives it, so without
 * this a body would be a way to escape the per-invocation deadline entirely and
 * hold a socket forever. The deadline is not removed, it is replaced by a
 * strictly-enforced longer one.
 *
 * Sized above a slow synthesis on CPU rather than above a request, which is
 * what the caller that needs it (speech) actually does.
 */
export const PLUGIN_BODY_LIFETIME_MS = 5 * 60_000;

/**
 * Most bytes one response body may carry.
 *
 * One cap rather than the two this used to have. There was a 5 MiB ceiling on
 * `host.fetch`, which buffered every body into a string, and a 64 MiB one on
 * the separate byte protocol for bodies that could not fit in it. That protocol
 * is gone: a plugin now decides for itself whether to buffer, with
 * `response.text()`, so the only place a single cap can sit is the wire.
 *
 * Unbounded is how a plugin fills a disk, and this is comfortably above a
 * long-form audio render at any bitrate anyone would stream.
 */
export const PLUGIN_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;

/** Dropped when a hop crosses an origin, so a bearer token cannot ride a 302 to a third party. */
export const CREDENTIAL_HEADERS = ['authorization', 'cookie'] as const;

/** Dropped when a redirect rewrites the method to GET and discards the body. */
export const BODY_HEADERS = ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location'] as const;

/** Header names are case-insensitive; the plugin's record keys are whatever it typed. */
export const withoutHeaders = (headers: Record<string, string>, drop: readonly string[]): Record<string, string> =>
    Object.fromEntries(Object.entries(headers).filter(([key]) => !drop.includes(key.toLowerCase())));

/**
 * Says who is calling, when the plugin has not said so itself.
 *
 * Without this the request goes out under undici's default, which a fair number
 * of APIs refuse outright: MusicBrainz requires a User-Agent that identifies
 * the application, and answers a generic one with a 403. Naming the plugin
 * rather than just the station also means an upstream complaining about traffic
 * can say which plugin to turn off.
 *
 * `baseUrl` is deliberately not in here. Some upstreams want a contact URL, and
 * a plugin whose policy requires one should set the whole header itself (a
 * `contact` config field is the usual shape), because the station's own base
 * URL is frequently an internal or loopback address and does not belong in a
 * header sent to every third party.
 */
export const withUserAgent = (headers: Record<string, string>, manifest: PluginManifest): Record<string, string> => {
    if (Object.keys(headers).some(key => key.toLowerCase() === 'user-agent')) return headers;
    return { ...headers, 'user-agent': `${manifest.id}/${manifest.version} (deadair)` };
};

/** `Retry-After` is either delta-seconds or an HTTP-date. Unparseable values mean "do not retry". */
export const parseRetryAfter = (value: string | undefined, nowMs: number): number | undefined => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;

    const seconds = Number(trimmed);
    if (Number.isFinite(seconds)) return seconds <= 0 ? 0 : seconds * 1000;

    const date = Date.parse(trimmed);
    if (Number.isNaN(date)) return undefined;
    return Math.max(0, date - nowMs);
};

/** A live response, plus the two things about the chain that produced it the response cannot say. */
export interface SentResponse {
    response: Response;
    /** The last hop's URL, which is where the response actually came from. */
    url: URL;
    redirected: boolean;
}

/**
 * Let go of a body nobody is going to read.
 *
 * Swallows its own failure on purpose: this is always cleanup on a path that is
 * already returning or already throwing something more interesting, and a cancel
 * that fails because the peer hung up first is the ordinary case rather than
 * news.
 */
export const cancelBody = async (response: Response): Promise<void> => {
    await response.body?.cancel().catch(() => {});
};

/**
 * The controller bounding one egress call: the host's own deadline, plus
 * whatever the plugin passed in.
 *
 * A plain timer rather than `AbortSignal.timeout`, because that one's timer is
 * unref'd and invisible to fake timers, so the deadline would be neither
 * reliable nor testable. One controller rather than `AbortSignal.any` for the
 * same reason the timer is explicit: the caller aborts this itself on a
 * transport failure, and a derived signal has no such handle.
 *
 * `dispose` drops the listener as well as the timer. A plugin's own signal is
 * routinely the invocation's, which outlives any single fetch, so leaving one
 * behind per call is a listener leak on a long background job rather than a
 * theoretical one.
 */
export const egressController = (deadlineAt: number, external?: AbortSignal): { controller: AbortController; dispose: () => void } => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - Date.now()));

    const onExternalAbort = (): void => controller.abort(external?.reason);
    if (external?.aborted) onExternalAbort();
    else external?.addEventListener('abort', onExternalAbort, { once: true });

    return {
        controller,
        dispose: () => {
            clearTimeout(timer);
            external?.removeEventListener('abort', onExternalAbort);
        },
    };
};

/**
 * Races `work` against an idle timer, failing with `onTimeout` if nothing
 * arrives in time.
 *
 * `work` is left running when the timer wins — there is no way to un-issue a
 * pending `reader.read()` — so its eventual rejection is swallowed here. The
 * caller aborts the stream's controller, which is what actually makes that read
 * reject; without the pre-attached catch that rejection would surface as an
 * unhandled one, on a path that has already reported the failure properly.
 */
const withIdleDeadline = async <T>(work: Promise<T>, idleMs: number, onTimeout: () => Error): Promise<T> => {
    work.catch(() => {});

    let timer: NodeJS.Timeout | undefined;
    const idle = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(onTimeout()), idleMs);
    });

    try {
        return await Promise.race([work, idle]);
    } finally {
        clearTimeout(timer);
    }
};

/**
 * Releases whatever a response body is still holding. Registered per plugin so
 * a body cannot outlive the instance that opened it.
 */
export type BodyRelease = (failure?: PluginError) => void;

/** The failure the lifetime cap records when it fires. */
const lifetimeExpired = (manifest: PluginManifest): PluginError =>
    new PluginError(`plugin "${manifest.id}" held a response body open for more than ${PLUGIN_BODY_LIFETIME_MS}ms`).withCode('timeout');

/** The failure the idle deadline records. */
const idleExpired = (manifest: PluginManifest, url: string): PluginError =>
    new PluginError(`plugin "${manifest.id}" response body from ${url} produced nothing for ${PLUGIN_BODY_IDLE_TIMEOUT_MS}ms`).withCode('timeout');

/**
 * The plugin's response body, bounded.
 *
 * This is what is left of the byte protocol. The handles, the sequence numbers,
 * the base64 and the stream table are gone with it, because a `ReadableStream`
 * already is a pull-based stream with backpressure and a cancel. What did NOT
 * go is the reason any of it existed: a body is read outside the deadline that
 * fetched it, so something has to stop it being an unbounded socket. That is
 * the three caps here.
 *
 * Failures reject the read rather than ending the stream quietly, so a caller
 * that ignores errors truncates loudly instead of silently. The first failure
 * wins: a lifetime expiry that fired while a read was parked is the real cause,
 * and the abort landing afterwards is only its echo.
 */
const guardBody = (
    manifest: PluginManifest,
    url: string,
    source: ReadableStream<Uint8Array>,
    controller: AbortController,
    open: Set<BodyRelease>,
): ReadableStream<Uint8Array> => {
    const reader = source.getReader();
    let total = 0;
    let failure: PluginError | undefined;
    let released = false;
    let out: ReadableStreamDefaultController<Uint8Array> | undefined;

    const release: BodyRelease = reason => {
        failure ??= reason;
        if (released) return;
        released = true;
        clearTimeout(lifetimeTimer);
        open.delete(release);
        // Both, because they answer different halves: cancelling the reader
        // ends this stream, and aborting the controller ends the request behind
        // it. Without the abort a cancelled body leaves the socket to time out
        // on its own.
        controller.abort();
        reader.cancel().catch(() => {});

        // Errored rather than merely left to fail on the next pull. A stream
        // keeps a chunk queued ahead of its consumer, so without this a body
        // killed by the lifetime cap or by a dispose hands over one more stale
        // chunk first and only then reports what happened.
        if (failure !== undefined) {
            try {
                out?.error(failure);
            } catch {
                // Already closed or errored, which is not news on a path whose
                // whole job is to make sure it ends up that way.
            }
        }
    };

    // Declared after `release` and referenced from inside it, which is safe
    // because nothing calls `release` until this line has run.
    const lifetimeTimer = setTimeout(() => release(lifetimeExpired(manifest)), PLUGIN_BODY_LIFETIME_MS);
    // Nothing is waiting on this timer; without unref a process holding an idle
    // body would refuse to exit for up to the whole lifetime cap.
    lifetimeTimer.unref?.();
    open.add(release);

    return new ReadableStream<Uint8Array>({
        start(controller) {
            out = controller;
        },
        async pull(controller) {
            // Recorded by whatever killed it: the lifetime timer, or a dispose.
            if (failure !== undefined) throw failure;

            let result: ReadableStreamReadResult<Uint8Array>;
            try {
                result = await withIdleDeadline(reader.read(), PLUGIN_BODY_IDLE_TIMEOUT_MS, () => idleExpired(manifest, url));
            } catch (error) {
                const thrown = isPluginError(error)
                    ? error
                    : new PluginError(`plugin "${manifest.id}" response body from ${url} failed: ${causeText(error)}`, { cause: error }).withCode(
                          'upstream',
                      );
                release(thrown);
                throw failure ?? thrown;
            }

            if (result.done) {
                release();
                controller.close();
                return;
            }

            total += result.value.byteLength;
            if (total > PLUGIN_RESPONSE_MAX_BYTES) {
                const over = new PluginError(
                    `plugin "${manifest.id}" response body from ${url} is over the ${PLUGIN_RESPONSE_MAX_BYTES} byte limit`,
                ).withCode('upstream');
                release(over);
                throw failure ?? over;
            }

            controller.enqueue(result.value);
        },
        cancel() {
            release();
        },
    });
};

/**
 * The response the plugin actually gets: the upstream's status and headers,
 * with its body wrapped in {@link guardBody}.
 *
 * A fresh `Response` rather than the upstream one, because a body cannot be
 * swapped on an existing response. `url` and `redirected` are read-only and
 * blank on a constructed response, so they are redefined: both are part of the
 * contract (`url` is the last hop of the redirect chain, which is what a plugin
 * resolves relative links against) and losing them to a construction detail
 * would be a silent regression.
 *
 * A status that cannot carry a body (204, 304) arrives with `body` already
 * null, and passing null through is also what keeps the `Response` constructor
 * from throwing on exactly those.
 */
export const guardedResponse = (manifest: PluginManifest, sent: SentResponse, controller: AbortController, open: Set<BodyRelease>): Response => {
    const url = sent.url.toString();
    const body = sent.response.body === null ? null : guardBody(manifest, url, sent.response.body, controller, open);

    const response = new Response(body, {
        status: sent.response.status,
        statusText: sent.response.statusText,
        headers: sent.response.headers,
    });

    Object.defineProperty(response, 'url', { value: url });
    Object.defineProperty(response, 'redirected', { value: sent.redirected });

    return response;
};
