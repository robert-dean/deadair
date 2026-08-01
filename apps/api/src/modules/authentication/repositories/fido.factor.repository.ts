import { DataRepository } from '#src/modules/data/data.repository.js';
import { FidoFactor, FidoFactorOptions, FidoFactorRepository } from '@maroonedsoftware/authentication';
import { Injectable } from 'injectkit';

@Injectable()
export class DeadairFidoFactorRepository extends DataRepository implements FidoFactorRepository {
    async createFactor(actorId: string, options: FidoFactorOptions): Promise<FidoFactor> {
        const row = await this.db
            .insertInto('deadair.actorsFidoFactors')
            .values({
                actorId: actorId,
                publicKey: options.publicKey,
                publicKeyId: options.publicKeyId,
                counter: options.counter,
                active: true,
                label: options.label,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return this.toModel(row);
    }

    async listFactors(actorId: string, active?: boolean): Promise<FidoFactor[]> {
        let query = this.db.selectFrom('deadair.actorsFidoFactors').selectAll().where('actorId', '=', actorId);
        if (active !== undefined) {
            query = query.where('active', '=', active);
        }
        const rows = await query.execute();
        return rows.map(row => this.toModel(row));
    }

    async getFactor(actorId: string, factorId: string): Promise<FidoFactor> {
        const row = await this.db
            .selectFrom('deadair.actorsFidoFactors')
            .selectAll()
            .where('actorId', '=', actorId)
            .where('id', '=', factorId)
            .executeTakeFirstOrThrow();
        return this.toModel(row);
    }

    async lookupFactor(actorId: string, credentiaId: string): Promise<FidoFactor | undefined> {
        const row = await this.db
            .selectFrom('deadair.actorsFidoFactors')
            .selectAll()
            .where('actorId', '=', actorId)
            .where('publicKeyId', '=', credentiaId)
            .executeTakeFirst();
        return row ? this.toModel(row) : undefined;
    }

    async updateFactorCounter(actorId: string, factorId: string, counter: number): Promise<void> {
        await this.db.updateTable('deadair.actorsFidoFactors').set({ counter }).where('actorId', '=', actorId).where('id', '=', factorId).execute();
    }

    async deleteFactor(actorId: string, factorId: string): Promise<void> {
        await this.db
            .updateTable('deadair.actorsFidoFactors')
            .set({ active: false })
            .where('actorId', '=', actorId)
            .where('id', '=', factorId)
            .execute();
    }

    private toModel(row: { id: string; actorId: string; active: boolean; publicKey: string; publicKeyId: string; counter: number }): FidoFactor {
        return {
            id: row.id,
            actorId: row.actorId,
            active: row.active,
            publicKey: row.publicKey,
            publicKeyId: row.publicKeyId,
            counter: row.counter,
        };
    }
}
