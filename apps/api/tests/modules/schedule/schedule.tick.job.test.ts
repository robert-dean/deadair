// The tick's whole job is deciding whether to do nothing, and there are four ways it should: the
// station is stood down, there is no schedule, the slot in force is already on, or the slot cannot
// be aired. Only the last of those is visible from outside, so the rest are pinned here rather than
// left to be noticed the first time a schedule changes a station over at three in the morning for no
// reason.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import type { JobContext } from '@maroonedsoftware/jobbroker';

import { ScheduleTickJob } from '../../../src/modules/schedule/schedule.tick.job.js';
import type { ScheduleService } from '../../../src/modules/schedule/schedule.service.js';
import { ScheduleNotices } from '../../../src/modules/schedule/schedule.notices.js';
import type { DirectorConsoleService } from '../../../src/modules/director/director.console.service.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
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
    /** What the clock says should be on. */
    inForce?: ScheduleSlot;
    /** What the running order says it already is. */
    airing?: string;
    /** What going on air does, for the decline case. */
    putOnAir?: () => Promise<unknown>;
    /** What the station plays between blocks. Absent is a station that has named nothing. */
    sustaining?: { pluginId?: string; playlistId?: string; brief?: string; era?: { from?: number; to?: number } };
}

function build(options: Options = {}) {
    const schedule = {
        inForce: vi.fn(async () => options.inForce),
        sustaining: vi.fn(() => options.sustaining),
    } as unknown as ScheduleService;

    const director = {
        status: vi.fn(() => ({ active: options.active ?? true, airMode: 'audience' as const, remaining: 0 })),
        order: vi.fn(() => (options.airing === undefined ? { items: [] } : { items: [], slotId: options.airing })),
    } as unknown as DirectorService;

    const console = {
        putOnAir: vi.fn(options.putOnAir ?? (async () => ({}))),
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

    it('hands a station in a GAP to its sustaining source', async () => {
        // The whole of what ending a block means. Without this the station would carry on with what
        // the last block left it, which is indistinguishable from that block never having ended.
        const { tick, console } = build({ inForce: undefined, airing: 'breakfast', sustaining: { pluginId: 'p', playlistId: 'l' } });

        await tick();

        expect(console.putOnAir).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sustaining', pluginId: 'p', playlistId: 'l' }));
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
        );
    });

    it('says nothing about a period a slot does not name', async () => {
        const { tick, console } = build({ inForce: slot('morning') });

        await tick();

        expect(console.putOnAir.mock.calls[0]?.[0]).not.toHaveProperty('eraFrom');
        expect(console.putOnAir.mock.calls[0]?.[0]).not.toHaveProperty('eraTo');
    });

    it('carries the sustaining period through a gap too', async () => {
        const { tick, console } = build({ inForce: undefined, airing: 'breakfast', sustaining: { era: { from: 1990 } } });

        await tick();

        expect(console.putOnAir).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sustaining', eraFrom: 1990 }));
        expect(console.putOnAir.mock.calls[0]?.[0]).not.toHaveProperty('eraTo');
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
        const { tick, console } = build({ inForce: undefined, airing: undefined, sustaining: { pluginId: 'p', playlistId: 'l' } });

        await tick();

        expect(console.putOnAir).not.toHaveBeenCalled();
    });

    it('does nothing when the slot in force is already on', async () => {
        const { tick, console } = build({ inForce: slot('morning'), airing: 'morning' });

        await tick();

        expect(console.putOnAir).not.toHaveBeenCalled();
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
                throw new Error('that playlist has no tracks to play');
            },
        });

        await tick();

        expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule.declined' }));
        expect(activity.record).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule.changeover' }));
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
});
