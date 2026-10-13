import { Injectable } from 'injectkit';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { CacheProvider } from '@maroonedsoftware/cache';
import { httpError } from '@maroonedsoftware/errors';
import { AuthenticatorFactorService, EmailFactorRepository, FidoFactorService, PasswordFactorService } from '@maroonedsoftware/authentication';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { Duration } from 'luxon';
import { ErrorCodes } from '@deadair/error-codes';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { PlatformRoleService } from '#modules/permissions/platform.role.service.js';
import { ActorsRepository } from '#modules/authentication/repositories/actors.repository.js';
import { PasskeyRelyingParty } from '#modules/authentication/passkey.relying.party.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { InvitationsRepository, type InvitationRow } from './invitations.repository.js';
import { InvitationAcceptLimiter } from './invitation.accept.limiter.js';
import { hashInvitationToken } from './invitation.token.js';
import {
    InvitationAccepted,
    InvitationAcceptStartResponse,
    InvitationDetails,
    type InvitationAccept,
    type InvitationAcceptStart,
    type InvitationToken,
} from './types/invitations.types.js';

/** What `start` remembers until `accept`: the account id the second step was set up against. */
interface PendingAcceptance {
    actorId: string;
    tokenHash: string;
}

/** How long a started acceptance waits for its second step. The second-factor registrations last about this long too. */
const PENDING_FOR = Duration.fromObject({ minutes: 15 });

const pendingKey = (registrationId: string) => `invitations:accept:${registrationId}`;

/**
 * Accepting an invitation, on the invite page, by somebody with no account yet.
 *
 * Three calls, none of them a GET and none made on page load, so a mail scanner or a link preview
 * that fetches the link spends nothing:
 *
 * - `details` says what the invitation is for. It changes nothing.
 * - `start` checks the password and sets up the second step (an authenticator app or a passkey)
 *   against an account id chosen now, for an account that does not exist yet. Nothing is saved;
 *   the second-factor registration and the id wait in the cache.
 * - `accept` makes the account with that id, spends the invitation, writes the password, proves
 *   and writes the second step, and grants the role. It runs in the request's transaction, so a
 *   wrong code, a refused passkey or anything else rolls all of it back, and the link still works.
 *
 * So an invited person ends up exactly as an onboarded admin does, address and password, plus the
 * second step the phone apps need. The address is the one the admin invited, which the person
 * cannot change here; only they can, later, from their own Sign-in and security page.
 *
 * A dead invitation, whether unknown, used, withdrawn or out of time, is one 404 that does not say
 * which, as a dead party pass is.
 */
@Injectable()
export class InvitationAcceptService {
    constructor(
        private readonly invitations: InvitationsRepository,
        private readonly limiter: InvitationAcceptLimiter,
        private readonly actors: ActorsRepository,
        private readonly emailFactors: EmailFactorRepository,
        private readonly passwordFactors: PasswordFactorService,
        private readonly authenticatorFactors: AuthenticatorFactorService,
        private readonly fidoFactors: FidoFactorService,
        private readonly passkeyRelyingParty: PasskeyRelyingParty,
        private readonly platformRoles: PlatformRoleService,
        private readonly cache: CacheProvider,
        private readonly authz: AuthorizationContext,
        private readonly config: AppConfig,
    ) {}

    async details(body: InvitationToken): Promise<InvitationDetails> {
        const invitation = await this.open(body.token);
        return await parseAndValidate(
            { email: invitation.email, role: invitation.role, stationName: this.stationName(), expiresAt: invitation.expiresAt },
            InvitationDetails,
        );
    }

