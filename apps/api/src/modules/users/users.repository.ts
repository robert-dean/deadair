import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';
import { likeContains } from '#modules/catalog/catalog.query.js';
import { PLATFORM_NAMESPACE, PLATFORM_OBJECT_ID, type PlatformRoleName } from '#modules/permissions/platform.roles.js';

/** A person's account as the users list reads it, before their roles are narrowed to the one they hold. */
export interface UserRow {
    id: string;
    active: boolean;
    createdAt: DateTime;
    email?: string;
    roles: string[];
    lastSignInAt?: DateTime;
    hasStrongFactor: boolean;
}

export interface UserListOptions {
    limit: number;
    offset: number;
    sort: 'asc' | 'desc';
    search?: string;
    role?: PlatformRoleName;
    active?: boolean;
}

// Every column below is a correlated subquery on `a`, the actor being listed, rather than a join: a
// person has several factors and several sign-ins, and a join would multiply their row by both.
// Role tuples name the person by TEXT, so the uuid is cast to meet the column.
const ROLES = sql<string[]>`array(
    select t.relation from deadair.permissions_relation_tuples t
    where t.object_namespace = ${PLATFORM_NAMESPACE} and t.object_id = ${PLATFORM_OBJECT_ID}
      and t.subject_namespace = 'user' and t.subject_relation = '' and t.subject_id = a.id::text
)`;

const EMAIL = sql<string | null>`(
    select e.value from deadair.actors_email_factors e
    where e.actor_id = a.id and e.active order by e.created_at limit 1
)`;

const LAST_SIGN_IN = sql<DateTime | null>`(select max(l.occurred_at) from deadair.login_events l where l.actor_id = a.id)`;

const HAS_STRONG_FACTOR = sql<boolean>`(
    exists (select 1 from deadair.actors_authenticator_factors f where f.actor_id = a.id and f.active)
    or exists (select 1 from deadair.actors_fido_factors f where f.actor_id = a.id and f.active)
)`;

/**
 * The station's people: `deadair.actors` of type `user`, with what the console shows beside each.
 *
 * Read only. The address is the person's oldest active email factor, which is the one they were made
 * with; a person may add more, and the list shows one rather than repeating the row.
 */
@Injectable()
export class UsersRepository extends DataRepository {
    async list(options: UserListOptions): Promise<{ total: number; data: UserRow[] }> {
        let scoped = this.db.selectFrom('deadair.actors as a').where('a.type', '=', 'user');
        if (options.active !== undefined) scoped = scoped.where('a.active', '=', options.active);
        if (options.role) scoped = scoped.where(sql<boolean>`${options.role} = any(${ROLES})`);
        if (options.search) {
            const pattern = likeContains(options.search);
            scoped = scoped.where(
                sql<boolean>`exists (select 1 from deadair.actors_email_factors s where s.actor_id = a.id and s.value ilike ${pattern})`,
            );
        }

        const [count, rows] = await Promise.all([
            scoped.select(eb => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
            scoped
                .select(['a.id', 'a.active', 'a.createdAt'])
                .select([EMAIL.as('email'), ROLES.as('roles'), LAST_SIGN_IN.as('lastSignInAt'), HAS_STRONG_FACTOR.as('hasStrongFactor')])
                .orderBy('a.createdAt', options.sort)
                .orderBy('a.id')
                .limit(options.limit)
                .offset(options.offset)
                .execute(),
        ]);

        return { total: Number(count.total), data: rows.map(toUserRow) };
    }

    async get(id: string): Promise<UserRow | undefined> {
        const row = await this.db
            .selectFrom('deadair.actors as a')
            .where('a.type', '=', 'user')
            .where('a.id', '=', id)
            .select(['a.id', 'a.active', 'a.createdAt'])
            .select([EMAIL.as('email'), ROLES.as('roles'), LAST_SIGN_IN.as('lastSignInAt'), HAS_STRONG_FACTOR.as('hasStrongFactor')])
            .executeTakeFirst();
        return row ? toUserRow(row) : undefined;
    }
}

function toUserRow(row: {
    id: string;
    active: boolean;
    createdAt: DateTime;
    email: string | null;
    roles: string[] | null;
    lastSignInAt: DateTime | null;
    hasStrongFactor: boolean;
}): UserRow {
    return {
        id: row.id,
        active: row.active,
        createdAt: row.createdAt,
        ...(row.email == null ? {} : { email: row.email }),
        roles: row.roles ?? [],
        ...(row.lastSignInAt == null ? {} : { lastSignInAt: row.lastSignInAt }),
        hasStrongFactor: row.hasStrongFactor,
    };
}
