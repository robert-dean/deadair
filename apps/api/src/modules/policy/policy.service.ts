import { Container, Injectable } from 'injectkit';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { ServerPolicyEnvelope } from './policy.envelope.js';
import { DateTime } from 'luxon';
import { ServerPolicyContexts } from './policy.mappings.js';
import { PolicyRegistryMap, BasePolicyService } from '@maroonedsoftware/policies';

@Injectable()
export class ServerPolicyService extends BasePolicyService<ServerPolicyContexts, ServerPolicyEnvelope> {
    constructor(
        container: Container,
        policyRegistry: PolicyRegistryMap,
        private readonly authz: AuthorizationContext,
    ) {
        super(container, policyRegistry);
    }

    protected async buildEnvelope(): Promise<ServerPolicyEnvelope> {
        return {
            actor: this.authz.actor,
            now: DateTime.utc(),
        };
    }
}
