import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { AuthMfaRequiredPolicyContext, DefaultMfaRequiredPolicy } from '@maroonedsoftware/authentication';
import { MailService } from '#modules/mail/mail.service.js';

/**
 * The station's own rule for what counts as a viable second factor.
 *
 * Everything the default policy decides is kept — a second knowledge factor adds nothing, the same
 * factor instance cannot be reused, federated sign-in is not a second factor, a second inbox is not
 * meaningfully separate from the first — and one thing is added on top: **an email factor is not
 * offered while the station has nowhere to send mail from.**
 *
 * That rule exists because of a deadlock rather than a preference. Onboarding gives every operator
 * an email factor beside their password, and the default policy makes it eligible after one, so on
 * a fresh install the first sign-in stops at `mfa_required` naming a factor that cannot be
 * delivered — and the page that would configure the mail server is behind the sign-in. The station
 * arrives locked, and the only way in is psql. Offering a factor the station cannot deliver is the
 * same shape of bug as the route that answered a challenge it had not implemented: the difference
 * between "we cannot do this" said early and said in the middle of somebody's sign-in.
 *
 * The station therefore degrades rather than going silent, which is the choice `selectPlugin` makes
 * for a capability with no plugin and `explainDefaultPick` makes for one with several: carry on,
 * and say in the log what was decided and why. Configure a mail server and the factor is offered
 * from the next sign-in onwards, with no other change.
 *
 * This does NOT weaken anything an operator set up deliberately. An authenticator or a passkey is
 * untouched, so an account with one still gets challenged; the only account this lets through on a
 * password alone is one whose sole second factor was an inbox the station could not reach anyway.
 */
@Injectable()
export class DeadairMfaRequiredPolicy extends DefaultMfaRequiredPolicy {
    constructor(
        private readonly mailService: MailService,
        private readonly logger: Logger,
    ) {
        super();
    }

    async evaluate(context: AuthMfaRequiredPolicyContext, envelope: PolicyEnvelope): Promise<PolicyResult> {
        if (this.mailService.isConfigured()) {
            return await super.evaluate(context, envelope);
        }

        const deliverable = context.availableFactors.filter(factor => factor.method !== 'email');
        if (deliverable.length !== context.availableFactors.length) {
            // Said once per sign-in that drops one, and worth the line: from outside, an account
            // that stops asking for its second factor looks like the station forgetting, and this
            // is the only place that records it was a decision.
            this.logger.warn('authentication: not offering the email factor as a second step, because no mail server is configured', {
                actorId: context.actor.actorId,
                dropped: context.availableFactors.length - deliverable.length,
            });
        }

        return await super.evaluate({ ...context, availableFactors: deliverable }, envelope);
    }
}
