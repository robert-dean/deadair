// The transport with nodemailer mocked: what it builds a connection out of, and what it does with a
// server that refuses. The connection shape is worth pinning because two of its fields are the ones
// an operator gets wrong — `secure` against the wrong port, and an `auth` block sent to a relay that
// takes none — and both fail in ways that look like something else.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IsHttpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';

const sendMail = vi.fn();
const close = vi.fn();
const createTransport = vi.fn((_options: Record<string, unknown>) => ({ sendMail, close }));

vi.mock('nodemailer', () => ({ createTransport: (options: Record<string, unknown>) => createTransport(options) }));

const { SmtpMailTransport } = await import('../../../src/modules/mail/smtp.mail.transport.js');

const ENVELOPE = { to: 'someone@example.com', subject: 'Your code', text: 'plain', html: '<p>html</p>' };
const SETTINGS = { host: 'smtp.example.com', port: 587, secure: false, from: 'radio@example.com' };

let logger: Logger;

beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: 'm1' });
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
});

const transport = () => new SmtpMailTransport(logger);

describe('sending over SMTP', () => {
    it('connects with the host, port and TLS mode the settings hold', async () => {
        await transport().send(ENVELOPE, SETTINGS, 'Dead Air');

        expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.example.com', port: 587, secure: false }));
    });

    // Nodemailer's own default is two minutes on each, and this send is inside a request somebody
    // is watching a spinner for.
    it('bounds every stage, so a server that never speaks does not hold the request open', async () => {
        await transport().send(ENVELOPE, SETTINGS, 'Dead Air');

        expect(createTransport).toHaveBeenCalledWith(
            expect.objectContaining({ connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000 }),
        );
    });

    it('sends no auth block at all when no username is stored', async () => {
        await transport().send(ENVELOPE, SETTINGS, 'Dead Air');

        expect(createTransport).toHaveBeenCalledWith(expect.not.objectContaining({ auth: expect.anything() }));
    });

    it('authenticates when a username is', async () => {
        await transport().send(ENVELOPE, { ...SETTINGS, user: 'radio', password: 'hunter2' }, 'Dead Air');

        expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: { user: 'radio', pass: 'hunter2' } }));
    });

    it('addresses the message from the station, by name and by address', async () => {
        await transport().send(ENVELOPE, SETTINGS, 'Dead Air');

        expect(sendMail).toHaveBeenCalledWith(
            expect.objectContaining({
                from: { name: 'Dead Air', address: 'radio@example.com' },
                to: 'someone@example.com',
                subject: 'Your code',
                text: 'plain',
                html: '<p>html</p>',
            }),
        );
    });

    it('closes the connection, which it opened for this message alone', async () => {
        await transport().send(ENVELOPE, SETTINGS, 'Dead Air');

        expect(close).toHaveBeenCalled();
    });

    it('closes it even when the send failed, so a refusal does not leak a socket', async () => {
        sendMail.mockRejectedValue(new Error('550 relay denied'));

        await transport().send(ENVELOPE, SETTINGS, 'Dead Air').catch(() => undefined);

        expect(close).toHaveBeenCalled();
    });

    // 502 rather than 500: the station did its part and the thing it depends on refused.
    it('answers 502 when the server refuses', async () => {
        sendMail.mockRejectedValue(new Error('550 relay denied'));

        const error = await transport().send(ENVELOPE, SETTINGS, 'Dead Air').catch((e: unknown) => e);

        expect(IsHttpError(error) ? error.statusCode : undefined).toBe(502);
    });

    // A 4xx/5xx body on a sign-in route reaches whoever asked for the code, who is not necessarily
    // the account's owner. Which address it went to is exactly what they must not be told.
    it('keeps the recipient out of the response and puts it in the log instead', async () => {
        sendMail.mockRejectedValue(new Error('550 relay denied'));

        const error = await transport().send(ENVELOPE, SETTINGS, 'Dead Air').catch((e: unknown) => e);

        expect(JSON.stringify(IsHttpError(error) ? error.details : {})).not.toContain('someone@example.com');
        expect(logger.error).toHaveBeenCalledWith('mail: could not send through the configured SMTP server', expect.objectContaining({ host: 'smtp.example.com' }));
    });
});
