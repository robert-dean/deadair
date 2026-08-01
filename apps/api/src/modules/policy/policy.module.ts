import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ServerPolicyService } from './policy.service.js';
import { ServerPolicyMappings } from './policy.mappings.js';
import { PolicyRegistryMap, PolicyService } from '@maroonedsoftware/policies';
import { EmailAllowedPolicyOptions } from '@maroonedsoftware/authentication';

export const PolicyModule: ServerKitModule = {
    name: 'Policy',
    setup: async (registry: Registry, _: AppConfig) => {
        registry.register(EmailAllowedPolicyOptions).useFactory(() => new EmailAllowedPolicyOptions([]));

        const policyRegistry = new PolicyRegistryMap();
        for (const [name, policy] of Object.entries(ServerPolicyMappings)) {
            policyRegistry.set(name, policy);
            registry.register(policy).useClass(policy).asTransient();
        }
        registry.register(PolicyRegistryMap).useInstance(policyRegistry);
        registry.register(PolicyService).useClass(ServerPolicyService).asTransient();
    },
};
