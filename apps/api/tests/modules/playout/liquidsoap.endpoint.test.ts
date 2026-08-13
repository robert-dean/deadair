// The probe decides whether the station has anywhere to air, and it runs again after every failed
// control call — so what it costs when it is wrong is not one slow request, it is the lease going
// unrenewed while it finds out. Both candidates below are RIGHT in one environment and unreachable
// in the other, which is why neither can be tried first.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { controlCandidates, LiquidsoapEndpoint } from '../../../src/modules/playout/liquidsoap.endpoint.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const config = (values: Record<string, unknown> = {}): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) }) as unknown as AppConfig;

function build(values: Record<string, unknown> = {}) {
    const endpoint = new LiquidsoapEndpoint(config(values), logger);
    endpoint.useSecret('a-secret');
    return endpoint;
}

/** Answers for whichever candidates are named, and refuses everything else. */
const answering = (...alive: string[]) => {
    const asked: string[] = [];
    const impl = vi.fn(async (url: string | URL) => {
        const target = String(url);
        asked.push(target);
        if (!alive.some(base => target.startsWith(base))) throw new Error('connect ECONNREFUSED');
        return new Response(JSON.stringify({ queued: 0, ready: false }), { status: 200 });
    });
    return { impl: impl as unknown as typeof fetch, asked };
};

/** Answers 401 at whichever candidates are named: a live engine refusing our secret. */
const refusing = (...alive: string[]) => {
    const asked: string[] = [];
    const impl = vi.fn(async (url: string | URL) => {
        const target = String(url);
        asked.push(target);
        if (!alive.some(base => target.startsWith(base))) throw new Error('connect ECONNREFUSED');
        return new Response('unauthorized', { status: 401 });
    });
    return { impl: impl as unknown as typeof fetch, asked };
};

const [COMPOSE, LOOPBACK] = controlCandidates('8005') as [string, string];

describe('LiquidsoapEndpoint.resolve', () => {
    it('finds the stream when only the compose name answers, which is the case in a container', async () => {
        const { impl } = answering(COMPOSE);
        vi.stubGlobal('fetch', impl);
        try {
            expect(await build().resolve()).toBe(COMPOSE);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('finds it when only loopback answers, which is the case for a host `pnpm dev`', async () => {
        const { impl } = answering(LOOPBACK);
        vi.stubGlobal('fetch', impl);
        try {
            expect(await build().resolve()).toBe(LOOPBACK);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('asks both at once rather than paying for the dead one first', async () => {
        // The measured cost of asking in sequence: in one of the two environments the first
        // candidate cannot resolve at all, so every probe spent its whole budget before reaching
        // the address that was going to answer — and the app re-probes after any failed call.
        const { impl, asked } = answering(LOOPBACK);
        vi.stubGlobal('fetch', impl);
        try {
            await build().resolve();

            expect(asked).toHaveLength(2);
            expect(asked.some(url => url.startsWith(COMPOSE))).toBe(true);
            expect(asked.some(url => url.startsWith(LOOPBACK))).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('still prefers the declared order when both answer', async () => {
        // Asked together, answered in whatever order the network felt like. The choice stays the
        // list's rather than the race's, so a stack where both addresses work is not a coin toss.
        const { impl } = answering(COMPOSE, LOOPBACK);
        vi.stubGlobal('fetch', impl);
        try {
            expect(await build().resolve()).toBe(COMPOSE);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('answers with nothing when neither is there, and says so once', async () => {
        const { impl } = answering();
        vi.stubGlobal('fetch', impl);
        try {
            const endpoint = build();

            expect(await endpoint.resolve()).toBeUndefined();
            expect(await endpoint.resolve()).toBeUndefined();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('does not probe again inside the backoff window, whatever calls it', async () => {
        // What this cost when it was missing: the probe is reached from every call, so a
        // process that could not authenticate re-probed as fast as it was asked — measured at
        // twenty requests a second into a harbor that then could not answer anybody else.
        const { impl, asked } = answering();
        vi.stubGlobal('fetch', impl);
        try {
            const endpoint = build();

            await endpoint.resolve();
            await endpoint.resolve();
            await endpoint.resolve();

            expect(asked).toHaveLength(2);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('probes again once the window is past, so a stream coming up is still found', async () => {
        const { impl, asked } = answering();
        vi.stubGlobal('fetch', impl);
        try {
            const endpoint = build();

            await endpoint.resolve();
            await endpoint.resolve(Date.now() + 10_000);

            expect(asked).toHaveLength(4);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('returns a pinned override without probing at all', async () => {
        // What `.env` now sets on this install: an override is not a guess, so it is never probed
        // and never invalidated. Nothing should reach the network here.
        const { impl, asked } = answering(LOOPBACK);
        vi.stubGlobal('fetch', impl);
        try {
            const endpoint = build({ LIQUIDSOAP_CONTROL_URL: 'http://127.0.0.1:8005/' });

            expect(await endpoint.resolve()).toBe('http://127.0.0.1:8005');
            expect(asked).toHaveLength(0);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
