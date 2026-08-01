import { DataRepository, DeadairActorsOidcFactors } from '#src/modules/data/data.repository.js';
import { OidcFactor, OidcFactorLookup, OidcFactorRepository, OidcFactorValue } from '@maroonedsoftware/authentication';
import { DateTime } from 'luxon';
import { Injectable } from 'injectkit';
import { Selectable, sql } from 'kysely';

@Injectable()
export class DeadairOidcFactorRepository extends DataRepository implements OidcFactorRepository {
    async createFactor(actorId: string, value: OidcFactorValue): Promise<OidcFactor> {
        const row = await this.db
            .insertInto('deadair.actorsOidcFactors')
            .values({
                actorId: actorId,
                provider: value.provider.toLowerCase(),
                subject: value.subject,
                email: value.email,
                picture: value.picture,
                encryptedRefreshToken: value.encryptedRefreshToken,
                encryptedRefreshTokenDek: value.encryptedRefreshTokenDek,
                refreshTokenExpiresAt: value.refreshTokenExpiresAt,
                active: true,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return this.toModel(row);
    }

    async listFactors(actorId: string, active?: boolean): Promise<OidcFactor[]> {
        let query = this.db.selectFrom('deadair.actorsOidcFactors').selectAll().where('actorId', '=', actorId);
        if (active !== undefined) {
            query = query.where('active', '=', active);
        }
        const rows = await query.execute();
        return rows.map(row => this.toModel(row));
    }

    async lookupFactor(actorId: string, value: OidcFactorLookup): Promise<OidcFactor | undefined> {
        const row = await this.db
            .selectFrom('deadair.actorsOidcFactors')
            .selectAll()
            .where('actorId', '=', actorId)
            .where(sql<string>`lower(provider)`, '=', value.provider.toLowerCase())
            .where('subject', '=', value.subject)
            .executeTakeFirst();
        return row ? this.toModel(row) : undefined;
    }

    async findFactor(value: OidcFactorLookup): Promise<OidcFactor | undefined> {
        const row = await this.db
            .selectFrom('deadair.actorsOidcFactors')
            .selectAll()
            .where(sql<string>`lower(provider)`, '=', value.provider.toLowerCase())
            .where('subject', '=', value.subject)
            .where('active', '=', true)
            .executeTakeFirst();
        return row ? this.toModel(row) : undefined;
    }

    async lookupFactorsByEmail(email: string): Promise<OidcFactor[]> {
        const rows = await this.db
            .selectFrom('deadair.actorsOidcFactors')
            .selectAll()
            .where(sql<string>`lower(email)`, '=', email.trim().toLowerCase())
            .where('active', '=', true)
            .execute();
        return rows.map(row => this.toModel(row));
    }

    async getFactor(actorId: string, factorId: string): Promise<OidcFactor> {
        const row = await this.db
            .selectFrom('deadair.actorsOidcFactors')
            .selectAll()
            .where('actorId', '=', actorId)
            .where('id', '=', factorId)
            .executeTakeFirstOrThrow();
        return this.toModel(row);
    }

    async updateRefreshToken(
        factorId: string,
        args: { encryptedRefreshToken: string; encryptedRefreshTokenDek: string; refreshTokenExpiresAt?: DateTime },
    ): Promise<void> {
        await this.db
            .updateTable('deadair.actorsOidcFactors')
            .set({
                encryptedRefreshToken: args.encryptedRefreshToken,
                encryptedRefreshTokenDek: args.encryptedRefreshTokenDek,
                refreshTokenExpiresAt: args.refreshTokenExpiresAt,
            })
            .where('id', '=', factorId)
            .execute();
    }

    async updateEmail(factorId: string, email: string): Promise<void> {
        await this.db.updateTable('deadair.actorsOidcFactors').set({ email }).where('id', '=', factorId).execute();
    }

    // Refresh the last-seen avatar URL on repeat sign-ins. Opt-in hook from the
    // OidcFactorRepository interface; the package calls it when the IdP profile
    // carries a `picture` claim.
    async updatePicture(factorId: string, picture: string): Promise<void> {
        await this.db.updateTable('deadair.actorsOidcFactors').set({ picture }).where('id', '=', factorId).execute();
    }

    async deleteFactor(actorId: string, factorId: string): Promise<void> {
        await this.db
            .updateTable('deadair.actorsOidcFactors')
            .set({ active: false })
            .where('actorId', '=', actorId)
            .where('id', '=', factorId)
            .execute();
    }

    private toModel(row: Selectable<DeadairActorsOidcFactors>): OidcFactor {
        return {
            id: row.id,
            actorId: row.actorId,
            active: row.active,
            provider: row.provider,
            subject: row.subject,
            email: row.email ?? undefined,
            picture: row.picture ?? undefined,
            encryptedRefreshToken: row.encryptedRefreshToken ?? undefined,
            encryptedRefreshTokenDek: row.encryptedRefreshTokenDek ?? undefined,
            refreshTokenExpiresAt: row.refreshTokenExpiresAt ?? undefined,
        };
    }
}
