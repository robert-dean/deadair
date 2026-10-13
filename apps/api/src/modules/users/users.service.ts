import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { AuthenticationSessionService, AuthenticatorFactorService, FidoFactorService } from '@maroonedsoftware/authentication';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { PlatformRoleService } from '#modules/permissions/platform.role.service.js';
import { PLATFORM_ROLE_NAMES, isPlatformRoleName } from '#modules/permissions/platform.roles.js';
import { ActorsRepository } from '#modules/authentication/repositories/actors.repository.js';
import { SessionActivityService } from '#modules/authentication/session.activity.service.js';
import { StrongFactorGate } from '#modules/authentication/strong.factor.gate.js';
import { AfterCommit } from '#modules/data/after.commit.js';
import { MailService } from '#modules/mail/mail.service.js';
import { Logger } from '@maroonedsoftware/logger';
import { UsersRepository, type UserRow } from './users.repository.js';
import { UserDetail, UserPage, UserSummary, type UserQueryInput, type UserRoleChange, type UserSignIn } from './types/users.types.js';

/** How many recent sign-ins a person's page shows. */
export const RECENT_SIGN_INS = 20;

/** The highest role a person holds, by `PLATFORM_ROLE_NAMES` order, for an account older than the one-role rule. */
const roleFrom = (roles: ReadonlyArray<string>) => PLATFORM_ROLE_NAMES.find(role => roles.filter(isPlatformRoleName).includes(role));

const toSummary = (row: UserRow): UserSummary => {
    const role = roleFrom(row.roles);
    return {
        id: row.id,
        ...(row.email === undefined ? {} : { email: row.email }),
        ...(role === undefined ? {} : { role }),
        active: row.active,
        createdAt: row.createdAt,
        ...(row.lastSignInAt === undefined ? {} : { lastSignInAt: row.lastSignInAt }),
        hasStrongFactor: row.hasStrongFactor,
    };
};

/**
 * The station's people, read by an operator.
 *
 * The contract already gates both routes on `platform.manage`; `requirePlatformRole` repeats it here
 * because a service is also reachable from code that never passed through the router.
 */
@Injectable()
export class UsersService {
    constructor(
        private readonly users: UsersRepository,
        private readonly actors: ActorsRepository,
        private readonly sessions: SessionActivityService,
        private readonly authz: AuthorizationContext,
        private readonly platformRoles: PlatformRoleService,
        private readonly strongFactorGate: StrongFactorGate,
        private readonly sessionService: AuthenticationSessionService,
        private readonly authenticatorFactors: AuthenticatorFactorService,
        private readonly fidoFactors: FidoFactorService,
        private readonly mail: MailService,
        private readonly afterCommit: AfterCommit,
        private readonly logger: Logger,
    ) {}

    async list(query: UserQueryInput): Promise<UserPage> {
        this.authz.requirePlatformRole('admin');
        const { page, pageSize, sort, search, role, active } = query;
        const { total, data } = await this.users.list({
            limit: pageSize,
            offset: page * pageSize,
            sort,
            ...(search === undefined ? {} : { search }),
            ...(role === undefined ? {} : { role }),
            ...(active === undefined ? {} : { active }),
        });
        return await parseAndValidate({ meta: { page, pageSize, sort, total }, data: data.map(toSummary) }, UserPage);
    }

    async get(id: string): Promise<UserDetail> {
        this.authz.requirePlatformRole('admin');
        const row = await this.users.get(id);
        if (!row) throw httpError(404);

        const [factors, sessions, signIns] = await Promise.all([
            this.actors.listFactors(id, true),
            this.sessions.listSessionsForActor(id),
            this.sessions.listLoginsForActor(id, { limit: RECENT_SIGN_INS, offset: 0 }),
        ]);

        return await parseAndValidate(
            {
                ...toSummary(row),
                factors: factors.map(factor => ({
                    method: factor.method,
                    methodId: factor.methodId,
                    kind: factor.kind,
                    ...(factor.label == null ? {} : { label: factor.label }),
                })),
                sessions,
                signIns: signIns.data.map((event): UserSignIn => ({
                    occurredAt: event.occurredAt,
                    method: event.factorType,
                    mfaSatisfied: event.mfaSatisfied,
                    ...(event.ip == null ? {} : { ip: event.ip }),
                    ...(event.userAgent == null ? {} : { userAgent: event.userAgent }),
                })),
            },
            UserDetail,
        );
    }

