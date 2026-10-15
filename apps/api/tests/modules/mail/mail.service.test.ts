// The service is a thin thing with one decision in it: send, or say the station cannot. The
// distinction is worth pinning because the alternative shape — log the code and return — reads as
// success to every caller while the person waiting on the message gets nothing, and puts a
// credential in the log on the way.

import { describe, expect, it, vi } from 'vitest';
import { IsHttpError } from '@maroonedsoftware/errors';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Logger } from '@maroonedsoftware/logger';

import { MailService } from '../../../src/modules/mail/mail.service.js';
import { MailTransport } from '../../../src/modules/mail/mail.transport.js';
import { MAIL_KEYS } from '../../../src/modules/mail/mail.settings.js';
import { INVITATION_KEYS } from '../../../src/modules/mail/mail.invitation.js';
import { STREAM_KEYS } from '../../../src/modules/stream/stream.settings.js';

const build = (rows: Record<string, string>) => {
    const config = {
        has: (key: string) => key in rows,
        get: (key: string, fallback: unknown) => (key in rows ? rows[key] : fallback),
    } as unknown as AppConfig;
    const encryption = { decrypt: (value: string) => value, encrypt: (value: string) => value } as unknown as EncryptionProvider;
    const transport = { send: vi.fn().mockResolvedValue(undefined) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

    const service = new MailService(config, encryption, transport as unknown as MailTransport, logger);

    return { service, transport, logger };
};

const CONFIGURED = { [MAIL_KEYS.host]: 'smtp.example.com', [MAIL_KEYS.from]: 'radio@example.com' };
const MESSAGE = { to: 'someone@example.com', template: 'SignInCode', data: { code: '123456', minutes: 10 } } as const;

const statusOf = async (promise: Promise<unknown>): Promise<number | undefined> => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? error.statusCode : undefined;
};

