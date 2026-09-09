import { DataRepository } from '#src/modules/data/data.repository.js';
import { EmailFactor, EmailFactorRepository } from '@maroonedsoftware/authentication';
import { Injectable } from 'injectkit';
import { sql } from 'kysely';

@Injectable()
export class DeadairEmailFactorRepository extends DataRepository implements EmailFactorRepository {
    async createFactor(actorId: string, value: string): Promise<EmailFactor> {
        value = value.trim().toLowerCase();
        const row = await this.db
            .insertInto('deadair.actorsEmailFactors')
            .values({
                actorId: actorId,
                value,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return this.toModel(row);
    }

    async listFactors(actorId: string, active?: boolean): Promise<EmailFactor[]> {
        let query = this.db.selectFrom('deadair.actorsEmailFactors').selectAll().where('actorId', '=', actorId);
        if (active !== undefined) {
            query = query.where('active', '=', active);
        }
        const rows = await query.execute();
        return rows.map(row => this.toModel(row));
    }

    async lookupFactor(actorId: string, value: string): Promise<EmailFactor | undefined> {
        value = value.trim().toLowerCase();
        const row = await this.db
            .selectFrom('deadair.actorsEmailFactors')
            .selectAll()
            .where('actorId', '=', actorId)
            .where(sql<string>`lower(value)`, '=', value)
            .executeTakeFirst();
        return row ? this.toModel(row) : undefined;
    }

    async findFactor(value: string): Promise<EmailFactor | undefined> {
        value = value.trim().toLowerCase();
        const row = await this.db
            .selectFrom('deadair.actorsEmailFactors')
            .selectAll()
            .where(sql<string>`lower(value)`, '=', value)
            .executeTakeFirst();
        return row ? this.toModel(row) : undefined;
    }

    async getFactor(actorId: string, factorId: string): Promise<EmailFactor> {
        const row = await this.db
            .selectFrom('deadair.actorsEmailFactors')
            .selectAll()
            .where('actorId', '=', actorId)
            .where('id', '=', factorId)
            .executeTakeFirstOrThrow();
        return this.toModel(row);
    }

    async isDomainInviteOnly(_domain: string): Promise<boolean> {
        return Promise.resolve(false);
    }

    async deleteFactor(actorId: string, factorId: string): Promise<void> {
        await this.db
            .updateTable('deadair.actorsEmailFactors')
            .set({ active: false })
            .where('actorId', '=', actorId)
            .where('id', '=', factorId)
            .execute();
    }

    private toModel(row: { id: string; actorId: string; value: string; active: boolean }): EmailFactor {
        return {
            id: row.id,
            actorId: row.actorId,
            value: row.value,
            active: row.active,
        };
    }
}