    /** Give a person `role`, which replaces the one they held. */
    async changeRole(id: string, body: UserRoleChange): Promise<UserSummary> {
        const callerId = await this.beginWrite();
        await this.requirePerson(id);
        await this.platformRoles.assertMayReassign(callerId, id, body.role);
        await this.platformRoles.assign(id, body.role, callerId);
        return await this.summaryOf(id);
    }

    /**
     * Switch a person off. Nothing is deleted: their API keys, connected apps and chat links stay as
     * they were and work again once they are switched back on, because every path that would use them
     * already refuses an inactive account. Only their sessions are ended, so a page they have open
     * stops at once rather than on its next refresh.
     */
    async deactivate(id: string): Promise<UserSummary> {
        const callerId = await this.beginWrite();
        await this.requirePerson(id);
        await this.platformRoles.assertMayDeactivate(callerId, id);
        await this.actors.update(id, false);
        await this.sessionService.revokeAllForSubject(id, 'logout');
        return await this.summaryOf(id);
    }

    async reactivate(id: string): Promise<UserSummary> {
        await this.beginWrite();
        await this.requirePerson(id);
        await this.actors.update(id, true);
        return await this.summaryOf(id);
    }

    async signOut(id: string): Promise<void> {
        await this.beginWrite();
        await this.requirePerson(id);
        await this.sessionService.revokeAllForSubject(id, 'logout');
    }

    /**
     * Remove a person's authenticator apps and passkeys, for a lost device, and sign them out. This is
     * the one action here that deletes rows, because a factor nobody holds any more is the thing being
     * removed. Allowed on your own account: an admin locked out of their phone by a broken device and
     * still signed in on the console is exactly who needs it.
     */
    async resetMfa(id: string): Promise<void> {
        await this.beginWrite();
        await this.requirePerson(id);
        const [authenticators, passkeys] = await Promise.all([this.authenticatorFactors.listFactors(id), this.fidoFactors.listFactors(id)]);
        for (const factor of authenticators) await this.authenticatorFactors.deleteFactor(id, factor.id);
        for (const factor of passkeys) await this.fidoFactors.deleteFactor(id, factor.id);
        await this.sessionService.revokeAllForSubject(id, 'logout');

        // A notice to the person, so a reset they did not ask for is noticed. After the commit, and
        // never allowed to undo the reset: a station with no mail server, or one that refuses,
        // still resets a lost device, and the admin who did it can tell them.
        const person = await this.users.get(id);
        if (person?.email && this.mail.isConfigured()) {
            const to = person.email;
            this.afterCommit.add(async () => {
                await this.mail.send({ to, template: 'SecondFactorReset', data: {} }).catch((error: unknown) => {
                    this.logger.warn(
                        `users: could not tell ${to} their second step was reset (${error instanceof Error ? error.message : String(error)})`,
                    );
                });
            });
        }
    }

    /** An admin, who has proved a strong factor recently if they hold one. Answers who is acting. */
    private async beginWrite(): Promise<string> {
        this.authz.requirePlatformRole('admin');
        const { actorId } = this.authz.requireUser();
        await this.strongFactorGate.assertRecentIfAnyEnrolled(actorId);
        return actorId;
    }

    private async requirePerson(id: string): Promise<UserRow> {
        const row = await this.users.get(id);
        if (!row) throw httpError(404);
        return row;
    }

    private async summaryOf(id: string): Promise<UserSummary> {
        return await parseAndValidate(toSummary(await this.requirePerson(id)), UserSummary);
    }
}
