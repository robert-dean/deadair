import { ServerKitModule } from '@maroonedsoftware/koa';
import { DataModule } from './data/data.module.js';
import { AuthenticationModule } from './authentication/authentication.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { PolicyModule } from './policy/policy.module.js';
import { MusicModule } from './music/music.module.js';
import { VendorsModule } from './vendors/vendors.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { SettingsModule } from './settings/settings.module.js';

// Registered in dependency order: infrastructure (data, shared, messaging,
// events) first, then the single-actor identity/auth foundation. IdentityModule
// is a list of modules, spread in place. Add your app's domain modules after
// this chassis set.
export const modules: ServerKitModule[] = [
    DataModule,
    AuthenticationModule,
    PermissionsModule,
    PolicyModule,
    MusicModule,
    VendorsModule,
    OnboardingModule,
    SettingsModule,
];
