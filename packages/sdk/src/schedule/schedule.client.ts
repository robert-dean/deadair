import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type { ScheduleNow, ScheduleSlot, ScheduleSlotInput, ScheduleSlotList } from './types/schedule.types.js';

export class ScheduleClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List schedule
     * @description Every slot in this station's schedule, earliest in the day first
     */
    async listSchedule(): Promise<ScheduleSlotList> {
        const result = await this.fetch(`/schedule`, { method: 'GET' });
        return await parseJson<ScheduleSlotList>(result);
    }

    /**
     * @name Create schedule slot
     * @description Adds a slot. The station does not change over until its start time comes round
     */
    async createScheduleSlot(body: ScheduleSlotInput): Promise<ScheduleSlotList> {
        const result = await this.fetch(`/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<ScheduleSlotList>(result);
    }

    /**
     * @name Read current slot
     * @description Which slot the clock says should be on, and which one the station is actually airing
     */
    async readCurrentSlot(): Promise<ScheduleNow> {
        const result = await this.fetch(`/schedule/current`, { method: 'GET' });
        return await parseJson<ScheduleNow>(result);
    }

    /**
     * @name Update schedule slot
     * @description Rewrites a slot. Takes effect at its next boundary rather than immediately
     */
    async updateScheduleSlot(id: string, body: ScheduleSlotInput): Promise<ScheduleSlotList> {
        const result = await this.fetch(`/schedule/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<ScheduleSlotList>(result);
    }

    /**
     * @name Delete schedule slot
     * @description Removes a slot. Whatever is on air stays on until the next slot begins
     */
    async deleteScheduleSlot(id: string): Promise<ScheduleSlotList> {
        const result = await this.fetch(`/schedule/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return await parseJson<ScheduleSlotList>(result);
    }
}
