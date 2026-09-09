import { MailEnvelope } from './mail.templates.js';
import { MailSettings } from './mail.settings.js';

/**
 * How a rendered message leaves the station.
 *
 * An abstract class rather than an interface because it is also the DI token: `MailService` binds
 * to this and the module decides what fills it, which is what lets a test register a transport that
 * collects envelopes without the service knowing.
 *
 * The settings arrive per send rather than at construction. They are database rows an operator
 * edits live (see `apps/api/CLAUDE.md` on `deadair.settings` being a config layer), so a transport
 * that captured them would keep sending to whatever the server was called when it was built.
 */
export abstract class MailTransport {
    abstract send(envelope: MailEnvelope, settings: MailSettings, fromName: string): Promise<void>;
}
