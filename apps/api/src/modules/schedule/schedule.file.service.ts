import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { readClock } from '#modules/director/clock.bands.js';
import { stationZone } from '#modules/director/clock.words.js';
import type { StationDate } from '#modules/director/schedule.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import { StationPlaylistsRepository } from '#modules/playlists/station.playlists.repository.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import type { PackImportPlan } from '#modules/topics/types/topics.types.js';
import { packOfSchedule, planSchedulePack, SCHEDULE_PACK_VERSION, type ScheduleGround, type SchedulePackReading } from './schedule.pack.js';
import { ScheduleRepository } from './schedule.repository.js';
import { draftOf, ScheduleService } from './schedule.service.js';
import type { ScheduleImportResult, SchedulePack, ScheduleSlot } from './types/schedule.types.js';

/**
 * A schedule as a file. Apart from `ScheduleService` because it reaches the characters, the playlists and
 * the plugins, none of which that service has any other reason to know about.
 */
@Injectable()
export class ScheduleFileService {
    constructor(
        private readonly slots: ScheduleRepository,
        private readonly schedule: ScheduleService,
        private readonly personas: PersonaRepository,
        private readonly playlists: StationPlaylistsRepository,
        private readonly plugins: PluginRegistry,
        private readonly config: AppConfig,
    ) {}

    /** `GET /schedule/export`. Carries switched-off slots too, since they are authored all the same. */
    async exportPack(): Promise<SchedulePack> {
        const list = await this.schedule.list();
        const every: ScheduleSlot[] = [...list.slots, ...(list.switchedOff ?? [])];
        return packOfSchedule(every, await this.ground());
    }

    /** `POST /schedule/import/preview`. Writes nothing. */
    async previewImport(body: SchedulePack): Promise<PackImportPlan> {
        return planOf(body, planSchedulePack(body, await this.ground()));
    }

    /**
     * `POST /schedule/import`. Adds what is new in a file, switched off. Changes nothing the station already
     * has, and nothing it adds airs or appears on the timetable until an operator turns it on, which is the
     * edit that checks it against what else is on.
     *
     * All or nothing, by the request's own transaction: the preview is what stands between an operator and
     * a surprise, so a file that landed halfway would be the one outcome nothing had described.
     */
    async importPack(body: SchedulePack): Promise<ScheduleImportResult> {
        const reading = planSchedulePack(body, await this.ground());
        // Before anything is written, since this is also what refuses a version it cannot read.
        const plan = planOf(body, reading);
        for (const draft of reading.adding) await this.slots.create(draft);
        return { plan, list: await this.schedule.list() };
    }

    private async ground(): Promise<ScheduleGround> {
        const { year, month, day, weekday } = readClock(Date.now(), stationZone(this.config));
        const today: StationDate = { year, month, day, weekday };

        return {
            held: await this.slots.list(),
            personas: await this.personas.list(),
            playlists: await this.playlists.list(),
            pluginIds: new Set(this.plugins.list().map(record => record.id)),
            today,
            draftOf,
        };
    }
}

/** What a file would do, in the words the console shows. Refuses a version this station cannot read. */
function planOf(pack: SchedulePack, reading: SchedulePackReading): PackImportPlan {
    if (pack.version > SCHEDULE_PACK_VERSION) {
        throw httpError(400).withDetails({
            message: `this station reads version ${SCHEDULE_PACK_VERSION} of a schedule file, and this file is version ${pack.version}`,
        });
    }
    return {
        name: pack.name,
        adding: reading.adding.map(draft => draft.label || 'A slot with no name'),
        skipped: reading.skipped,
        dropped: reading.dropped,
        notices: reading.notices,
    };
}
