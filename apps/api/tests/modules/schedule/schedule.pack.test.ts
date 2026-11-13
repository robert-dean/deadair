// A schedule as a file. What is pinned: nothing that means something only on one station travels, a reference
// this station cannot honour is reported rather than guessed at, nothing an import adds can air, and a slot it
// adds can always be turned on without being refused for who is on it.

import { describe, expect, it } from 'vitest';

import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';
import { packOfSchedule, planSchedulePack, SCHEDULE_PACK_FORMAT, type ScheduleGround } from '../../../src/modules/schedule/schedule.pack.js';
import { draftOf } from '../../../src/modules/schedule/schedule.service.js';
import type { SchedulePack, ScheduleSlot as WireSlot } from '../../../src/modules/schedule/types/schedule.types.js';

const today = { year: 2026, month: 11, day: 4, weekday: 3 };
const HOST_A = '11111111-1111-4111-8111-111111111111';
const HOST_B = '22222222-2222-4222-8222-222222222222';
const CALLER = '33333333-3333-4333-8333-333333333333';
const PLAYLIST = '44444444-4444-4444-8444-444444444444';

const personas: ScheduleGround['personas'] = [
    { id: HOST_A, key: 'wayne', kinds: ['host'] },
    { id: HOST_B, key: 'peter', kinds: ['host'] },
    { id: CALLER, key: 'barbara', kinds: ['caller'] },
];

const ground = (over: Partial<ScheduleGround> = {}): ScheduleGround => ({
    held: [],
    personas,
    playlists: [{ id: PLAYLIST, name: 'Late night' }],
    pluginIds: new Set(['deadair.lastfm']),
    today,
    draftOf,
    ...over,
});

const row = (over: Record<string, unknown> = {}) => ({
    label: 'The Boneyard',
    startsAtMinutes: 1200,
    endsAtMinutes: 1380,
    days: [5],
    mode: 'rotation',
    onEnd: 'extend',
    ...over,
});
const fileOf = (slots: SchedulePack['slots']): SchedulePack => ({ format: 'deadair.schedule', version: 1, name: 'A file', slots });
const held = (over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
    id: 'held',
    label: 'The Boneyard',
    startsAtMinutes: 1200,
    endsAtMinutes: 1380,
    days: [5],
    mode: 'rotation',
    onEnd: 'extend',
    ...over,
});

const wire = (over: Partial<WireSlot> = {}): WireSlot => ({
    id: 'a',
    label: 'The Boneyard',
    startsAtMinutes: 1200,
    endsAtMinutes: 1380,
    days: [5],
    mode: 'rotation',
    onEnd: 'extend',
    ...over,
});

describe('packOfSchedule', () => {
    it('swaps ids for what means something elsewhere, and leaves out the id and the switch', () => {
        const pack = packOfSchedule(
            [
                wire({
                    enabled: false,
                    personaId: HOST_A,
                    sourceStationPlaylistId: PLAYLIST,
                    nextDate: '2026-11-06',
                    coHosts: [{ personaId: HOST_B, days: [5] }],
                    guestHosts: [{ personaId: HOST_B, everyN: 7 }],
                    festivalId: '55555555-5555-4555-8555-555555555555',
                }),
            ],
            ground(),
        );

        expect(pack.format).toBe(SCHEDULE_PACK_FORMAT);
        const entry = pack.slots[0];
        expect(entry).toMatchObject({
            personaKey: 'wayne',
            stationPlaylistName: 'Late night',
            coHosts: [{ personaKey: 'peter', days: [5] }],
            guestHosts: [{ personaKey: 'peter', everyN: 7 }],
        });
        for (const gone of ['id', 'enabled', 'nextDate', 'personaId', 'sourceStationPlaylistId', 'festivalId'])
            expect(entry).not.toHaveProperty(gone);
    });
});

