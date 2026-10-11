// A scripted Pandora for the tests: the tuner's two sign-ins, and the web API answered per endpoint.
// It decrypts what the plugin encrypts, so a test can assert on what was actually sent.

import { readFileSync } from 'node:fs';

import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { Blowfish } from '../src/pandora.blowfish.js';
import { PARTNER } from '../src/pandora.manifest.js';
import { pandoraCodec } from '../src/pandora.session.js';

export const EMAIL = 'listener@example.com';
export const PASSWORD = 'hunter2';

/** A recorded response from `tests/fixtures`, as `{ status, body }`. */
export function fixture(name: string): { status: number; body: unknown } {
    return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as { status: number; body: unknown };
}

/** How the fake answers one web API call: a status and a JSON body. */
export type WebAnswer = { status?: number; body: unknown };

export interface FakePandora {
    host: FakePluginHost;
    /** Web API answers by endpoint (`v3/sod/search`). A function sees the decoded request body. */
    web: Record<string, WebAnswer | ((body: any, call: number) => WebAnswer)>;
    /** Every web API call, in order. */
    webCalls: Array<{ endpoint: string; body: any; headers: Record<string, string> }>;
    /** Every tuner call, in order, with the body decrypted when it was encrypted. */
    tunerCalls: Array<{ method: string; params: URLSearchParams; body: any }>;
    /** What `auth.userLogin` answers. Defaults to a free account. */
    userLogin: { stat: 'ok' | 'fail'; code?: number; message?: string; result?: Record<string, unknown> };
}

/** Pandora's `syncTime`: four bytes of noise and the server's clock, encrypted with the DECRYPT key. */
function syncTime(nowS: number): string {
    const plain = pandoraCodec.zeroPad(new TextEncoder().encode(`abcd${nowS}xyz`));
    return pandoraCodec.bytesToHex(new Blowfish(new TextEncoder().encode(PARTNER.decryptKey)).encrypt(plain));
}

const decryptBody = (hex: string): any => {
    const bytes = new Blowfish(new TextEncoder().encode(PARTNER.encryptKey)).decrypt(pandoraCodec.hexToBytes(hex));
    return JSON.parse(new TextDecoder().decode(bytes).replace(/\0+$/, ''));
};

export function fakePandora(): FakePandora {
    const host = createFakePluginHost();
    host.seedConfig({ email: EMAIL });
    host.seedSecret('password', PASSWORD);

    const fake: FakePandora = {
        host,
        web: {},
        webCalls: [],
        tunerCalls: [],
        userLogin: { stat: 'ok', result: { userId: 'user-1', userAuthToken: 'user-token-1', isSubscriber: false } },
    };
    const counts = new Map<string, number>();

    host.setFetchImpl(async (url, init) => {
        const parsed = new URL(url);
        const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

        if (parsed.hostname === 'tuner.pandora.com') {
            const method = parsed.searchParams.get('method') ?? '';
            const raw = init?.body ?? '';
            const body = method === 'auth.partnerLogin' ? JSON.parse(raw) : decryptBody(raw);
            fake.tunerCalls.push({ method, params: parsed.searchParams, body });

            if (method === 'auth.partnerLogin') {
                return json(200, { stat: 'ok', result: { partnerId: '42', partnerAuthToken: 'partner-token', syncTime: syncTime(Math.floor(Date.now() / 1000)) } });
            }
            if (method === 'auth.userLogin') return json(200, fake.userLogin);
            return json(200, { stat: 'fail', code: 0, message: `unscripted tuner method ${method}` });
        }

        const endpoint = parsed.pathname.replace(/^\/api\//, '');
        const body = JSON.parse(init?.body ?? 'null');
        fake.webCalls.push({ endpoint, body, headers: init?.headers ?? {} });
        const call = counts.get(endpoint) ?? 0;
        counts.set(endpoint, call + 1);

        const scripted = fake.web[endpoint];
        if (scripted === undefined) throw new Error(`fake pandora: no answer scripted for ${endpoint}`);
        const answer = typeof scripted === 'function' ? scripted(body, call) : scripted;
        return json(answer.status ?? 200, answer.body);
    });

    return fake;
}
