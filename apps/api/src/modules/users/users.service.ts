import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { PLATFORM_ROLE_NAMES, isPlatformRoleName } from '#modules/permissions/platform.roles.js';
import { ActorsRepository } from '#modules/authentication/repositories/actors.repository.js';
import { SessionActivityService } from '#modules/authentication/session.activity.service.js';
import { UsersRepository, type UserRow } from './users.repository.js';
import { UserDetail, UserPage, type UserQueryInput, type UserSignIn, type UserSummary } from './types/users.types.js';

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
}