describe('planSchedulePack', () => {
    it('lands everything switched off', () => {
        const reading = planSchedulePack(fileOf([row()]), ground());
        expect(reading.adding).toHaveLength(1);
        expect(reading.adding[0]?.off).toBe(true);
    });

    it('takes switched on in the file as off here', () => {
        const reading = planSchedulePack(fileOf([row({ enabled: true })]), ground());
        expect(reading.adding[0]?.off).toBe(true);
    });

    it('skips a show it holds, by name and hours, even with another host', () => {
        const reading = planSchedulePack(fileOf([row({ label: 'the boneyard ', personaKey: 'wayne' })]), ground({ held: [held()] }));
        expect(reading.adding).toEqual([]);
        expect(reading.skipped).toHaveLength(1);
    });

    it('counts a slot held but switched off as held', () => {
        const reading = planSchedulePack(fileOf([row()]), ground({ held: [held({ off: true })] }));
        expect(reading.skipped).toHaveLength(1);
    });

    it('treats the same hours under another name as another show, and says it would clash', () => {
        const reading = planSchedulePack(fileOf([row({ label: 'Their show' })]), ground({ held: [held()] }));
        expect(reading.adding).toHaveLength(1);
        expect(reading.notices).toEqual([expect.objectContaining({ kind: 'would-clash', message: expect.stringContaining('The Boneyard') })]);
    });

    it('does not warn about a clash with a slot that is also off', () => {
        const reading = planSchedulePack(fileOf([row({ label: 'Their show' })]), ground({ held: [held({ off: true })] }));
        expect(reading.notices).toEqual([]);
    });

    it('matches a host by key', () => {
        const reading = planSchedulePack(fileOf([row({ personaKey: 'wayne' })]), ground());
        expect(reading.adding[0]?.personaId).toBe(HOST_A);
    });

    it('clears a host it cannot find, and says so', () => {
        const reading = planSchedulePack(fileOf([row({ personaKey: 'nobody' })]), ground());
        expect(reading.adding[0]?.personaId).toBeUndefined();
        expect(reading.notices[0]?.kind).toBe('missing-host');
    });

    it('leaves off a co-host or guest who is missing or is not a host', () => {
        const reading = planSchedulePack(
            fileOf([row({ coHosts: [{ personaKey: 'nobody' }, { personaKey: 'peter' }], guestHosts: [{ personaKey: 'barbara', everyN: 7 }] })]),
            ground(),
        );
        expect(reading.adding[0]?.coHosts?.map(person => person.personaId)).toEqual([HOST_B]);
        expect(reading.adding[0]?.guestHosts ?? []).toEqual([]);
        expect(reading.notices.map(notice => notice.kind)).toEqual(['missing-host', 'missing-host']);
    });

    it("leaves off a visitor who is the slot's own host or is listed twice, which the turning on would refuse", () => {
        const reading = planSchedulePack(
            fileOf([
                row({
                    personaKey: 'wayne',
                    coHosts: [{ personaKey: 'wayne' }, { personaKey: 'peter' }],
                    guestHosts: [{ personaKey: 'peter', everyN: 7 }],
                }),
            ]),
            ground(),
        );
        expect(reading.adding[0]?.coHosts?.map(person => person.personaId)).toEqual([HOST_B]);
        expect(reading.adding[0]?.guestHosts ?? []).toEqual([]);
    });

    it('matches a playlist only when one has that name', () => {
        const one = planSchedulePack(fileOf([row({ stationPlaylistName: 'Late night' })]), ground());
        expect(one.adding[0]?.source).toEqual({ stationPlaylistId: PLAYLIST });

        const two = planSchedulePack(
            fileOf([row({ stationPlaylistName: 'Late night' })]),
            ground({
                playlists: [
                    { id: PLAYLIST, name: 'Late night' },
                    { id: HOST_A, name: 'Late night' },
                ],
            }),
        );
        expect(two.adding[0]?.source).toBeUndefined();
        expect(two.notices[0]?.kind).toBe('missing-playlist');
    });

    it('says when a slot plays from a plugin that is not here', () => {
        const absent = planSchedulePack(fileOf([row({ sourcePluginId: 'deadair.spotify', sourcePlaylistId: 'x' })]), ground());
        expect(absent.adding).toHaveLength(1);
        expect(absent.notices[0]?.kind).toBe('missing-plugin');

        const chart = planSchedulePack(fileOf([row({ sourceChartId: 'deadair.lastfm:top' })]), ground());
        expect(chart.notices).toEqual([]);
    });

    it("never says the station's own chart needs a plugin", () => {
        const own = planSchedulePack(fileOf([row({ sourceChartId: 'station:top-40' })]), ground());

        expect(own.adding).toHaveLength(1);
        expect(own.notices).toEqual([]);
    });

    it('drops a one-off special that is over, and keeps a yearly one and one on a rule', () => {
        const special = { days: [], startsOn: '2020-10-31', endsOn: '2020-10-31' };
        const reading = planSchedulePack(
            fileOf([
                row({ ...special, label: 'Over' }),
                row({ ...special, label: 'Yearly', yearly: true }),
                row({ days: [], label: 'Ruled', recurrence: { ruleKind: 'fixed', month: 10, day: 31 } }),
            ]),
            ground(),
        );
        expect(reading.adding.map(draft => draft.label)).toEqual(['Yearly', 'Ruled']);
        expect(reading.dropped[0]).toMatchObject({ entry: 1, words: 'Over', reason: 'its dates have passed' });
    });

    it("reports a slot the station's own reading refuses, in its sentence", () => {
        const reading = planSchedulePack(fileOf([row({ days: [], startsOn: '2027-01-01' })]), ground());
        expect(reading.dropped[0]?.reason).toBe('a special needs both a first and a last date');
    });

    it('reports a bad entry and keeps reading', () => {
        const reading = planSchedulePack(fileOf([{ nonsense: true }, row({ startsAtMinutes: 9999 }), row()]), ground());
        expect(reading.dropped.map(dropped => dropped.entry)).toEqual([1, 2]);
        expect(reading.adding).toHaveLength(1);
    });

    it('takes a show twice in one file once', () => {
        const reading = planSchedulePack(fileOf([row(), row()]), ground());
        expect(reading.adding).toHaveLength(1);
        expect(reading.skipped).toHaveLength(1);
    });
});

describe('a round trip', () => {
    it('finds nothing new on the station it came from', () => {
        const slots = [held({ personaId: HOST_A, dates: { rule: { kind: 'fixed', month: 10, day: 31 } }, days: [] })];
        const wired: WireSlot[] = [wire({ personaId: HOST_A, days: [], recurrence: { ruleKind: 'fixed', month: 10, day: 31 } })];
        const reading = planSchedulePack(packOfSchedule(wired, ground()), ground({ held: slots }));
        expect(reading.adding).toEqual([]);
        expect(reading.skipped).toHaveLength(1);
    });

    it('lands on a station with other characters by key, with other ids', () => {
        const elsewhere = '99999999-9999-4999-8999-999999999999';
        const pack = packOfSchedule([wire({ personaId: HOST_A })], ground());
        const reading = planSchedulePack(pack, ground({ personas: [{ id: elsewhere, key: 'wayne', kinds: ['host'] }] }));
        expect(reading.adding[0]?.personaId).toBe(elsewhere);
    });
});
