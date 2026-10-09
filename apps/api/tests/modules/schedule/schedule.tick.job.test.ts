// The tick's whole job is deciding whether to do nothing, and there are four ways it should: the
// station is stood down, there is no schedule, the slot in force is already on, or the slot cannot
// be aired. Only the last of those is visible from outside, so the rest are pinned here rather than
// left to be noticed the first time a schedule changes a station over at three in the morning for no
// reason.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { httpError } from '@maroonedsoftware/errors';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import type { JobContext } from '@maroonedsoftware/jobbroker';

import { ScheduleTickJob } from '../../../src/modules/schedule/schedule.tick.job.js';
import type { ScheduleService, SustainingSource } from '../../../src/modules/schedule/schedule.service.js';
import { ScheduleNotices } from '../../../src/modules/schedule/schedule.notices.js';
import type { DirectorConsoleService } from '../../../src/modules/director/director.console.service.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
import type { NightHost } from '../../../src/modules/director/slot.visits.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const slot = (id: string, over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
    id,
    label: id,
    startsAtMinutes: 540,
    endsAtMinutes: 720,
    days: [],
    source: { pluginId: 'deadair.spotify', playlistId: 'pl_1' },
    mode: 'rotation',
    onEnd: 'extend',
    ...over,
});

interface Options {
    /** Whether the director says the station is driving. */
    active?: boolean;
    /** Whether a stand-down was the running order running out, rather than somebody stopping it. */
    ranOut?: boolean;
    /** What the clock says should be on. */
    inForce?: ScheduleSlot;
    /** What the running order says it already is. */
    airing?: string;
    /** What going on air does, for the decline case. */
    putOnAir?: () => Promise<unknown>;
    /** What the station plays between blocks. Absent is a station that has named nothing. */
    sustaining?: SustainingSource;
    /** A hold on the running order, as epoch millis. `Infinity` never lapses; absent is no hold. */
    holdUntil?: number;
    /** The station's overrun limit in minutes. Absent is the switch off. */
    overrunCap?: number;
    overrunFadeMs?: number;
    /** Whole minutes since the slot in force began. */
    minutesInto?: number;
    /** A record from the programme that just ended, still on air. */
    overrunning?: { itemId: string; startedAt: number; title: string };
    /** Whether the stream takes a cut. */
    cutTakes?: boolean;
    /** Which night the slot in force is on, and who presents it. Absent is today with the slot's own host. */
    night?: { date: string; host: NightHost; coHosts?: string[] };
    /** The night the order on air was placed for. Absent is an order with no stamp. */
    placedOn?: string;
    /** Who presented the night the order was placed for. */
    hostThen?: NightHost & { coHosts?: string[] };
}

