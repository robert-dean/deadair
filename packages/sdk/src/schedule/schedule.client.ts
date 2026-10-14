import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString } from '../sdk-options.js';
import type {
    ScheduleNow,
    ScheduleSlotInput,
    ScheduleSlotList,
    ScheduleTimetable,
    ScheduleTimetableQuery,
    SlotPlaylistPosition,
} from './types/schedule.types.js';

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
     * @name Read timetable
     * @description The station's day as blocks, contiguous and gapless, for drawing
     */
    async readTimetable(query?: ScheduleTimetableQuery): Promise<ScheduleTimetable> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/schedule/timetable${qs}`, {
            method: 'GET',
        });
        return await parseJson<ScheduleTimetable>(result);
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

    /**
     * @name Read slot playlist position
     * @description The record a slot that resumes its playlist will open on next time, or nothing when it would start from the top
     */
    async readSlotPlaylistPosition(id: string): Promise<SlotPlaylistPosition> {
        const result = await this.fetch(`/schedule/${encodeURIComponent(id)}/playlist-position`, { method: 'GET' });
        return await parseJson<SlotPlaylistPosition>(result);
    }

    /**
     * @name Restart slot playlist
     * @description Forgets where a slot got to in its playlist, so it starts from the top the next time it opens
     */
    async restartSlotPlaylist(id: string): Promise<void> {
        await this.fetch(`/schedule/${encodeURIComponent(id)}/playlist-position`, { method: 'DELETE' });
    }
}
