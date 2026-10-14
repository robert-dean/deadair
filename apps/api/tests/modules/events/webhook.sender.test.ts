// The sender is the station's one door to an operator's own server. Each case here is a real HTTP
// exchange with a server on loopback, because the parts worth proving (what was signed against what
// was sent, a redirect left unfollowed, a deadline that fires before the status line) all live in
// the exchange rather than in the code around it.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DateTime } from 'luxon';
import { DefaultSignaturePolicy, type SignatureOptions } from '@maroonedsoftware/servercore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eventEnvelope } from '../../../src/modules/events/event.envelope.js';
import {
    WEBHOOK_HEADERS,
    WEBHOOK_SIGNATURE_PREFIX,
    WebhookSender,
    WebhookSenderOptions,
    retryableStatus,
    webhookUrlProblem,
} from '../../../src/modules/events/webhook.sender.js';

const SECRET = 'a-destination-secret';

interface Received {
    path: string;
    headers: http.IncomingHttpHeaders;
    body: string;
}

const received: Received[] = [];
let server: http.Server;
let base: string;

beforeAll(async () => {
    server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(chunk as Buffer));
        request.on('end', () => {
            const path = request.url ?? '/';
            received.push({ path, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });

            if (path === '/ok') return void response.writeHead(204).end();
            if (path === '/moved') return void response.writeHead(302, { location: `${base}/elsewhere` }).end();
            if (path === '/elsewhere') return void response.writeHead(200).end();
            if (path === '/missing') return void response.writeHead(404).end('no such hook');
            if (path === '/busy') return void response.writeHead(503).end();
            if (path === '/limited') return void response.writeHead(429).end();
            if (path === '/slow') return; // never answers; the sender's deadline is what ends it
            response.writeHead(500).end();
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
});

const envelope = () =>
    eventEnvelope('destination.test', { destinationId: 'd-1' }, { key: 'main', name: 'Dead Air' }, DateTime.fromISO('2026-10-14T12:00:00Z'));

const sender = (timeoutMs?: number) => new WebhookSender(new WebhookSenderOptions(globalThis.fetch, () => DateTime.now(), timeoutMs));

const last = (path: string): Received => received.filter(entry => entry.path === path).at(-1)!;

/** What a ServerKit receiver declaring this station's scheme would configure. */
const receiverOptions = (secret: string): SignatureOptions => ({
    header: WEBHOOK_HEADERS.signature,
    secret,
    algorithm: 'sha256',
    digest: 'hex',
    prefix: WEBHOOK_SIGNATURE_PREFIX,
    timestamp: { header: WEBHOOK_HEADERS.timestamp, maxAgeSeconds: 300 },
});

const verify = async (request: Received, secret: string) =>
    new DefaultSignaturePolicy().evaluate(
        {
            rawBody: request.body,
            getHeader: name => String(request.headers[name.toLowerCase()] ?? ''),
            options: receiverOptions(secret),
        },
        { now: DateTime.now() },
    );

describe('WebhookSender', () => {
    it('delivers the envelope as JSON, signed so a ServerKit receiver verifies it', async () => {
        const event = envelope();

        const result = await sender().send({ url: `${base}/ok`, secret: SECRET }, event);

        expect(result).toEqual(expect.objectContaining({ outcome: 'delivered', httpStatus: 204 }));
        const request = last('/ok');
        expect(JSON.parse(request.body)).toEqual(event);
        expect(request.headers['content-type']).toBe('application/json');
        expect(request.headers[WEBHOOK_HEADERS.id.toLowerCase()]).toBe(event.id);
        expect(await verify(request, SECRET)).toEqual(expect.objectContaining({ allowed: true }));
    });

    it('signs with the destination secret, so a receiver holding another one refuses it', async () => {
        await sender().send({ url: `${base}/ok`, secret: SECRET }, envelope());

        expect(await verify(last('/ok'), 'some-other-secret')).toEqual(expect.objectContaining({ allowed: false, reason: 'invalid_signature' }));
    });

    it('treats a redirect as a failure and never follows it', async () => {
        const before = received.filter(entry => entry.path === '/elsewhere').length;

        const result = await sender().send({ url: `${base}/moved`, secret: SECRET }, envelope());

        expect(result).toEqual(expect.objectContaining({ outcome: 'failed', retryable: false, httpStatus: 302 }));
        expect(received.filter(entry => entry.path === '/elsewhere')).toHaveLength(before);
    });

    it('calls a 4xx permanent, and keeps the receiver body out of the reason', async () => {
        const result = await sender().send({ url: `${base}/missing`, secret: SECRET }, envelope());

        expect(result).toEqual(expect.objectContaining({ outcome: 'failed', retryable: false, httpStatus: 404, error: 'Answered 404.' }));
    });

    it.each([
        ['/busy', 503],
        ['/limited', 429],
    ])('calls %s (%i) worth asking again', async (path, status) => {
        const result = await sender().send({ url: `${base}${path}`, secret: SECRET }, envelope());

        expect(result).toEqual(expect.objectContaining({ outcome: 'failed', retryable: true, httpStatus: status }));
    });

    it('gives up at its deadline and calls that worth asking again', async () => {
        const result = await sender(100).send({ url: `${base}/slow`, secret: SECRET }, envelope());

        expect(result).toEqual(expect.objectContaining({ outcome: 'failed', retryable: true, error: 'No answer within 0.1s.' }));
        expect(result.durationMs).toBeLessThan(2_000);
    });

    it('calls a refused connection worth asking again', async () => {
        const closed = http.createServer();
        await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
        const { port } = closed.address() as AddressInfo;
        await new Promise<void>(resolve => closed.close(() => resolve()));

        const result = await sender().send({ url: `http://127.0.0.1:${port}/`, secret: SECRET }, envelope());

        expect(result).toEqual(expect.objectContaining({ outcome: 'failed', retryable: true }));
        expect(result.outcome === 'failed' && result.error).toMatch(/^Could not reach the destination/);
    });

    it('refuses an address it cannot send to without trying', async () => {
        const result = await sender().send({ url: 'ftp://hub.local/hook', secret: SECRET }, envelope());

        expect(result).toEqual({
            outcome: 'failed',
            retryable: false,
            durationMs: 0,
            error: 'The address uses ftp, and only http and https can receive events.',
        });
    });
});

describe('webhookUrlProblem', () => {
    it('accepts http and https, LAN addresses included', () => {
        expect(webhookUrlProblem('http://192.168.1.20:8123/api/webhook/abc')).toBeUndefined();
        expect(webhookUrlProblem('https://hooks.example.com/station')).toBeUndefined();
    });

    it('refuses what is not a web address, another scheme, or credentials in the URL', () => {
        expect(webhookUrlProblem('not a url')).toBe('is not a web address');
        expect(webhookUrlProblem('mqtt://hub.local')).toMatch(/^uses mqtt/);
        expect(webhookUrlProblem('https://user:pass@hooks.example.com/')).toMatch(/username or password/);
    });
});

describe('retryableStatus', () => {
    it('retries 408, 429 and every 5xx, and nothing else', () => {
        expect([408, 429, 500, 502, 503].map(retryableStatus)).toEqual([true, true, true, true, true]);
        expect([400, 401, 403, 404, 410, 422].map(retryableStatus)).toEqual([false, false, false, false, false, false]);
    });
});

describe('eventEnvelope', () => {
    it('writes the moment as a UTC ISO string and keeps an id it is given', () => {
        const event = eventEnvelope(
            'track.started',
            { title: 'X' },
            { key: 'main', name: 'Dead Air' },
            DateTime.fromISO('2026-10-14T08:00:00-04:00'),
            'e-1',
        );

        expect(event).toEqual({
            id: 'e-1',
            type: 'track.started',
            occurredAt: '2026-10-14T12:00:00.000Z',
            station: { key: 'main', name: 'Dead Air' },
            data: { title: 'X' },
        });
    });
});
