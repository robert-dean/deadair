import { Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { PolicyService } from '@maroonedsoftware/policies';
import { ActorsRepository } from './repositories/actors.repository.js';

/** The factors an account can hold without ever having proved anything stronger. */
const BOOTSTRAP_METHODS = ['email', 'password', 'oidc'] as const;

/**
 * The step-up in front of every change a stolen session would most like to make to an account's
 * credentials: binding or removing a factor, and minting or rotating an API key.
 *
 * Email, password, and oidc are the bootstrap factors: a login can have only these at registration
 * without ever proving a stronger factor, so a recent strong-factor verification cannot be required
 * before binding the first one (chicken-and-egg). Email is `kind: 'possession'` in the session
 * taxonomy but treated as weak here because email control alone is the threat being hardened
 * against. OIDC is similar: the Google session is the assertion, the console cannot re-prove it
 * inline without bouncing through the IdP, so it stays bootstrap-tier. Once any non-bootstrap factor
 * is enrolled, every subsequent change requires recent re-verification by something other than
 * those three, which the policy answers with `step_up_required` for the console to satisfy.
 */
@Injectable()
export class StrongFactorGate {
    constructor(
        private readonly actorsRepository: ActorsRepository,
        private readonly policyService: PolicyService,
    ) {}

    async assertRecentIfAnyEnrolled(actorId: string): Promise<void> {
        const factors = await this.actorsRepository.listFactors(actorId, true);
        const isBootstrap = (method: string): boolean => (BOOTSTRAP_METHODS as ReadonlyArray<string>).includes(method);
        if (!factors.every(factor => isBootstrap(factor.method))) {
            await this.policyService.assert('auth.session.recent.factor', {
                within: Duration.fromDurationLike({ minutes: 5 }),
                excludeMethods: [...BOOTSTRAP_METHODS],
            });
        }
    }
}
