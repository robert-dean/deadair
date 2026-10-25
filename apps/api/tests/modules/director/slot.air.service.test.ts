// Applying a saved slot to the show on air. What matters is that the show changes in place rather
// than starting again (no `putOnAir`, so nothing goes quiet), that only what differs is posted, that
// the records already planned are replaced only when the change reaches which ones are chosen, and
// that a change only a changeover can make is reported rather than forced.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { JobBroker } from '@maroonedsoftware/jobbroker';
import type { Logger } from '@maroonedsoftware/logger';

import { SlotAirService, changeFrom, programmeOf } from '../../../src/modules/director/slot.air.service.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';
import type { StationLineupSnapshot } from '../../../src/modules/director/station.lineup.js';
import type { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import type { ScheduleRepository } from '../../../src/modules/schedule/schedule.repository.js';
import type { ScheduleService } from '../../../src/modules/schedule/schedule.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
const config = { has: () => false, get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;
const SLOT = '00000000-0000-4000-8000-0000000000aa';

const church: ScheduleSlot = {
    id: SLOT,
    label: 'Church',
    startsAtMinutes: 0,
    endsAtMinutes: 0,
    days: [0],
    personaId: 'satan',
    brief: 'Sunday service, the Devil’s way.',
    moods: ['fear', 'anger'],
    requestShow: true,
    requestFollowOn: 4,
    mode: 'rotation',
    onEnd: 'extend',
};

/** The broadcast a changeover onto `church` builds, as the director holds it. */
const onAir = (overrides: Partial<StationLineupSnapshot> = {}): StationLineupSnapshot => ({
    broadcastId: 'broadcast-1',
    name: 'Church',
    brief: 'Sunday service, the Devil’s way.',
    moods: ['fear', 'anger'],
    personaId: 'satan',
    slotId: SLOT,
    placedBy: 'schedule',
    rules: { requestShow: true, requestFollowOn: 4 },
    mode: 'rotation',
    onEnd: 'extend',
    source: 'director',
    items: [],
    ...overrides,
});

function build(options: { slot?: ScheduleSlot; order?: StationLineupSnapshot; coHosts?: string[] } = {}) {
    const slot = options.slot ?? church;
    const order = 'order' in options ? options.order : onAir();
    const slots = { list: vi.fn(async () => [slot]) } as unknown as ScheduleRepository;
    const schedule = {
        nightOf: vi.fn(() => ({
            date: '2026-10-25',
            host: { ...(slot.personaId === undefined ? {} : { personaId: slot.personaId }) },
            coHosts: options.coHosts ?? [],
        })),
    } as unknown as ScheduleService;
    const director = { order: vi.fn(() => order), post: vi.fn(async () => undefined) } as unknown as DirectorService;
    const jobs = { send: vi.fn(async () => 'job-1') } as unknown as JobBroker;
    const context = { actor: { kind: 'user', actorId: 'robert' } } as unknown as AuthorizationContext;
    const activity = { record: vi.fn(async () => undefined) } as unknown as ActivityRecorder;
    const service = new SlotAirService(slots, schedule, director, jobs, config, context, activity, logger);
    return { service, director, jobs, activity };
}

const statusOf = async (promise: Promise<unknown>): Promise<number | undefined> =>
    promise.then(
        () => undefined,
        (error: { statusCode?: number }) => error.statusCode,
    );

describe('SlotAirService.apply', () => {
    it('changes the brief in place and replans, posting the brief before asking for the replan', async () => {
        // The replan reads the brief off the row, so the other order would choose the fresh set
        // against the brief being replaced.
        const { service, director, jobs } = build({ slot: { ...church, brief: 'Now and then one sinful pop hit.' } });

        const answer = await service.apply(SLOT);

        expect(answer).toEqual({ applied: ['brief'], waiting: [], replanning: true });
        expect(director.post).toHaveBeenCalledTimes(1);
        expect(director.post).toHaveBeenCalledWith({ kind: 'reprogramme', change: { brief: 'Now and then one sinful pop hit.' } });
        expect(jobs.send).toHaveBeenCalledWith('director.replan_lineup', { broadcastId: 'broadcast-1' });
        expect(vi.mocked(director.post)).toHaveBeenCalledBefore(vi.mocked(jobs.send));
    });

    it('never puts the station on air again, which is what took it off air for minutes', async () => {
        const { service, director } = build({ slot: { ...church, brief: 'Something else.' } });

        await service.apply(SLOT);

        expect(director.post).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'putOnAir' }));
    });

    it('does nothing at all when the show on air already matches the slot', async () => {
        const { service, director, jobs, activity } = build();

        expect(await service.apply(SLOT)).toEqual({ applied: [], waiting: [], replanning: false });
        expect(director.post).not.toHaveBeenCalled();
        expect(jobs.send).not.toHaveBeenCalled();
        expect(activity.record).not.toHaveBeenCalled();
    });

    it('renames the show and changes a rule about breaks without replanning, since neither changes the records', async () => {
        const { service, director, jobs } = build({ slot: { ...church, label: 'Black Mass', breaks: false } });

        const answer = await service.apply(SLOT);

        expect(answer).toEqual({ applied: ['name', 'rules'], waiting: [], replanning: false });
        expect(director.post).toHaveBeenCalledWith({
            kind: 'reprogramme',
            change: { name: 'Black Mass', rules: { breaks: false, requestShow: true, requestFollowOn: 4 } },
        });
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('replans when a rule changes which records may be chosen', async () => {
        const { service, jobs } = build({ slot: { ...church, maxPerArtist: 1 } });

        expect((await service.apply(SLOT)).replanning).toBe(true);
        expect(jobs.send).toHaveBeenCalled();
    });

    it('clears the period and the moods when the slot no longer has them', async () => {
        const { service, director } = build({ slot: { ...church, moods: undefined }, order: onAir({ eraFrom: 1970, eraTo: 1989 }) });

        await service.apply(SLOT);

        expect(director.post).toHaveBeenCalledWith({ kind: 'reprogramme', change: { era: {}, moods: [] } });
    });

    it('recasts the show when the slot names a different host, without replanning', async () => {
        const { service, director, jobs } = build({ slot: { ...church, personaId: 'lucifer' } });

        const answer = await service.apply(SLOT);

        expect(answer).toEqual({ applied: ['host'], waiting: [], replanning: false });
        expect(director.post).toHaveBeenCalledWith({ kind: 'recast', bind: { personaId: 'lucifer' } });
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('reports a new source, mode or end as waiting for the next occurrence, and changes none of them', async () => {
        // Each of those is a different programme, which only a changeover builds.
        const slot: ScheduleSlot = { ...church, source: { pluginId: 'deadair.spotify', playlistId: 'pl_1' }, mode: 'setlist', onEnd: 'stop' };
        const { service, director } = build({ slot });

        const answer = await service.apply(SLOT);

        expect(answer.waiting).toEqual(['source', 'mode', 'onEnd']);
        expect(director.post).not.toHaveBeenCalled();
    });

    it('leaves a source alone that the show already reads', async () => {
        const slot: ScheduleSlot = { ...church, source: { pluginId: 'deadair.spotify', playlistId: 'pl_1' } };
        const { service } = build({ slot, order: onAir({ source: 'import', sourcePluginId: 'deadair.spotify', sourcePlaylistId: 'pl_1' }) });

        expect((await service.apply(SLOT)).waiting).toEqual([]);
    });

    it("reports tonight's co-hosts as waiting when they differ, since the night settled them", async () => {
        const { service } = build({ coHosts: ['beelzebub'] });

        expect((await service.apply(SLOT)).waiting).toEqual(['coHosts']);
    });

    it('does not replan a setlist, which nothing generates into', async () => {
        const slot: ScheduleSlot = { ...church, mode: 'setlist', brief: 'Something else.' };
        const { service, jobs } = build({ slot, order: onAir({ mode: 'setlist' }) });

        const answer = await service.apply(SLOT);

        expect(answer).toEqual({ applied: ['brief'], waiting: [], replanning: false });
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('refuses with a 409 when the slot is not the one on air, and changes nothing', async () => {
        const elsewhere = build({ order: onAir({ slotId: '00000000-0000-4000-8000-0000000000bb' }) });
        const offAir = build({ order: undefined });

        expect(await statusOf(elsewhere.service.apply(SLOT))).toBe(409);
        expect(await statusOf(offAir.service.apply(SLOT))).toBe(409);
        expect(elsewhere.director.post).not.toHaveBeenCalled();
        expect(offAir.director.post).not.toHaveBeenCalled();
    });

    it('answers 404 for a slot this station does not have, and for an id that is not one', async () => {
        const { service } = build();

        expect(await statusOf(service.apply('00000000-0000-4000-8000-0000000000ff'))).toBe(404);
        expect(await statusOf(service.apply('church'))).toBe(404);
    });

    it('writes what it applied to the activity feed, as the operator who asked', async () => {
        const { service, activity } = build({ slot: { ...church, brief: 'Something else.' } });

        await service.apply(SLOT);

        expect(activity.record).toHaveBeenCalledWith(
            expect.objectContaining({
                module: 'director',
                kind: 'air.reprogrammed',
                actorId: 'robert',
                data: { slotId: SLOT, applied: ['brief'], waiting: [], replanning: true },
            }),
        );
    });
});

describe('programmeOf and changeFrom', () => {
    it('reads a slot with nothing set as clearing everything, so a dropped field is told from an unmentioned one', () => {
        expect(programmeOf({ name: 'Late' })).toEqual({ name: 'Late', brief: '', era: {}, moods: [], avoidMoods: [], rules: {} });
    });

    it('compares rules regardless of the order their keys were written in', () => {
        const programme = programmeOf({
            name: 'Church',
            brief: 'Sunday service, the Devil’s way.',
            moods: ['fear', 'anger'],
            requestFollowOn: 4,
            requestShow: true,
        });

        expect(changeFrom(programme, onAir())).toEqual({});
    });

    it('treats a reordered mood list as a change, because the moods are stages in order', () => {
        const programme = programmeOf({
            name: 'Church',
            brief: 'Sunday service, the Devil’s way.',
            moods: ['anger', 'fear'],
            requestShow: true,
            requestFollowOn: 4,
        });

        expect(changeFrom(programme, onAir())).toEqual({ moods: ['anger', 'fear'] });
    });
});
