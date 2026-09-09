import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { MailService } from './mail.service.js';
import { MailTransport } from './mail.transport.js';
import { SmtpMailTransport } from './smtp.mail.transport.js';

/**
 * Outbound mail: the one-time codes and sign-in links that make an email address a factor.
 *
 * Registered after `SettingsModule`, because everything it does is read `mail.*` rows and those are
 * a layer of `AppConfig` that module owns. It is registered AFTER `AuthenticationModule`, which is
 * the module that sends, and that is fine rather than a compromise: the list is a LIFECYCLE order,
 * not a resolution one, and nothing here is reached at boot. The first send is a request — somebody
 * signing in — by which point every module has been set up. Reading a `mail.*` setting needs no
 * scope at all, since `deadair.settings` is a config layer.
 *
 * It starts nothing, holds no connection and owns no loop, so it needs no place in the teardown
 * order beyond the one it has.
 */
export const MailModule: ServerKitModule = {
    name: 'Mail',
    setup: async (registry: Registry, _: AppConfig) => {
        // Both scoped, because the service decrypts the SMTP password through the scoped
        // `EncryptionProvider` and the transport is handed the result per send. Nothing here is
        // worth keeping between requests: a station that sends a handful of messages a day would be
        // holding an idle connection to somebody's mail server the rest of the time.
        registry.register(MailTransport).useClass(SmtpMailTransport).asScoped();
        registry.register(MailService).useClass(MailService).asScoped();
    },
};
