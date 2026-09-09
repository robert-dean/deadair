import { createTransport } from 'nodemailer';
import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { httpError } from '@maroonedsoftware/errors';
import { MailTransport } from './mail.transport.js';
import { MailEnvelope } from './mail.templates.js';
import { MailSettings } from './mail.settings.js';

/**
 * How long a send may spend on each stage before the station gives up on it.
 *
 * All three matter and they fail differently. `connection` covers a host that does not answer;
 * `greeting` a host that accepts the socket and never speaks, which is what a `secure: true`
 * setting pointed at a STARTTLS port looks like; `socket` a conversation that stalls mid-command.
 * Nodemailer's defaults are two minutes, and this send is inside a sign-in request: a person is
 * looking at a spinner, and the browser and nginx in front of it will both have given up first, so
 * the only thing a long timeout buys is a request holding a connection nobody is waiting on.
 */
const SMTP_TIMEOUT_MS = 10_000;

/**
 * Sends over SMTP, opening a connection per message.
 *
 * Per message rather than pooled, and that is a real decision rather than a simplification. This
 * station sends when somebody signs in, which for one operator is a handful of messages a day with
 * hours between them — a pool would hold an idle TCP connection to somebody's mail server around
 * the clock to save a handshake nobody is timing, and it would have to be torn down on shutdown and
 * rebuilt whenever the settings changed underneath it. The settings can change between any two
 * sends, since they are live rows, so "build it fresh from what is stored now" is also the only
 * shape that cannot serve a message through a server the operator has already moved off.
 */
@Injectable()
export class SmtpMailTransport extends MailTransport {
    constructor(private readonly logger: Logger) {
        super();
    }

    async send(envelope: MailEnvelope, settings: MailSettings, fromName: string): Promise<void> {
        const transport = createTransport({
            host: settings.host,
            port: settings.port,
            secure: settings.secure,
            ...(settings.user ? { auth: { user: settings.user, pass: settings.password ?? '' } } : {}),
            connectionTimeout: SMTP_TIMEOUT_MS,
            greetingTimeout: SMTP_TIMEOUT_MS,
            socketTimeout: SMTP_TIMEOUT_MS,
        });

        try {
            await transport.sendMail({
                from: { name: fromName, address: settings.from },
                to: envelope.to,
                subject: envelope.subject,
                text: envelope.text,
                html: envelope.html,
            });
        } catch (error) {
            // 502 rather than 500: the station did its part and the thing it depends on refused.
            // The recipient and the server are internal details — a 4xx body reaches whoever asked
            // for the code, who on a sign-in route is not necessarily the account's owner, and
            // "which address did that go to" is exactly what they must not be told.
            this.logger.error('mail: could not send through the configured SMTP server', {
                error,
                host: settings.host,
                port: settings.port,
                subject: envelope.subject,
            });
            throw httpError(502)
                .withDetails({ mail: 'The station could not send that email. Check the mail settings and the server they point at.' })
                .withInternalDetails({ host: settings.host, port: settings.port, to: envelope.to })
                .withCause(error as Error);
        } finally {
            transport.close();
        }
    }
}