describe('sending station mail', () => {
    it('refuses with a 503 when no server is configured', async () => {
        const { service, transport } = build({});

        expect(await statusOf(service.send(MESSAGE))).toBe(503);
        expect(transport.send).not.toHaveBeenCalled();
    });

    // Under `message` on purpose: the console reads its sentence out of `details.message`, so a
    // field-keyed detail would have shown 'Service Unavailable' and hidden the actionable half.
    it('names the page an operator can fix it on, under the key the console actually reads', async () => {
        const { service } = build({});

        const error = await service.send(MESSAGE).catch((e: unknown) => e);

        expect(IsHttpError(error) ? error.details : undefined).toEqual({ message: expect.stringContaining('Settings → Mail') });
    });

    it('hands the transport a rendered envelope and the settings to send it with', async () => {
        const { service, transport } = build({ ...CONFIGURED, [MAIL_KEYS.port]: '2525' });

        await service.send(MESSAGE);

        expect(transport.send).toHaveBeenCalledWith(
            expect.objectContaining({ to: 'someone@example.com', subject: expect.stringContaining('sign-in code') }),
            expect.objectContaining({ host: 'smtp.example.com', port: 2525, from: 'radio@example.com' }),
            expect.any(String),
        );
    });

    it('signs the message with the station name, as the authenticator issuer does', async () => {
        const { service, transport } = build({ ...CONFIGURED, [STREAM_KEYS.title]: 'Night Owl Radio' });

        await service.send(MESSAGE);

        expect(transport.send).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'Night Owl Radio');
    });

    it('falls back to the software name when the operator has cleared the station name', async () => {
        const { service, transport } = build({ ...CONFIGURED, [STREAM_KEYS.title]: '   ' });

        await service.send(MESSAGE);

        const [, , fromName] = transport.send.mock.calls[0] as [unknown, unknown, string];
        expect(fromName.trim().length).toBeGreaterThan(0);
    });

    // Every template here carries a one-time code or a link that is one, so the data is a
    // credential for the length of its challenge and has no business in a log file.
    it('logs that it sent and to whom, never what it said', async () => {
        const { service, logger } = build(CONFIGURED);

        await service.send(MESSAGE);

        expect(logger.info).toHaveBeenCalledWith('mail: sent', { template: 'SignInCode', to: 'someone@example.com' });
        expect(JSON.stringify((logger.info as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('123456');
    });

    it('answers whether it can send, so a caller can refuse before issuing a code it cannot deliver', () => {
        expect(build({}).service.isConfigured()).toBe(false);
        expect(build(CONFIGURED).service.isConfigured()).toBe(true);
    });

    it('assertConfigured throws the same 503 send would, and nothing when it can', async () => {
        expect(await statusOf(Promise.resolve().then(() => build({}).service.assertConfigured()))).toBe(503);
        expect(() => build(CONFIGURED).service.assertConfigured()).not.toThrow();
    });
});

describe("sending an invitation in the operator's words", () => {
    const INVITATION = {
        to: 'someone@example.com',
        template: 'Invitation',
        data: { link: 'https://x.test/invite#t', role: 'listener', until: 'soon' },
    } as const;

    it('uses the subject and body the station has saved', async () => {
        const { service, transport } = build({
            ...CONFIGURED,
            [INVITATION_KEYS.subject]: 'Tune in to {{station}}',
            [INVITATION_KEYS.body]: 'Pull up a chair. [Join]({{link}})',
        });

        await service.send(INVITATION);

        expect(transport.send).toHaveBeenCalledWith(
            expect.objectContaining({ subject: 'Tune in to Deadair', text: 'Pull up a chair. Join (https://x.test/invite#t)' }),
            expect.anything(),
            expect.any(String),
        );
    });

    // A row that reached the table some other way than the settings page, which refuses this.
    it("sends the station's own body, and says why, when the saved one cannot be used", async () => {
        const { service, transport, logger } = build({ ...CONFIGURED, [INVITATION_KEYS.body]: 'No link in here.' });

        await service.send(INVITATION);

        expect(transport.send).toHaveBeenCalledWith(
            expect.objectContaining({ text: expect.stringContaining('Make your account') }),
            expect.anything(),
            expect.any(String),
        );
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('wording cannot be used'),
            expect.objectContaining({ key: INVITATION_KEYS.body }),
        );
    });

    it('leaves the other messages alone whatever the invitation says', async () => {
        const { service, transport, logger } = build({ ...CONFIGURED, [INVITATION_KEYS.body]: 'No link in here.' });

        await service.send(MESSAGE);

        expect(transport.send).toHaveBeenCalledWith(
            expect.objectContaining({ subject: expect.stringContaining('sign-in code') }),
            expect.anything(),
            expect.any(String),
        );
        expect(logger.warn).not.toHaveBeenCalled();
    });
});

describe('previewing the invitation', () => {
    it("renders the station's own wording with sample values, without a mail server", async () => {
        const { service } = build({});

        const preview = await service.previewInvitation({ role: 'admin' });

        expect(preview.subject).toBe('You are invited to run Deadair');
        expect(preview.html).toContain('<!DOCTYPE html>');
        expect(preview.text).toContain('https://your-station.example/invite#sample');
        expect(preview.text).toContain('docs/tutorials/first-hour');
        expect(preview.ownWording).toBe(false);
        expect(preview.problem).toBeUndefined();
    });

    it('renders the saved wording and says it did', async () => {
        const { service } = build({ [INVITATION_KEYS.body]: 'Hello, new {{role}}. [Join]({{link}})' });

        const preview = await service.previewInvitation({ role: 'listener' });

        expect(preview.text).toBe('Hello, new listener. Join (https://your-station.example/invite#sample)');
        expect(preview.ownWording).toBe(true);
    });

    it('says why saved wording cannot be used, and shows what would go instead', async () => {
        const { service, logger } = build({ [INVITATION_KEYS.body]: 'No link in here.' });

        const preview = await service.previewInvitation({ role: 'listener' });

        expect(preview.problem).toContain('{{link}}');
        expect(preview.ownWording).toBe(false);
        expect(preview.text).toContain('Make your account');
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
