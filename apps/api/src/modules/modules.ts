import { ServerKitModule } from '@maroonedsoftware/koa';
import { DataModule } from './data/data.module.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { AuthenticationModule } from './authentication/authentication.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { PolicyModule } from './policy/policy.module.js';
import { MusicModule } from './music/music.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { PluginsModule } from './plugins/plugins.module.js';

// Registered in dependency order: infrastructure (data, shared, messaging,
// events) first, then the single-actor identity/auth foundation. IdentityModule
// is a list of modules, spread in place. Add your app's domain modules after
// this chassis set.
export const modules: ServerKitModule[] = [
    DataModule,
    CryptoModule,
    AuthenticationModule,
    PermissionsModule,
    PolicyModule,
    MusicModule,
    OnboardingModule,
    SettingsModule,
    // Last: a plugin's host reaches into the chassis (data, crypto, logging),
    // so everything it depends on must already be registered.
    PluginsModule,
];