function build(options: Options = {}) {
    const schedule = {
        inForce: vi.fn(async () => options.inForce),
        sustaining: vi.fn(() => options.sustaining),
        overrunCap: vi.fn(() => options.overrunCap),
        overrunFadeMs: vi.fn(() => options.overrunFadeMs ?? 0),
        minutesInto: vi.fn(() => options.minutesInto ?? 0),
        nightOf: vi.fn((slot: ScheduleSlot) => ({
            coHosts: [],
            ...(options.night ?? {
                date: '2026-10-09',
                host: { ...(slot.personaId === undefined ? {} : { personaId: slot.personaId }), guest: false },
            }),
        })),
        hostOn: vi.fn((slot: ScheduleSlot) => ({
            coHosts: [],
            ...(options.hostThen ?? { ...(slot.personaId === undefined ? {} : { personaId: slot.personaId }), guest: false }),
        })),
    } as unknown as ScheduleService;

    const director = {
        status: vi.fn(() => ({ active: options.active ?? true, airMode: 'audience' as const, remaining: 0 })),
        order: vi.fn(() =>
            options.airing === undefined
                ? { items: [] }
                : { items: [], slotId: options.airing, ...(options.placedOn === undefined ? {} : { slotOccurrence: options.placedOn }) },
        ),
        holdUntil: vi.fn(() => options.holdUntil),
        ranOut: vi.fn(() => options.active === false && (options.ranOut ?? false)),
    } as unknown as DirectorService;

    const console = {
        putOnAir: vi.fn(options.putOnAir ?? (async () => ({}))),
        overrunning: vi.fn(() => options.overrunning),
        cutOverrun: vi.fn(async () => options.cutTakes ?? true),
    } as unknown as DirectorConsoleService;

    const activity = { record: vi.fn(async (_event?: Record<string, unknown>) => undefined) };

    // `run` installs the job actor through the scope, which a unit test has none of, so the body is
    // driven directly. What `run` adds is attribution and never an authorization outcome.
    // The real one, not a double: it is fifteen lines of "have I said this already" and the whole
    // point of the tests below is what reaches the feed.
    const notices = new ScheduleNotices();
    const job = new ScheduleTickJob(
        schedule,
        console,
        director,
        activity as unknown as ActivityRecorder,
        notices,
        {} as JobContext,
        {} as Container,
        logger,
    );

    return {
        tick: () => (job as unknown as { execute(): Promise<void> }).execute(),
        console,
        schedule,
        activity,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('ScheduleTickJob', () => {
    it('leaves a stood-down station alone', async () => {
        // A schedule changes the station OVER; it does not put it back on. Stopping is an operator
        // saying out of service, and a timer that overruled that would make Stop mean nothing.
        const { tick, console, schedule } = build({ active: false, inForce: slot('morning') });

        await tick();

        expect(console.putOnAir).not.toHaveBeenCalled();
        // It does not even ask, because the answer could not change what it does.
        expect(schedule.inForce).not.toHaveBeenCalled();
    });

    // Issue #276. A block whose "When it runs out" is Stop stands the station down when its records are
    // spent, and that stand-down looked exactly like an operator's: every block after it stayed off.
    describe('a station whose programme ran out', () => {
        it('starts the next block, because nobody stopped it', async () => {
            const next = slot('evening', { label: 'Evening' });
            const { tick, console } = build({ active: false, ranOut: true, inForce: next, airing: 'morning' });

            await tick();

            expect(console.putOnAir).toHaveBeenCalledWith(expect.objectContaining({ name: 'Evening' }), next, false, expect.anything());
        });

        it('stays quiet for the rest of the block that ran out, since that is what Stop asked for', async () => {
            const { tick, console } = build({ active: false, ranOut: true, inForce: slot('morning'), airing: 'morning', overrunCap: 5 });

            await tick();

            expect(console.putOnAir).not.toHaveBeenCalled();
            // Nothing is on air to have overrun.
            expect(console.overrunning).not.toHaveBeenCalled();
        });

        it('hands a gap after it to the sustaining source', async () => {
            const { tick, console } = build({
                active: false,
                ranOut: true,
                inForce: undefined,
                airing: 'morning',
                sustaining: { brief: 'jazz', callins: false },
            });

            await tick();

            expect(console.putOnAir).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sustaining' }), undefined, true);
        });

        it('says whether the gap takes calls, rather than leaving it to a station default', async () => {
            const { tick, console } = build({
                active: false,
                ranOut: true,
                inForce: undefined,
                airing: 'morning',
                sustaining: { brief: 'jazz', callins: true },
            });

            await tick();

            expect(console.putOnAir).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sustaining', callins: true }), undefined, true);
        });

        it('says no calls just as plainly', async () => {
            const { tick, console } = build({
                active: false,
                ranOut: true,
                inForce: undefined,
                airing: 'morning',
                sustaining: { brief: 'jazz', callins: false },
            });

            await tick();

            expect(console.putOnAir).toHaveBeenCalledWith(expect.objectContaining({ callins: false }), undefined, true);
        });

        it('still respects a hold', async () => {
            const { tick, console } = build({ active: false, ranOut: true, inForce: slot('evening'), airing: 'morning', holdUntil: Infinity });

            await tick();

            expect(console.putOnAir).not.toHaveBeenCalled();
        });
    });

    it('leaves a held station alone, because a takeover expiring silently is what the hold is for', async () => {
        // A manual `putOnAir` is stamped with whichever slot is in force, so it survives to the end
        // of that block and is then replaced — correct, and with no warning. A hold is the operator
        // saying how long they actually meant.
        const { tick, console, schedule } = build({ inForce: slot('morning'), airing: 'breakfast', holdUntil: Date.now() + 60_000 });

        await tick();

        expect(console.putOnAir).not.toHaveBeenCalled();
        // It does not even ask, on the stood-down guard's argument: the answer cannot change what
        // this does, so asking is a query a minute for nothing.
        expect(schedule.inForce).not.toHaveBeenCalled();
    });

    it('changes over once a hold has lapsed, so a timed hold ends by itself', async () => {
        const { tick, console } = build({ inForce: slot('morning'), airing: 'breakfast', holdUntil: Date.now() - 1 });

        await tick();

        expect(console.putOnAir).toHaveBeenCalled();
    });

    it('never lets go of a hold that was set to last until it is released', async () => {
        const { tick, console } = build({ inForce: slot('morning'), airing: 'breakfast', holdUntil: Infinity });

        await tick();

        expect(console.putOnAir).not.toHaveBeenCalled();
    });

    it('says a hold is why once, rather than every minute it is in force', async () => {
        // The mismatch causing this is still there next minute, exactly as with a declined slot, so
        // without the mark it would write a row sixty times an hour for as long as the hold lasts.
        const { tick, activity } = build({ inForce: slot('morning'), airing: 'breakfast', holdUntil: Infinity });

        await tick();
        await tick();

        const held = activity.record.mock.calls.filter(call => (call[0] as { kind?: string } | undefined)?.kind === 'schedule.held');
        expect(held).toHaveLength(1);
    });

    it('hands a station in a GAP to its sustaining source', async () => {
        // The whole of what ending a block means. Without this the station would carry on with what
        // the last block left it, which is indistinguishable from that block never having ended.
        const { tick, console } = build({ inForce: undefined, airing: 'breakfast', sustaining: { pluginId: 'p', playlistId: 'l', callins: false } });

        await tick();

        // The third argument is the clock saying it did this. A gap has no slot to hand back, so
        // without it a sustaining broadcast and one an operator started during the same gap are
        // indistinguishable rows and the desk names the wrong driver.
        expect(console.putOnAir).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Sustaining', pluginId: 'p', playlistId: 'l' }),
            undefined,
            true,
        );
    });

    it('carries a slot’s period onto the running order beside its brief', async () => {
        // For the brief's own reason: `onEnd: 'extend'` keeps asking for more, so a period held
        // anywhere but the order would last one batch and the show would drift out of its decade
        // within the hour with nothing saying so.
        const { tick, console } = build({ inForce: slot('sixties', { brief: 'the good stuff', era: { from: 1960, to: 1969 } }) });

        await tick();

        expect(console.putOnAir).toHaveBeenCalledWith(
            expect.objectContaining({ brief: 'the good stuff', eraFrom: 1960, eraTo: 1969 }),
            expect.anything(),
            false,
            expect.anything(),
        );
    });

    it('carries a slot’s mood onto the running order beside its period', async () => {
        const { tick, console } = build({ inForce: slot('late', { mood: 'comfort' }) });

        await tick();

        expect(console.putOnAir).toHaveBeenCalledWith(expect.objectContaining({ mood: 'comfort' }), expect.anything(), false, expect.anything());
    });

    it('says nothing about a period a slot does not name', async () => {
        const { tick, console } = build({ inForce: slot('morning') });

        await tick();

        expect(vi.mocked(console.putOnAir).mock.calls[0]?.[0]).not.toHaveProperty('eraFrom');
        expect(vi.mocked(console.putOnAir).mock.calls[0]?.[0]).not.toHaveProperty('eraTo');
    });

    it('carries a slot’s wish to mix similar records in, including a slot declining the station default', async () => {
        const mixing = build({ inForce: slot('mixing', { mixInSimilar: true }) });
        await mixing.tick();
        expect(mixing.console.putOnAir).toHaveBeenCalledWith(
            expect.objectContaining({ mixInSimilar: true }),
            expect.anything(),
            false,
            expect.anything(),
        );

        const declining = build({ inForce: slot('declining', { mixInSimilar: false }) });
        await declining.tick();
        expect(declining.console.putOnAir).toHaveBeenCalledWith(
            expect.objectContaining({ mixInSimilar: false }),
            expect.anything(),
            false,
            expect.anything(),
        );
    });

    it('carries a slot keeping its chart positions quiet, and says nothing when it does not', async () => {
        const quiet = build({ inForce: slot('quiet', { chartPositions: false }) });
        await quiet.tick();
        expect(quiet.console.putOnAir).toHaveBeenCalledWith(
            expect.objectContaining({ chartPositions: false }),
            expect.anything(),
            false,
            expect.anything(),
        );

        const { tick, console } = build({ inForce: slot('morning') });
        await tick();
        expect(vi.mocked(console.putOnAir).mock.calls[0]?.[0]).not.toHaveProperty('chartPositions');
    });

    it('says nothing about mixing when a slot does not, so the station setting stands', async () => {
        const { tick, console } = build({ inForce: slot('morning') });

        await tick();

        expect(vi.mocked(console.putOnAir).mock.calls[0]?.[0]).not.toHaveProperty('mixInSimilar');
    });

    it('carries the sustaining period through a gap too', async () => {
        const { tick, console } = build({ inForce: undefined, airing: 'breakfast', sustaining: { era: { from: 1990 }, callins: false } });

        await tick();

        expect(console.putOnAir).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sustaining', eraFrom: 1990 }), undefined, true);
        expect(vi.mocked(console.putOnAir).mock.calls[0]?.[0]).not.toHaveProperty('eraTo');
    });

    it('carries on through a gap when no sustaining source is named, and says so once', async () => {
        // Never silence: a gap plays something or the station keeps what it has, so the schedule can
        // never take a running station off air. And the notice is on an EDGE — the mismatch causing
        // it is still there next minute, so without the mark this would write a row sixty times an
        // hour.
        const { tick, console, activity } = build({ inForce: undefined, airing: 'breakfast' });

        await tick();
        await tick();

        expect(console.putOnAir).not.toHaveBeenCalled();
        const gaps = activity.record.mock.calls.filter(call => (call[0] as { kind?: string } | undefined)?.kind === 'schedule.gap');
        expect(gaps).toHaveLength(1);
    });

    it('does nothing in a gap the station is already sustaining through', async () => {
        // The running order no longer belonging to any slot IS the mark that it happened, which is
        // the same comparison the block case makes and needs no second piece of state.
        const { tick, console } = build({ inForce: undefined, airing: undefined, sustaining: { pluginId: 'p', playlistId: 'l', callins: false } });

        await tick();

        expect(console.putOnAir).not.toHaveBeenCalled();
    });

    it('does nothing when the slot in force is already on', async () => {
        const { tick, console } = build({ inForce: slot('morning'), airing: 'morning' });

        await tick();

        expect(console.putOnAir).not.toHaveBeenCalled();
    });

    // Once the block is on, the only thing left for the tick is the record the last programme left
    // playing. It is allowed to finish; what an operator can switch on is a limit on how long.
    describe('a record left over from the last programme', () => {
        const long = { itemId: 'item-old', startedAt: Date.now() - 20 * 60_000, title: 'Echoes' };

        it('lets it finish when the station has set no limit', async () => {
            const { tick, console } = build({ inForce: slot('morning'), airing: 'morning', overrunning: long, minutesInto: 30 });

            await tick();

            expect(console.cutOverrun).not.toHaveBeenCalled();
        });

        it('lets it run while it is inside the limit', async () => {
            const { tick, console } = build({ inForce: slot('morning'), airing: 'morning', overrunCap: 5, overrunning: long, minutesInto: 4 });

            await tick();

            expect(console.cutOverrun).not.toHaveBeenCalled();
        });

        it('cuts it once it has kept the block waiting as long as allowed, and says so', async () => {
            const { tick, console, activity } = build({
                inForce: slot('morning'),
                airing: 'morning',
                overrunCap: 5,
                overrunning: long,
                minutesInto: 5,
            });

            await tick();

            expect(console.cutOverrun).toHaveBeenCalledWith('item-old', 0);
            expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule.overrun' }));
        });

        it('fades it out rather than cutting it when the station asks for a fade', async () => {
            const { tick, console, activity } = build({
                inForce: slot('morning'),
                airing: 'morning',
                overrunCap: 5,
                overrunFadeMs: 4000,
                overrunning: long,
                minutesInto: 5,
            });

            await tick();

            expect(console.cutOverrun).toHaveBeenCalledWith('item-old', 4000);
            expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('faded it out') }));
        });

        // `overrunning` answers nothing for a programme an operator put on, and nothing once the
        // record on air belongs to this block, so both reach here as the same absence.
        it('has nothing to cut when nothing from the last programme is still playing', async () => {
            const { tick, console } = build({ inForce: slot('morning'), airing: 'morning', overrunCap: 0, minutesInto: 30 });

            await tick();

            expect(console.cutOverrun).not.toHaveBeenCalled();
        });

        it('says once, not every minute, when the stream will not take the cut', async () => {
            const { tick, activity } = build({
                inForce: slot('morning'),
                airing: 'morning',
                overrunCap: 5,
                overrunning: long,
                minutesInto: 6,
                cutTakes: false,
            });

            await tick();
            await tick();

            const refused = activity.record.mock.calls.filter(call => (call[0] as { kind?: string } | undefined)?.kind === 'schedule.overrun');
            expect(refused).toHaveLength(1);
            expect(refused[0]?.[0]).toEqual(expect.objectContaining({ severity: 'warn' }));
        });

        it('never asks during a changeover, which is the director letting the record finish', async () => {
            const { tick, console } = build({ inForce: slot('morning'), airing: 'overnight', overrunCap: 0, overrunning: long, minutesInto: 30 });

            await tick();

            expect(console.putOnAir).toHaveBeenCalled();
            expect(console.cutOverrun).not.toHaveBeenCalled();
        });
    });

    it('changes over when the running order belongs to a different slot', async () => {
        const { tick, console, activity } = build({
            inForce: slot('morning', { label: 'Breakfast', brief: 'warm and bright', personaId: 'p-1' }),
            airing: 'overnight',
        });

        await tick();

        expect(console.putOnAir).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Breakfast',
                pluginId: 'deadair.spotify',
                playlistId: 'pl_1',
                brief: 'warm and bright',
                personaId: 'p-1',
                mode: 'rotation',
                onEnd: 'extend',
            }),
            expect.objectContaining({ id: 'morning' }),
            false,
            expect.anything(),
        );
        expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule.changeover' }));
    });

    it('hands the slot it resolved to the changeover rather than letting it resolve again', async () => {
        // The window this closes: resolving a second time inside `putOnAir` can land on the far side
        // of a boundary, so the order is built from one slot's source and stamped with the next
        // one's id — and nothing afterwards can tell that from a station already airing the right
        // thing, so it never corrects itself.
        const inForce = slot('morning');
        const { tick, console } = build({ inForce, airing: 'overnight' });

        await tick();

        expect(vi.mocked(console.putOnAir).mock.calls[0]?.[1]).toBe(inForce);
    });

    describe('a special', () => {
        // No new state: a special is a slot with its own id, so the tick's one comparison (the slot
        // in force against the slot the order is stamped with) changes over into it in the middle of
        // the weekly show and back out of it when it ends.
        const halloween = slot('halloween', { label: 'Halloween', dates: { from: '2026-10-31', to: '2026-10-31', yearly: true } });
        const boneyard = slot('boneyard', { label: 'The Boneyard' });

        it('takes over from the weekly show it interrupts', async () => {
            const { tick, console } = build({ inForce: halloween, airing: 'boneyard' });

            await tick();

            expect(console.putOnAir).toHaveBeenCalledWith(expect.objectContaining({ name: 'Halloween' }), halloween, false, expect.anything());
        });

        it('hands back to the weekly show when it ends, part-way through that show', async () => {
            const { tick, console } = build({ inForce: boneyard, airing: 'halloween' });

            await tick();

            expect(console.putOnAir).toHaveBeenCalledWith(expect.objectContaining({ name: 'The Boneyard' }), boneyard, false, expect.anything());
        });
    });

    describe('a guest host', () => {
        const boneyard = slot('boneyard', { label: 'The Boneyard', personaId: 'ozzy' });
        const rockzoNight = { date: '2026-10-09', host: { personaId: 'rockzo', regularPersonaId: 'ozzy', guest: true } };

        it('presents the night and is stamped as sitting in, with the date the night began', async () => {
            const { tick, console } = build({ inForce: boneyard, airing: 'something-else', night: rockzoNight });

            await tick();

            expect(console.putOnAir).toHaveBeenCalledWith(expect.objectContaining({ personaId: 'rockzo' }), boneyard, false, {
                date: '2026-10-09',
                guest: true,
                regularPersonaId: 'ozzy',
            });
        });

        it('takes over at the start of a new night of a slot that never went off, when the host changes', async () => {
            const { tick, console } = build({
                inForce: boneyard,
                airing: 'boneyard',
                placedOn: '2026-10-08',
                night: rockzoNight,
                hostThen: { personaId: 'ozzy', guest: false },
            });

            await tick();

            expect(console.putOnAir).toHaveBeenCalledWith(expect.objectContaining({ personaId: 'rockzo' }), boneyard, false, expect.anything());
        });

        it('leaves a new night alone when it has the same host, so a slot running through midnight is not restarted', async () => {
            const { tick, console } = build({
                inForce: boneyard,
                airing: 'boneyard',
                placedOn: '2026-10-08',
                night: { date: '2026-10-09', host: { personaId: 'ozzy', guest: false } },
                hostThen: { personaId: 'ozzy', guest: false },
            });

            await tick();

            expect(console.putOnAir).not.toHaveBeenCalled();
        });

        it('never re-places an order a person put on, which carries no night', async () => {
            const { tick, console } = build({ inForce: boneyard, airing: 'boneyard', night: rockzoNight });

            await tick();

            expect(console.putOnAir).not.toHaveBeenCalled();
        });

        it('puts tonight’s co-hosts on, and changes over when a visiting co-host’s night begins', async () => {
            const { tick, console } = build({
                inForce: boneyard,
                airing: 'boneyard',
                placedOn: '2026-10-08',
                night: { date: '2026-10-09', host: { personaId: 'ozzy', guest: false }, coHosts: ['lemmy'] },
                hostThen: { personaId: 'ozzy', guest: false, coHosts: [] },
            });

            await tick();

            expect(console.putOnAir).toHaveBeenCalledWith(expect.anything(), boneyard, false, expect.objectContaining({ coHostIds: ['lemmy'] }));
        });

        it('keeps the same night going however often the tick asks', async () => {
            const { tick, console } = build({ inForce: boneyard, airing: 'boneyard', placedOn: '2026-10-09', night: rockzoNight });

            await tick();

            expect(console.putOnAir).not.toHaveBeenCalled();
        });
    });

    it('changes over a station that has never been stamped with a slot', async () => {
        const { tick, console } = build({ inForce: slot('morning'), airing: undefined });

        await tick();

        expect(console.putOnAir).toHaveBeenCalled();
    });

    it('keeps what is airing when the slot cannot be aired, and says so', async () => {
        // An empty playlist arrives as the 422 the console would have shown an operator. Taking the
        // station off air over it would be the worse failure, so the changeover is declined and what
        // is on stays on.
        const { tick, activity } = build({
            inForce: slot('morning', { label: 'Breakfast' }),
            airing: 'overnight',
            putOnAir: async () => {
                throw httpError(422).withDetails({ message: 'that playlist has no tracks to play' });
            },
        });

        await tick();

        expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule.declined' }));
        expect(activity.record).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule.changeover' }));
    });

    it('starts the block from its brief when its playlist cannot be read, rather than keeping the last one on', async () => {
        // The failure that kept one show on air through the three after it: a long provider playlist
        // timed out at every boundary, and every changeover was declined for the block's whole length.
        let calls = 0;
        const { tick, console, activity } = build({
            inForce: slot('rock', {
                label: 'Rock Hours',
                brief: 'guitars, loud',
                personaId: 'p1',
                mode: 'setlist',
                onEnd: 'stop',
                mixInSimilar: true,
            }),
            airing: 'classical',
            putOnAir: async () => {
                if (calls++ === 0) throw httpError(504).withDetails({ message: 'the plugin took too long' });
                return {};
            },
        });

        await tick();

        const retry = (console.putOnAir as unknown as { mock: { calls: Record<string, unknown>[][] } }).mock.calls[1]!;
        expect(retry[0]).toMatchObject({ name: 'Rock Hours', brief: 'guitars, loud', personaId: 'p1', mode: 'rotation', onEnd: 'extend' });
        expect(retry[0]).not.toHaveProperty('pluginId');
        expect(retry[0]).not.toHaveProperty('playlistId');
        expect(retry[0]).not.toHaveProperty('mixInSimilar');
        // Still this slot's changeover, stamped with it, so the tick leaves it alone until the next one.
        expect(retry[1]).toMatchObject({ id: 'rock' });
        expect(activity.record).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'schedule.changeover', severity: 'warn', data: expect.objectContaining({ withoutSource: true }) }),
        );
        expect(activity.record).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule.declined' }));
    });

    it('reads a misconfigured plugin as a failed read, though it arrives as a 422 too', async () => {
        let calls = 0;
        const { tick, console } = build({
            inForce: slot('rock'),
            airing: 'classical',
            putOnAir: async () => {
                if (calls++ === 0)
                    throw httpError(422).withDetails({ code: 'PLUGIN_MISCONFIGURED', message: 'no password', plugin: 'deadair.navidrome' });
                return {};
            },
        });

        await tick();

        expect(console.putOnAir).toHaveBeenCalledTimes(2);
    });

    it('declines a slot with no source that cannot be aired, since there is nothing to go without', async () => {
        const { tick, console, activity } = build({
            inForce: slot('morning', { source: undefined }),
            airing: 'overnight',
            putOnAir: async () => {
                throw new Error('the database is down');
            },
        });

        await tick();

        expect(console.putOnAir).toHaveBeenCalledTimes(1);
        expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule.declined' }));
    });

    it('declines when even the block without its source cannot be aired', async () => {
        const { tick, console, activity } = build({
            inForce: slot('morning'),
            airing: 'overnight',
            putOnAir: async () => {
                throw new Error('the provider is down');
            },
        });

        await tick();

        expect(console.putOnAir).toHaveBeenCalledTimes(2);
        expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule.declined' }));
    });

    it('does not rethrow a failed changeover, so the cron is the retry', async () => {
        const { tick } = build({
            inForce: slot('morning'),
            airing: 'overnight',
            putOnAir: async () => {
                throw new Error('the provider is down');
            },
        });

        await expect(tick()).resolves.toBeUndefined();
    });

    it('changes over onto a chart when that is what the slot names', async () => {
        const { tick, console } = build({ inForce: slot('countdown', { source: { chartId: 'deadair.lastfm:top-100', chartOrder: 'countdown' } }) });

        await tick();

        expect(console.putOnAir).toHaveBeenCalledWith(
            expect.objectContaining({ chartId: 'deadair.lastfm:top-100', chartOrder: 'countdown' }),
            expect.anything(),
            false,
            expect.anything(),
        );
    });

    it('sends a chart slot no playlist at all, since the two are alternatives', async () => {
        // `putOnAir` can make no sense of both, and a changeover that sent a leftover pair beside a
        // chart would air whichever branch happened to be tested first.
        const { tick, console } = build({ inForce: slot('countdown', { source: { chartId: 'deadair.lastfm:top-100' } }) });

        await tick();

        const [input] = (console.putOnAir as unknown as { mock: { calls: Record<string, unknown>[][] } }).mock.calls[0]!;

        expect(input).not.toHaveProperty('pluginId');
        expect(input).not.toHaveProperty('playlistId');
        // Absent rather than defaulted here: `putOnAir` owns what an unset order means, so a slot
        // that never chose one gets the same broadcast a hand-pressed button does.
        expect(input).not.toHaveProperty('chartOrder');
    });

    it('changes over onto a playlist the station owns, and sends it nothing else', async () => {
        // The source whose changeover never waits on a provider: its records are read from the
        // station's own library, so a long pool starts on time however slow the provider that lists it.
        const { tick, console } = build({ inForce: slot('rock', { source: { stationPlaylistId: '0a0b0c0d-0000-4000-8000-000000000001' } }) });

        await tick();

        const [input] = (console.putOnAir as unknown as { mock: { calls: Record<string, unknown>[][] } }).mock.calls[0]!;

        expect(input).toMatchObject({ stationPlaylistId: '0a0b0c0d-0000-4000-8000-000000000001' });
        expect(input).not.toHaveProperty('pluginId');
        expect(input).not.toHaveProperty('playlistId');
        expect(input).not.toHaveProperty('chartId');
    });

    it('sustains a gap from a chart when the operator named one', async () => {
        const { tick, console } = build({
            inForce: undefined,
            airing: 'breakfast',
            sustaining: { chartId: 'deadair.lastfm:top-100', chartOrder: 'ranked', callins: false },
        });

        await tick();

        expect(console.putOnAir).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Sustaining', chartId: 'deadair.lastfm:top-100', chartOrder: 'ranked' }),
            undefined,
            true,
        );
    });
});
