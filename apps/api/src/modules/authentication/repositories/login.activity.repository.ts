import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { DataRepository } from '#src/modules/data/data.repository.js';
import { AuthenticationFactorMethod } from '@maroonedsoftware/authentication';

export type LoginEventInsert = {
    actorId: string;
    factorType: string;
    factorId?: string | null;
    sessionToken?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    mfaSatisfied: boolean;
};

export type FailureCounterUpsert = {
    identifier: string;
    factorType: AuthenticationFactorMethod | 'refresh';
    ip: string;
    actorId?: string | null;
    lastReason?: string | null;
};

const BUCKET_WIDTH_MS = 5 * 60 * 1000;

export const hashIdentifier = (identifier: string): string => createHash('sha256').update(identifier.trim().toLowerCase()).digest('hex');

const truncateToBucket = (now: DateTime = DateTime.utc()): DateTime =>
    DateTime.fromMillis(Math.floor(now.toMillis() / BUCKET_WIDTH_MS) * BUCKET_WIDTH_MS, { zone: 'utc' });

@Injectable()
export class LoginActivityRepository extends DataRepository {
    async insertLogin(event: LoginEventInsert): Promise<void> {
        await this.db
            .insertInto('deadair.loginEvents')
            .values({
                actorId: event.actorId,
                factorType: event.factorType,
                factorId: event.factorId ?? null,
                sessionToken: event.sessionToken ?? null,
                ip: event.ip ?? null,
                userAgent: event.userAgent ?? null,
                mfaSatisfied: event.mfaSatisfied,
            })
            .execute();
    }

    async upsertFailure(input: FailureCounterUpsert): Promise<void> {
        const bucketStart = truncateToBucket();
        const identifierHash = hashIdentifier(input.identifier);

        await this.db
            .insertInto('deadair.loginFailureCounters')
            .values({
                bucketStart,
                identifierHash,
                factorType: input.factorType,
                ip: input.ip,
                attemptCount: 1,
                lastReason: input.lastReason ?? null,
                actorId: input.actorId ?? null,
                identifier: input.identifier,
            })
            .onConflict(oc =>
                oc.columns(['bucketStart', 'identifierHash', 'factorType', 'ip']).doUpdateSet({
                    // The conflict target is referenced by its bare table name here. Postgres
                    // exposes the insert target to DO UPDATE unqualified, so any schema prefix
                    // (`deadair.` included) resolves to a relation that isn't in scope.
                    attemptCount: sql`login_failure_counters.attempt_count + 1`,
                    lastReason: input.lastReason ?? null,
                    actorId: input.actorId ?? null,
                    lastSeenAt: sql`now()`,
                }),
            )
            .execute();
    }

    async listLoginsForActor(actorId: string, limit: number, offset: number) {
        const [rows, count] = await Promise.all([
            this.db
                .selectFrom('deadair.loginEvents')
                .selectAll()
                .where('actorId', '=', actorId)
                .orderBy('occurredAt', 'desc')
                .limit(limit)
                .offset(offset)
                .execute(),
            this.db
                .selectFrom('deadair.loginEvents')
                .where('actorId', '=', actorId)
                .select(eb => eb.fn.countAll<number>().as('total'))
                .executeTakeFirstOrThrow(),
        ]);
        return { total: Number(count.total), data: rows };
    }
}
