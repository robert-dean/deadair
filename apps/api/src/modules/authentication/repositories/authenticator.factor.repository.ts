import { DataRepository } from '#src/modules/data/data.repository.js';
import { AuthenticatorFactor, AuthenticatorFactorOptions, AuthenticatorFactorRepository } from '@maroonedsoftware/authentication';
import { Injectable } from 'injectkit';

@Injectable()
export class DeadairAuthenticatorFactorRepository extends DataRepository implements AuthenticatorFactorRepository {
    async createFactor(actorId: string, options: AuthenticatorFactorOptions): Promise<AuthenticatorFactor> {
        const row = await this.db
            .insertInto('deadair.actorsAuthenticatorFactors')
            .values({
                actorId: actorId,
                secret: options.secretHash,
                secretDek: '',
                type: options.type,
                algorithm: options.algorithm,
                tokenLength: options.tokenLength,
                periodSeconds: options.periodSeconds ?? 30,
                counter: options.counter ?? 0,
                label: options.label,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return this.toModel(row);
    }

    async listFactors(actorId: string, active?: boolean): Promise<AuthenticatorFactor[]> {
        let query = this.db.selectFrom('deadair.actorsAuthenticatorFactors').selectAll().where('actorId', '=', actorId);
        if (active !== undefined) {
            query = query.where('active', '=', active);
        }
        const rows = await query.execute();
        return rows.map(row => this.toModel(row));
    }

    async lookupFactor(actorId: string, label: string): Promise<AuthenticatorFactor | undefined> {
        const row = await this.db
            .selectFrom('deadair.actorsAuthenticatorFactors')
            .selectAll()
            .where('actorId', '=', actorId)
            .where('label', '=', label)
            .executeTakeFirst();
        return row ? this.toModel(row) : undefined;
    }

    async getFactor(actorId: string, factorId: string): Promise<AuthenticatorFactor> {
        const row = await this.db
            .selectFrom('deadair.actorsAuthenticatorFactors')
            .selectAll()
            .where('actorId', '=', actorId)
            .where('id', '=', factorId)
            .executeTakeFirstOrThrow();
        return this.toModel(row);
    }

    /**
     * Advance the stored counter past the step that just validated.
     *
     * Required by ServerKit v5. Without it an HOTP code stays valid forever,
     * since nothing else moves the counter, and the TOTP replay guard has no
     * high-water mark to compare against.
     */
    async updateFactorCounter(actorId: string, factorId: string, counter: number): Promise<void> {
        await this.db
            .updateTable('deadair.actorsAuthenticatorFactors')
            .set({ counter })
            .where('actorId', '=', actorId)
            .where('id', '=', factorId)
            .execute();
    }

    async deleteFactor(actorId: string, factorId: string): Promise<void> {
        await this.db
            .updateTable('deadair.actorsAuthenticatorFactors')
            .set({ active: false })
            .where('actorId', '=', actorId)
            .where('id', '=', factorId)
            .execute();
    }

    private toModel(row: {
        id: string;
        actorId: string;
        active: boolean;
        secret: string;
        type: string;
        algorithm: 'sha1' | 'sha256' | 'sha512';
        tokenLength: number;
        periodSeconds: number;
        counter: number;
        label: string | null;
    }): AuthenticatorFactor {
        return {
            id: row.id,
            actorId: row.actorId,
            active: row.active,
            secretHash: row.secret,
            type: row.type as 'totp' | 'hotp',
            algorithm: row.algorithm,
            tokenLength: row.tokenLength,
            periodSeconds: row.periodSeconds,
            counter: row.counter,
            label: row.label ?? undefined,
        };
    }
}