    async start(body: InvitationAcceptStart): Promise<InvitationAcceptStartResponse> {
        const invitation = await this.open(body.token);
        await this.refuseTakenAddress(invitation.email);
        await this.passwordFactors.ensurePasswordStrength(body.password, invitation.email);

        const actorId = randomUUID();
        const tokenHash = hashInvitationToken(body.token);

        if (body.method === 'authenticator') {
            const setup = await this.authenticatorFactors.registerAuthenticatorFactor(actorId);
            await this.remember(setup.registrationId, { actorId, tokenHash });
            return await parseAndValidate(
                { method: 'authenticator', registrationId: setup.registrationId, secret: setup.secret, uri: setup.uri, qrCode: setup.qrCode },
                InvitationAcceptStartResponse,
            );
        }

        const { rpId, rpOrigin, rpName } = this.passkeyRelyingParty.resolve();
        const setup = await this.fidoFactors.registerFidoFactor(actorId, {
            userName: invitation.email,
            userDisplayName: invitation.email,
            rpId,
            rpOrigin,
            rpName,
        });
        await this.remember(setup.registrationId, { actorId, tokenHash });
        return await parseAndValidate(
            { method: 'fido', registrationId: setup.registrationId, attestation: setup.attestation },
            InvitationAcceptStartResponse,
        );
    }

    async accept(body: InvitationAccept): Promise<InvitationAccepted> {
        await this.consumeLimit();
        const tokenHash = hashInvitationToken(body.token);
        const pending = await this.recall(body.registrationId);
        // A registration started for a different invitation, or one that has lapsed, is as dead as a
        // dead invitation: the person starts again from the page, which costs them a minute.
        if (!pending || pending.tokenHash !== tokenHash) throw this.gone();

        const invitation = await this.invitations.openByHash(tokenHash);
        if (!invitation) throw this.gone();
        await this.refuseTakenAddress(invitation.email);
        await this.passwordFactors.ensurePasswordStrength(body.password, invitation.email);

        // The account first, so everything after it has a row to point at; then the invitation is
        // spent in one conditional statement, which is what makes it single-use under a race.
        await this.actors.create('user', true, pending.actorId);
        if (!(await this.invitations.consume(tokenHash, pending.actorId))) throw this.gone();

        await this.emailFactors.createFactor(pending.actorId, invitation.email);
        await this.passwordFactors.createPasswordFactor(pending.actorId, body.password);
        if (body.method === 'authenticator') {
            await this.authenticatorFactors.createAuthenticatorFactorFromRegistration(pending.actorId, body.registrationId, body.code);
        } else {
            await this.fidoFactors.createFidoFactorFromRegistration(pending.actorId, body.registrationId, body.credential);
        }
        // Granted by whoever invited them, which is who decided it.
        await this.platformRoles.assign(pending.actorId, invitation.role, invitation.invitedBy ?? pending.actorId);

        await this.cache.delete(pendingKey(body.registrationId));
        return await parseAndValidate({ email: invitation.email, role: invitation.role }, InvitationAccepted);
    }

    /** The open invitation a token names, after spending this address's allowance. Anything else is one 404. */
    private async open(token: string): Promise<InvitationRow> {
        await this.consumeLimit();
        const invitation = await this.invitations.openByHash(hashInvitationToken(token));
        if (!invitation) throw this.gone();
        return invitation;
    }

    private async consumeLimit(): Promise<void> {
        await this.limiter.consume(this.authz.request.clientAddress ?? this.authz.request.ipAddress ?? 'unknown');
    }

    /** An address that gained an account since it was invited: the invitation can only make a second one. */
    private async refuseTakenAddress(email: string): Promise<void> {
        if (await this.emailFactors.findFactor(email)) {
            throw httpError(409).withDetails({
                code: ErrorCodes.INVITATION_ALREADY_MEMBER,
                message: 'that address already has an account; sign in with it instead',
            });
        }
    }

    private gone() {
        return httpError(404).withDetails({ message: 'this invitation is not open: it may have been used, withdrawn or run out of time' });
    }

    private async remember(registrationId: string, pending: PendingAcceptance): Promise<void> {
        await this.cache.set(pendingKey(registrationId), JSON.stringify(pending), PENDING_FOR);
    }

    private async recall(registrationId: string): Promise<PendingAcceptance | undefined> {
        const stored = await this.cache.get(pendingKey(registrationId));
        return stored ? (JSON.parse(stored) as PendingAcceptance) : undefined;
    }

    /** What the invite page and the authenticator app call the station. */
    private stationName(): string {
        const title = String(this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title)).trim();
        return title.length > 0 ? title : STREAM_DEFAULTS.title;
    }
}
