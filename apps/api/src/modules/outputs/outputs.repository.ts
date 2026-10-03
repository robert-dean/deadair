import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository } from '#modules/data/data.repository.js';

/** One speaker the station is meant to be playing on (`deadair.output_casts`). */
export interface OutputCastRow {
    pluginId: string;
    deviceId: string;
    deviceName: string;
    mountPath: string;
    startedAt: DateTime;
}

/** What a new cast is stored with; `startedAt` is the database's. */
export interface NewOutputCast {
    pluginId: string;
    deviceId: string;
    deviceName: string;
    mountPath: string;
    startedBy?: string;
}

/**
 * The casts the operator asked for. The migration says why they are a table: a cast a restart
 * forgot is a speaker that went quiet with nobody having asked.
 */
@Injectable()
export class OutputsRepository extends DataRepository {
    /** Every cast, oldest first, so the console lists them in the order they were started. */
    async list(): Promise<OutputCastRow[]> {
        return this.db
            .selectFrom('deadair.outputCasts')
            .select(['pluginId', 'deviceId', 'deviceName', 'mountPath', 'startedAt'])
            .orderBy('startedAt')
            .execute();
    }

    /**
     * Records a cast, replacing any earlier one on the same speaker: casting to a speaker already
     * playing the station changes its mount rather than adding a second cast.
     */
    async save(cast: NewOutputCast): Promise<OutputCastRow> {
        const startedBy = cast.startedBy ?? null;
        return this.db
            .insertInto('deadair.outputCasts')
            .values({ pluginId: cast.pluginId, deviceId: cast.deviceId, deviceName: cast.deviceName, mountPath: cast.mountPath, startedBy })
            .onConflict(oc =>
                oc
                    .columns(['stationKey', 'pluginId', 'deviceId'])
                    .doUpdateSet({ deviceName: cast.deviceName, mountPath: cast.mountPath, startedBy, startedAt: sql<DateTime>`now()` }),
            )
            .returning(['pluginId', 'deviceId', 'deviceName', 'mountPath', 'startedAt'])
            .executeTakeFirstOrThrow();
    }

    /** Forgets a cast. Answers whether there was one. */
    async remove(pluginId: string, deviceId: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.outputCasts')
            .where('pluginId', '=', pluginId)
            .where('deviceId', '=', deviceId)
            .executeTakeFirst();
        return result.numDeletedRows > 0n;
    }
}
