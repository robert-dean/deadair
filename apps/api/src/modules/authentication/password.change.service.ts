import { Injectable } from 'injectkit';
import { Duration, DateTime } from 'luxon';
import { httpError, IsHttpError } from '@maroonedsoftware/errors';
import { EmailFactorService, isFactorRecent, PasswordFactorService } from '@maroonedsoftware/authentication';
import { Logger } from '@maroonedsoftware/logger';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { AfterCommit } from '#modules/data/after.commit.js';
import { MailService } from '#modules/mail/mail.service.js';
import { SessionActivityService } from './session.activity.service.js';
import { StrongFactorGate } from './strong.factor.gate.js';
import { PasswordChange } from './types/registration.types.js';

/**
 * How recently a sign-in link must have been used for it to stand in for the current password.
 *
 * Ten minutes is long enough to open the link, land on the page and type a new password twice, and
 * short enough that a session left open on a shared machine stops qualifying before long.
 */
export const LINK_STANDS_IN_FOR = Duration.fromObject({ minutes: 10 });

/**
 * Setting or changing the caller's own password, while signed in.
 *
 * A route of its own rather than another arm of `POST /auth/factors/register`, because that one
 * CREATES a password and answers 409 when there is one already, and changing a password needs a
 * proof that creating one does not: the old password, or something just as good.
 *
 * **The current password is the proof, with one exception.** A session that used a sign-in link in
 * the last {@link LINK_STANDS_IN_FOR} has just proved the inbox, and proving the inbox is exactly
 * what a reset is, so it may set a new password without the old one. That is what lets the reset
 * link be a sign-in link that lands on the password form, rather than a second kind of token. It
 * grants nothing a sign-in link did not already: an account whose inbox somebody can read is one
 * they can sign in to today, and an account with an authenticator or a passkey still asks for it
 * at that sign-in and again here, through {@link StrongFactorGate}.
 *
 * **Every other session is signed out**, since the commonest reason to change a password is the
 * suspicion that somebody else has it. The caller's own session stays, so the page that asked is
 * still signed in when the answer arrives.
 *
 * **Every email address on the account is told**, after the commit and never at the cost of the
 * change, as the second-step reset notice is: a station with no mail server still changes a
 * password.
 */
@Injectable()
export class PasswordChangeService {
    constructor(
        private readonly authorizationContext: AuthorizationContext,
        private readonly passwordFactorService: PasswordFactorService,
        private readonly emailFactorService: EmailFactorService,
        private readonly strongFactorGate: StrongFactorGate,
        private readonly sessionActivity: SessionActivityService,
        private readonly mailService: MailService,
        private readonly afterCommit: AfterCommit,
        private readonly logger: Logger,
    ) {}

    /**
     * Set the caller's password, or replace the one they have.
     *
     * @throws {HttpError} 400 when the current password is needed and missing or wrong, or the new
     *   one is too weak or one of the last ten; 403 `step_up_required` when an authenticator or a
     *   passkey is enrolled and none was proved recently; 429 after too many wrong current passwords.
     */
    async setPassword(body: PasswordChange): Promise<void> {
        const { actorId, sessionToken } = this.authorizationContext.requireAuthentication();

        await this.strongFactorGate.assertRecentIfAnyEnrolled(actorId);

        const existing = await this.passwordFactorService.getFactor(actorId);
        if (existing) {
            if (!this.usedSignInLinkRecently()) await this.verifyCurrent(actorId, body.currentPassword);
            // Checks strength and refuses any of the last ten, which `changePassword` does not.
            await this.passwordFactorService.updatePasswordFactor(actorId, body.password);
        } else {
            await this.passwordFactorService.createPasswordFactor(actorId, body.password);
        }

        await this.sessionActivity.revokeAllOtherSessions(actorId, sessionToken);
        await this.tell(actorId, existing === undefined);
    }

    /** Whether this session proved the inbox through a link (or an emailed code) recently enough. */
    private usedSignInLinkRecently(): boolean {
        const actor = this.authorizationContext.requireUser();
        const now = DateTime.utc();
        return actor.factors.some(factor => factor.method === 'email' && isFactorRecent(factor, now, LINK_STANDS_IN_FOR));
    }

    /**
     * The current password, checked through the same rate-limited verify sign-in uses.
     *
     * A wrong one answers 400 rather than the library's 401: this route is reached signed in, and a
     * 401 reads to the console as a session that has ended, which would sign somebody out for a typo.
     */
    private async verifyCurrent(actorId: string, currentPassword: string | undefined): Promise<void> {
        if (currentPassword === undefined || currentPassword.length === 0) {
            throw httpError(400).withDetails({ currentPassword: 'the current password is needed to change it' });
        }
        try {
            await this.passwordFactorService.verifyPassword(actorId, currentPassword);
        } catch (error) {
            if (IsHttpError(error) && error.statusCode === 401) {
                throw httpError(400).withDetails({ currentPassword: 'that is not the current password' }).withCause(error);
            }
            throw error;
        }
    }

    private async tell(actorId: string, added: boolean): Promise<void> {
        if (!this.mailService.isConfigured()) return;
        const addresses = (await this.emailFactorService.listFactors(actorId, true)).map(factor => factor.value);
        if (addresses.length === 0) return;
        this.afterCommit.add(async () => {
            for (const to of addresses) {
                await this.mailService.send({ to, template: 'PasswordChanged', data: { added } }).catch((error: unknown) => {
                    this.logger.warn(
                        `authentication: could not tell ${to} their password changed (${error instanceof Error ? error.message : String(error)})`,
                    );
                });
            }
        });
    }
}
