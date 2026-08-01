import { Actor } from '#modules/permissions/authorization.context.js';
import { PolicyEnvelope } from '@maroonedsoftware/policies';

export interface ServerPolicyEnvelope extends PolicyEnvelope {
    actor: Actor;
}
