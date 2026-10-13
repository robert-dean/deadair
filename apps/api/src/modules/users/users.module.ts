import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';
import { InvitationsRepository } from './invitations.repository.js';
import { InvitationsService } from './invitations.service.js';

/**
 * The station's people: who has an account, the role they hold, how they sign in, and who has
 * been invited to join.
 *
 * Reads what `authentication` and `permissions` own, both registered well before it, and nothing
 * registered later depends on it. No lifecycle of its own.
 */
export const UsersModule: ServerKitModule = {
    name: 'Users',
    setup: async (registry: Registry, _: AppConfig) => {
        registry.register(UsersRepository).useClass(UsersRepository).asScoped();
        registry.register(UsersService).useClass(UsersService).asScoped();
        registry.register(InvitationsRepository).useClass(InvitationsRepository).asScoped();
        registry.register(InvitationsService).useClass(InvitationsService).asScoped();
    },
};
