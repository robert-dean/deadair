import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { PlaylistPositionRepository } from '#modules/schedule/playlist.position.repository.js';
import { ScheduleRepository } from '#modules/schedule/schedule.repository.js';
import type { SlotPlaylistPosition } from '#modules/schedule/types/schedule.types.js';
import { DirectorConsoleService } from './director.console.service.js';
import type { ScheduleSlot } from './schedule.js';

/** A slot id is a uuid, and anything else would reach Postgres as a type error rather than a 404. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where a slot that resumes its playlist got to, for the schedule page.
 *
 * Here rather than on `ScheduleService`, because answering it means reading the playlist the way an
 * opening reads it, and that is the director console's: `DirectorConsoleService` already depends on
 * the schedule, so the schedule's own service cannot depend back on it. The place itself is a row
 * beside the slot (migration 0102), written on the aired edge by the director and only ever read or
 * forgotten from here.
 */
@Injectable()
export class SlotPlaylistService {
    constructor(
        private readonly slots: ScheduleRepository,
        private readonly positions: PlaylistPositionRepository,
        private readonly console: DirectorConsoleService,
        private readonly logger: Logger,
    ) {}

    /** The record the slot opens on next time, or an empty answer when it would start from the top. */
    async position(id: string): Promise<SlotPlaylistPosition> {
        const next = await this.console.nextOnSlotPlaylist(await this.slotOr404(id));
        return next === undefined ? {} : { title: next.title, artist: next.artist };
    }

    /** Start the slot's playlist from the top the next time it opens. */
    async restart(id: string): Promise<void> {
        const slot = await this.slotOr404(id);
        await this.positions.clear(slot.id);
        this.logger.info('schedule: an operator started a slot playlist from the top', { slot: slot.id, label: slot.label });
    }

    private async slotOr404(id: string): Promise<ScheduleSlot> {
        const slot = UUID.test(id) ? (await this.slots.list()).find(candidate => candidate.id === id) : undefined;
        if (slot === undefined) throw httpError(404).withDetails({ message: `schedule slot "${id}" does not exist` });
        return slot;
    }
}
