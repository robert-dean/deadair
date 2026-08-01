import { Injectable } from 'injectkit';
import { DataRepository } from '#src/modules/data/data.repository.js';

export type SessionEventType = 'created' | 'refreshed' | 'revoked' | 'expired' | 'step_up' | 'validation_failed';

export type SessionEventInsert = {
    sessionToken: string;
    actorId: string;
    eventType: SessionEventType;
    ip?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown> | null;
};

@Injectable()
export class SessionEventRepository extends DataRepository {
    async insert(event: SessionEventInsert): Promise<void> {
        await this.db
            .insertInto('deadair.actorSessionEvents')
            .values({
                sessionToken: event.sessionToken,
                actorId: event.actorId,
                eventType: event.eventType,
                ip: event.ip ?? null,
                userAgent: event.userAgent ?? null,
                metadata: event.metadata ? (JSON.stringify(event.metadata) as unknown as null) : null,
            })
            .execute();
    }

    async listForActor(actorId: string, limit: number, offset: number) {
        const [rows, count] = await Promise.all([
            this.db
                .selectFrom('deadair.actorSessionEvents')
                .selectAll()
                .where('actorId', '=', actorId)
                .orderBy('occurredAt', 'desc')
                .limit(limit)
                .offset(offset)
                .execute(),
            this.db
                .selectFrom('deadair.actorSessionEvents')
                .where('actorId', '=', actorId)
                .select(eb => eb.fn.countAll<number>().as('total'))
                .executeTakeFirstOrThrow(),
        ]);
        return { total: Number(count.total), data: rows };
    }
}
