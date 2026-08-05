import { AuthenticationFactor } from '#modules/authentication/types/authentication.types.js';
import { DataRepository } from '#src/modules/data/data.repository.js';
import { Injectable } from 'injectkit';
import { sql } from 'kysely';

type ActorType = 'user' | 'system' | 'vendor';

@Injectable()
export class ActorsRepository extends DataRepository {
    async create(type: ActorType, active: boolean = true) {
        return await this.db.insertInto('deadair.actors').values({ type, active }).returningAll().executeTakeFirstOrThrow();
    }

    async get(id: string, active?: boolean) {
        return await this.db
            .selectFrom('deadair.actors')
            .selectAll()
            .where('id', '=', id)
            .$if(active !== undefined, eb => eb.where('active', '=', active!))
            .executeTakeFirstOrThrow();
    }

    // Cheap existence probe for callers that hold an id from outside Postgres — a session in
    // Redis, a JWT subject — and need to know the actor is still real before trusting it. `get`
    // throws and selects every column; this answers the only question those callers have.
    async existsActive(id: string): Promise<boolean> {
        const row = await this.db
            .selectFrom('deadair.actors')
            .select(sql`1`.as('one'))
            .where('id', '=', id)
            .where('active', '=', true)
            .limit(1)
            .executeTakeFirst();
        return row !== undefined;
    }

    async update(id: string, active: boolean) {
        return await this.db.updateTable('deadair.actors').set({ active }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    }

    async listFactors(actorId: string, active?: boolean): Promise<AuthenticationFactor[]> {
        return (await this.db
            .selectFrom('deadair.actorsEmailFactors')
            .select([
                sql.lit('email').as('method'),
                sql.lit('possession').as('kind'),
                'id as methodId',
                sql<string>`regexp_replace(value, '^(.).*(@.*)$', '\\1***\\2')`.as('label'),
            ])
            .where('actorId', '=', actorId)
            .$if(active !== undefined, eb => eb.where('active', '=', active!))
            .unionAll(
                this.db
                    .selectFrom('deadair.actorsPasswordFactors')
                    .select([
                        sql.lit('password').as('method'),
                        sql.lit('knowledge').as('kind'),
                        'actorId as methodId',
                        sql.lit('password').as('label'),
                    ])
                    .where('actorId', '=', actorId)
                    .$if(active !== undefined, eb => eb.where('active', '=', active!)),
            )
            .unionAll(
                this.db
                    .selectFrom('deadair.actorsAuthenticatorFactors')
                    .select([
                        sql.lit('authenticator').as('method'),
                        sql.lit('possession').as('kind'),
                        'id as methodId',
                        sql<string>`coalesce(label, 'Authenticator')`.as('label'),
                    ])
                    .where('actorId', '=', actorId)
                    .$if(active !== undefined, eb => eb.where('active', '=', active!)),
            )
            .unionAll(
                this.db
                    .selectFrom('deadair.actorsFidoFactors')
                    .select([
                        sql.lit('fido').as('method'),
                        sql.lit('possession').as('kind'),
                        'id as methodId',
                        sql<string>`coalesce(label, 'Security Key')`.as('label'),
                    ])
                    .where('actorId', '=', actorId)
                    .$if(active !== undefined, eb => eb.where('active', '=', active!)),
            )
            .unionAll(
                this.db
                    .selectFrom('deadair.actorsOidcFactors')
                    .select([sql.lit('oidc').as('method'), sql.lit('possession').as('kind'), 'id as methodId', 'provider as label'])
                    .where('actorId', '=', actorId)
                    .$if(active !== undefined, eb => eb.where('active', '=', active!)),
            )
            .execute()) as AuthenticationFactor[];
    }
}
