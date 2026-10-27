// A booked live show arms the live input once, at its time, and at its end disarms an input that is
// still waiting for anybody. Every case here is one of the ways that could go wrong in front of a
// presenter: arming again after a Cancel, cutting somebody who is on the air, or taking over an input
// somebody armed by hand before the show began.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { LiveBookings, LiveNotices } from '../../../src/modules/schedule/live.bookings.js';
import type { LiveArm, LiveArmRepository } from '../../../src/modules/schedule/live.arm.repository.js';
import type { ScheduleService } from '../../../src/modules/schedule/schedule.service.js';
import type { PlayoutControlClient, LiveState } from '../../../src/modules/playout/liquidsoap.control.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const show: ScheduleSlot = {
    id: 'pirate',
    label: 'Pirate Hour',
    startsAtMinutes: 20 * 60,
    endsAtMinutes: 22 * 60,
    days: [],
    dates: { from: '2026-11-06', to: '2026-11-06', yearly: false },
    live: true,
    mode: 'rotation',
    onEnd: 'extend',
};

interface Options {
    /** The live show on now. Absent is none. */
    on?: ScheduleSlot;
    /** What the live input says it is doing. Absent is a chain that cannot be read. */
    live?: LiveState;
    /** Whether an arm or a disarm lands. Absent is yes. */
    takes?: boolean;
    /** Nights already written down. */
    arms?: (LiveArm & { closed?: boolean })[];
}

function build(options: Options = {}) {
    const rows = [...(options.arms ?? [])];
    let live = options.live;

    const schedule = {
        liveInForce: vi.fn(async () => (options.on === undefined ? undefined : { slot: options.on, night: '2026-11-06' })),
    } as unknown as ScheduleService;

    const arms = {
        has: vi.fn(async (slotId: string, occurrence: string) => rows.some(row => row.slotId === slotId && row.occurrence === occurrence)),
        open: vi.fn(async () => rows.filter(row => row.closed !== true).map(({ slotId, occurrence, armed }) => ({ slotId, occurrence, armed }))),
        record: vi.fn(async (arm: LiveArm) => {
            if (!rows.some(row => row.slotId === arm.slotId && row.occurrence === arm.occurrence)) rows.push({ ...arm });
        }),
        close: vi.fn(async (slotId: string, occurrence: string) => {
            for (const row of rows) if (row.slotId === slotId && row.occurrence === occurrence) row.closed = true;
        }),
    };

    const reading = () => (live === undefined ? undefined : { live });
    const control = {
        status: vi.fn(async () => reading()),
        armLive: vi.fn(async () => {
            if (options.takes === false) return undefined;
            live = 'armed';
            return reading();
        }),
        disarmLive: vi.fn(async () => {
            if (options.takes === false) return undefined;
            live = 'off';
            return reading();
        }),
    };

    const activity = { record: vi.fn(async (_event?: Record<string, unknown>) => undefined) };

    const bookings = new LiveBookings(
        schedule,
        arms as unknown as LiveArmRepository,
        control as unknown as PlayoutControlClient,
        activity as unknown as ActivityRecorder,
        new LiveNotices(),
        logger,
    );

    return { run: () => bookings.run(), rows, control, activity, cancel: () => (live = 'off'), goOnAir: () => (live = 'onair') };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('LiveBookings', () => {
    it('does nothing with no live show on and nothing open', async () => {
        const { run, control } = build({ live: 'off' });

        await run();

        expect(control.status).not.toHaveBeenCalled();
        expect(control.armLive).not.toHaveBeenCalled();
    });

    it("arms the input with the show's name when it begins, and says so", async () => {
        const { run, control, rows, activity } = build({ on: show, live: 'off' });

        await run();

        expect(control.armLive).toHaveBeenCalledWith('Pirate Hour');
        expect(rows).toEqual([{ slotId: 'pirate', occurrence: '2026-11-06', armed: true }]);
        expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule.live_armed' }));
    });

    it('arms once a night, so a Cancel at the Desk is not undone a minute later', async () => {
        const { run, control, cancel } = build({ on: show, live: 'off' });

        await run();
        cancel();
        await run();

        expect(control.armLive).toHaveBeenCalledTimes(1);
    });

    it('leaves an input somebody already armed or put on the air alone, then and at the end', async () => {
        for (const state of ['armed', 'preroll', 'onair'] as const) {
            const booked = build({ on: show, live: state });

            await booked.run();

            expect(booked.control.armLive).not.toHaveBeenCalled();
            expect(booked.rows).toEqual([{ slotId: 'pirate', occurrence: '2026-11-06', armed: false }]);
        }

        const ended = build({ live: 'armed', arms: [{ slotId: 'pirate', occurrence: '2026-11-06', armed: false }] });
        await ended.run();

        expect(ended.control.disarmLive).not.toHaveBeenCalled();
        expect(ended.rows[0]?.closed).toBe(true);
    });

    it('disarms at the end when nobody came, and says so', async () => {
        const { run, control, rows, activity } = build({ live: 'armed', arms: [{ slotId: 'pirate', occurrence: '2026-11-06', armed: true }] });

        await run();

        expect(control.disarmLive).toHaveBeenCalledTimes(1);
        expect(rows[0]?.closed).toBe(true);
        expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule.live_unattended' }));
    });

    it('never cuts a presenter who is counting in or on the air when the show ends', async () => {
        for (const state of ['preroll', 'onair'] as const) {
            const { run, control, rows } = build({ live: state, arms: [{ slotId: 'pirate', occurrence: '2026-11-06', armed: true }] });

            await run();

            expect(control.disarmLive).not.toHaveBeenCalled();
            expect(rows[0]?.closed).toBe(true);
        }
    });

    it('keeps the night open while the show is still on', async () => {
        const { run, control, rows, goOnAir } = build({ on: show, live: 'off' });

        await run();
        goOnAir();
        await run();

        expect(control.disarmLive).not.toHaveBeenCalled();
        expect(rows[0]?.closed).toBeUndefined();
    });

    it('writes nothing when the chain cannot be read or refuses the arm, so the next minute tries again, and warns once', async () => {
        const unread = build({ on: show });
        await unread.run();
        await unread.run();

        expect(unread.rows).toEqual([]);
        expect(unread.activity.record).toHaveBeenCalledTimes(1);
        expect(unread.activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'schedule.live_unarmed', severity: 'warn' }));

        const refused = build({ on: show, live: 'off', takes: false });
        await refused.run();

        expect(refused.rows).toEqual([]);
    });

    it('leaves the night open when the disarm at its end does not land, so the next minute tries again', async () => {
        const { run, rows } = build({ live: 'armed', takes: false, arms: [{ slotId: 'pirate', occurrence: '2026-11-06', armed: true }] });

        await run();

        expect(rows[0]?.closed).toBeUndefined();
    });

    it('closes the night when the chain cannot be read at its end, since a restart has dropped the arm anyway', async () => {
        const { run, rows } = build({ arms: [{ slotId: 'pirate', occurrence: '2026-11-06', armed: true }] });

        await run();

        expect(rows[0]?.closed).toBe(true);
    });
});
