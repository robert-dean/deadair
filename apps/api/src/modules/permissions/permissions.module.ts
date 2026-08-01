import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { AuthorizationModel, CheckMetricsSink, PermissionsTupleRepository, noopMetricsSink } from '@maroonedsoftware/permissions';
import { DeadairPermissionsTupleRepository } from './permissions.repository.js';
import { PermissionsService } from './permissions.service.js';
import { AccessControlService } from './access.control.service.js';
import { model as authorizationModel } from './generated/index.js';
import { AuthorizationContext } from './authorization.context.js';

export const PermissionsModule: ServerKitModule = {
    name: 'Permissions',
    setup: async (registry: Registry, _: AppConfig) => {
        registry
            .register(AuthorizationContext)
            .useFactory(() => new AuthorizationContext({ kind: 'system', source: 'startup', sessionToken: '' }, {}))
            .asScoped();

        // Bind the package's abstract tuple-repo token to the Deadair
        // Kysely-backed implementation. Mirrors how the auth factor repos are
        // wired in `@maroonedsoftware/authentication`.
        registry.register(PermissionsTupleRepository).useClass(DeadairPermissionsTupleRepository).asTransient();
        registry.register(DeadairPermissionsTupleRepository).useClass(DeadairPermissionsTupleRepository).asTransient();

        // The host owns the authorization model — the package's PermissionsService
        // takes it via constructor so the package itself stays domain-agnostic.
        registry
            .register(AuthorizationModel)
            .useFactory(() => authorizationModel)
            .asSingleton();

        // CheckMetricsSink default is noop. Swap to LoggingMetricsSink (or a
        // real telemetry sink) in a later PR once the telemetry pipeline
        // exists. Tests can override with their own capturing sink.
        registry
            .register(CheckMetricsSink)
            .useFactory(() => noopMetricsSink)
            .asSingleton();

        registry.register(PermissionsService).useClass(PermissionsService).asTransient();
        registry.register(AccessControlService).useClass(AccessControlService).asTransient();
    },
};
