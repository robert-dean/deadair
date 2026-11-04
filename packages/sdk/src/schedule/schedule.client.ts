import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString } from '../sdk-options.js';
import type { PackImportPlan } from '../topics/types/topics.types.js';
import type { OccasionImportPlan, OccasionImportResult, OccasionInput, OccasionList, OccasionOrder, OccasionPack } from './types/occasions.types.js';
import type {
    ScheduleImportResult,
    ScheduleNow,
    SchedulePack,
    ScheduleSlotApplied,
    ScheduleSlotInput,
    ScheduleSlotList,
    ScheduleTimetable,
    ScheduleTimetableQuery,
    SlotPlaylistPosition,
} from './types/schedule.types.js';

export class ScheduleClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List occasions
     * @description Every occasion on this station, in the order a date is matched against them, each saying when it next falls
     */
    async listOccasions(): Promise<OccasionList> {
        const result = await this.fetch(`/occasions`, { method: 'GET' });
        return await parseJson<OccasionList>(result);
    }

    /**
     * @name Add an occasion
     * @description Adds an occasion at the end of the list. Presenters hear of it from the next break written for its day
     */
    async addAnOccasion(body: OccasionInput): Promise<OccasionList> {
        const result = await this.fetch(`/occasions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<OccasionList>(result);
    }

    /**
     * @name Reorder occasions
     * @description Puts the list in a new order, which decides who wins when two fall on one date
     */
    async reorderOccasions(body: OccasionOrder): Promise<OccasionList> {
        const result = await this.fetch(`/occasions/order`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<OccasionList>(result);
    }

    /**
     * @name Export occasions
     * @description Every occasion on this station as one file, to hand to another station
     */
    async exportOccasions(): Promise<OccasionPack> {
        const result = await this.fetch(`/occasions/export`, { method: 'GET' });
        return await parseJson<OccasionPack>(result);
    }

    /**
     * @name Preview occasion import
     * @description Reads a file and reports what importing it would add, skip and leave out. Writes nothing
     */
    async previewOccasionImport(body: OccasionPack): Promise<OccasionImportPlan> {
        const result = await this.fetch(`/occasions/import/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<OccasionImportPlan>(result);
    }

    /**
     * @name Import occasions
     * @description Adds what is new in a file to the end of the list, switched off. Changes nothing the station already has
     */
    async importOccasions(body: OccasionPack): Promise<OccasionImportResult> {
        const result = await this.fetch(`/occasions/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<OccasionImportResult>(result);
    }

    /**
     * @name Change an occasion
     * @description Replaces an occasion, keeping its place in the list
     */
    async changeAnOccasion(id: string, body: OccasionInput): Promise<OccasionList> {
        const result = await this.fetch(`/occasions/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<OccasionList>(result);
    }

    /**
     * @name Remove an occasion
     * @description Removes an occasion
     */
    async removeAnOccasion(id: string): Promise<OccasionList> {
        const result = await this.fetch(`/occasions/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return await parseJson<OccasionList>(result);
    }

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
     * @name Export schedule
     * @description This station's schedule as one file, to hand to another station. Slots name characters by key and playlists by name
     */
    async exportSchedule(): Promise<SchedulePack> {
        const result = await this.fetch(`/schedule/export`, { method: 'GET' });
        return await parseJson<SchedulePack>(result);
    }

    /**
     * @name Preview schedule import
     * @description Reads a file and reports what importing it would add, skip and leave out, and what would clash if turned on. Writes nothing
     */
    async previewScheduleImport(body: SchedulePack): Promise<PackImportPlan> {
        const result = await this.fetch(`/schedule/import/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PackImportPlan>(result);
    }

    /**
     * @name Import schedule
     * @description Adds what is new in a file, switched off, so nothing airs until an operator turns it on. Changes nothing the station already has
     */
    async importSchedule(body: SchedulePack): Promise<ScheduleImportResult> {
        const result = await this.fetch(`/schedule/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<ScheduleImportResult>(result);
    }

    /**
     * @name Update schedule slot
     * @description Rewrites a slot. Takes effect at its next boundary rather than immediately; to change the show on air too, when it is this slot's, apply the slot afterwards with `POST /schedule/{id}/apply`
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
     * @name Apply schedule slot to air
     * @description Applies a slot, as it is saved now, to the show on air, which must be that slot's. Its name, brief, period, moods, rules and host change in place and the broadcast carries on; the records still planned are chosen again against the new programme, and the ones already planned keep playing until the new set is ready. A change to its source, mode, end or co-hosts cannot be made mid-show and waits for the slot's next occurrence
     */
    async applyScheduleSlotToAir(id: string): Promise<ScheduleSlotApplied> {
        const result = await this.fetch(`/schedule/${encodeURIComponent(id)}/apply`, { method: 'POST' });
        return await parseJson<ScheduleSlotApplied>(result);
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
