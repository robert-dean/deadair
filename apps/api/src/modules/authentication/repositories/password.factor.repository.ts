import { DB, DeadairActorsPasswordFactors } from '#src/modules/data/db.js';
import { PasswordFactor, PasswordFactorRepository, PasswordValue } from '@maroonedsoftware/authentication';
import { Kysely, Selectable } from 'kysely';
import { Injectable } from 'injectkit';
import { OnPostgresError } from '@maroonedsoftware/errors';
import { OnKyselyError } from '@maroonedsoftware/kysely';

@Injectable()
@OnPostgresError()
@OnKyselyError()
export class DeadairPasswordFactorRepository extends PasswordFactorRepository {
    constructor(protected readonly db: Kysely<DB>) {
        super();
    }

    private parseRow(row: Selectable<DeadairActorsPasswordFactors>): PasswordFactor {
        return {
            id: row.actorId,
            actorId: row.actorId,
            hash: row.hash,
            salt: row.salt,
            value: {
                hash: row.hash,
                salt: row.salt,
            },
            active: row.active,
            needsReset: row.needsReset,
        };
    }

    async createFactor(actorId: string, value: PasswordValue): Promise<PasswordFactor> {
        const row = await this.db
            .insertInto('deadair.actorsPasswordFactors')
            .values({
                actorId: actorId,
                hash: value.hash,
                salt: value.salt,
                needsReset: value.needsReset ?? false,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return this.parseRow(row);
    }

    async listFactors(actorId: string, active?: boolean): Promise<PasswordFactor[]> {
        let query = this.db.selectFrom('deadair.actorsPasswordFactors').selectAll().where('actorId', '=', actorId);
        if (active !== undefined) {
            query = query.where('active', '=', active);
        }
        const rows = await query.execute();
        return rows.map(row => this.parseRow(row));
    }

    // PasswordFactorRepository extends FactorRepository<PasswordFactor, PasswordValue>, leaving LookupValue
    // at the default `string`. Password factors aren't actually looked up by value (the library never calls
    // this), but the interface requires the method, so we stub it.
    async lookupFactor(_actorId: string, _value: string): Promise<PasswordFactor | undefined> {
        return undefined;
    }

    async listPreviousPasswords(actorId: string, limit: number): Promise<PasswordValue[]> {
        const rows = await this.db
            .selectFrom('deadair.actorsPasswordFactorsArchive')
            .select(['hash', 'salt'])
            .where('actorId', '=', actorId)
            .orderBy('archivedAt', 'desc')
            .limit(limit)
            .execute();
        return rows;
    }

    async updateFactor(actorId: string, value: PasswordValue): Promise<PasswordFactor> {
        // Archive the current hash before overwriting it so listPreviousPasswords can
        // enforce the no-reuse policy. The select+insert runs inside the request transaction,
        // so it is atomic with the update below.
        const current = await this.db
            .selectFrom('deadair.actorsPasswordFactors')
            .select(['hash', 'salt'])
            .where('actorId', '=', actorId)
            .executeTakeFirst();
        if (current) {
            await this.db
                .insertInto('deadair.actorsPasswordFactorsArchive')
                .values({ actorId: actorId, hash: current.hash, salt: current.salt })
                .execute();
        }

        const row = await this.db
            .updateTable('deadair.actorsPasswordFactors')
            .set({
                hash: value.hash,
                salt: value.salt,
                needsReset: value.needsReset ?? false,
            })
            .where('actorId', '=', actorId)
            .returningAll()
            .executeTakeFirstOrThrow();
        return this.parseRow(row);
    }

    // The library's interface types `getFactor` as `Promise<PasswordFactor>` but
    // every caller in @maroonedsoftware/authentication checks `if (!factor)` —
    // i.e. it must resolve to `undefined` when no factor exists. The previous
    // `executeTakeFirstOrThrow` made `createPasswordFactor` blow up on a fresh
    // actor before the existence check could run. The cast preserves the
    // declared interface signature while honouring the runtime contract.
    // Password factors are 1:1 with actors (PK = actorId), so
    // we ignore `factorId` and key off `actorId` only — callers in the library
    // pass the actorId twice (`getFactor(actorId, actorId)`).
    async getFactor(actorId: string, _factorId: string): Promise<PasswordFactor> {
        const row = await this.db.selectFrom('deadair.actorsPasswordFactors').selectAll().where('actorId', '=', actorId).executeTakeFirst();
        return (row ? this.parseRow(row) : undefined) as PasswordFactor;
    }

    async deleteFactor(actorId: string, _factorId?: string): Promise<void> {
        await this.db.updateTable('deadair.actorsPasswordFactors').set({ active: false }).where('actorId', '=', actorId).execute();
    }
}
