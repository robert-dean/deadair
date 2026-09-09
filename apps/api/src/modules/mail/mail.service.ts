import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Logger } from '@maroonedsoftware/logger';
import { httpError } from '@maroonedsoftware/errors';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { MailTransport } from './mail.transport.js';
import { MailMessage, renderMail } from './mail.templates.js';
import { resolveMailSettings } from './mail.settings.js';

/**
 * What the station says when it has nowhere to send mail.
 *
 * Names the page, because the operator reading it is the person who can fix it — this is a
 * single-operator station and the sign-in that just failed is theirs.
 */
const NOT_CONFIGURED = 'Email is not configured. Set a mail server under Settings → Mail.';

/**
 * Everything the station sends by email.
 *
 * Scoped, because the `EncryptionProvider` that decrypts the SMTP password is: the settings are
 * resolved per send rather than held, so an operator who fixes a wrong port is fixing the next
 * attempt rather than the one after a restart.
 *
 * The station either sends or says it cannot. There is no console transport that logs a code
 * instead — a one-time code written to a log file is a credential in the log, and it reads as
 * success to everything downstream while the person waiting on the message gets nothing.
 */
@Injectable()
export class MailService {
    constructor(
        private readonly config: AppConfig,
        private readonly encryption: EncryptionProvider,
        private readonly transport: MailTransport,
        private readonly logger: Logger,
    ) {}

    /**
     * Whether the station can send at all.
     *
     * Exists so a caller can refuse BEFORE doing something it cannot undo. `issueEmailChallenge` is
     * idempotent per actor, factor and method for the length of the challenge, so a code issued and
     * then not sent leaves the operator waiting ten minutes for a message that will never come
     * while every retry hands back the same unsent code. Ask this first, then issue.
     */
    isConfigured(): boolean {
        return resolveMailSettings(this.config, this.encryption) !== undefined;
    }

    /** Refuse with the 503 {@link send} would throw, for a caller checking before it commits to anything. */
    assertConfigured(): void {
        if (!this.isConfigured()) {
            throw httpError(503).withDetails({ mail: NOT_CONFIGURED });
        }
    }

    /**
     * Render a message and send it.
     *
     * @throws {HttpError} 503 when no mail server is configured, 502 when the one configured refused.
     */
    async send(message: MailMessage): Promise<void> {
        const settings = resolveMailSettings(this.config, this.encryption);
        if (!settings) {
            throw httpError(503).withDetails({ mail: NOT_CONFIGURED });
        }

        const envelope = renderMail(message, this.stationName());

        await this.transport.send(envelope, settings, this.stationName());

        // The template and recipient, never the data — every template here carries either a
        // one-time code or a link that is one, and both are credentials for the length of their
        // challenge.
        this.logger.info('mail: sent', { template: message.template, to: message.to });
    }

    /**
     * What the station calls itself in the From line and in the copy.
     *
     * The same question `totpIssuer` answers for an authenticator app, and the same answer: the
     * station's own name, falling back to the software's when the operator has cleared it. A From
     * line reading `" " <noreply@…>` is worse than a wrong-but-recognisable one.
     */
    private stationName(): string {
        const title = String(this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title)).trim();
        return title.length > 0 ? title : STREAM_DEFAULTS.title;
    }
}
