import { Injectable } from 'injectkit';
import { isFactorRecent, matchesFactorConstraints } from '@maroonedsoftware/authentication';
import { ServerPolicyEnvelope } from '../policy.envelope.js';
import { Policy, PolicyResult, StepUpRequirement } from '@maroonedsoftware/policies';
import { AuthenticationFactorKind, AuthenticationFactorMethod } from '@maroonedsoftware/authentication';
import { Duration } from 'luxon';

export interface AuthRecentFactorPolicyContext {
    within: Duration;
    anyOfKinds?: ReadonlyArray<AuthenticationFactorKind>;
    anyOfMethods?: ReadonlyArray<AuthenticationFactorMethod>;
    excludeMethods?: ReadonlyArray<AuthenticationFactorMethod>;
}

@Injectable()
// Generic step-up rule. The caller decides what counts as acceptable
// proof — by method, by kind, or by exclusion. Pass it whenever a route
// wants assurance that the current actor performed a recent challenge.
export class AuthRecentFactorPolicy extends Policy<AuthRecentFactorPolicyContext> {
    async evaluate(context: AuthRecentFactorPolicyContext, envelope: ServerPolicyEnvelope): Promise<PolicyResult> {
        if (envelope.actor.kind !== 'user') {
            return this.deny('step-up is only meaningful for human actors', {
                kind: 'step_up_unavailable',
                actorKind: envelope.actor.kind,
            });
        }
        const requirement: StepUpRequirement = {
            within: context.within,
            ...(context.anyOfMethods ? { acceptableMethods: context.anyOfMethods } : {}),
            ...(context.anyOfKinds ? { acceptableKinds: context.anyOfKinds } : {}),
            ...(context.excludeMethods ? { excludeMethods: context.excludeMethods } : {}),
        };
        const matched = envelope.actor.factors.some(
            f =>
                matchesFactorConstraints(f, {
                    anyOfKinds: context.anyOfKinds,
                    anyOfMethods: context.anyOfMethods,
                    excludeMethods: context.excludeMethods,
                }) && isFactorRecent(f, envelope.now, context.within),
        );
        if (matched) return this.allow();
        return this.denyStepUp('no recent factor satisfies the step-up requirement', requirement);
    }
}
