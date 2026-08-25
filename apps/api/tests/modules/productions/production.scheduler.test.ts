// What the clock commissions, and the one thing it did not know it was inside. A production airs as a
// block in the MIDDLE of somebody's broadcast, so a `:40 callin` on a heavy-metal show that inherited
// neither the brief nor the host is a phone-in about nothing in particular, presented by the
// station's default persona rather than by the person whose show it is.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { ProductionScheduler } from '../../../src/modules/productions/production.scheduler.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/** Strings, because every layer of `AppConfig` holds them. See `production.settings.test.ts`. */
const config = (rows: Record<string, string> = {}): AppConfig => ({ get: (key: string, fallback: unknown) => rows[key] ?? fallback }) as never;

function build(
    options: {
        bands?: { kind: string; at: string; minute: number }[];
        scheduled?: { kind: string; scheduledFor: number }[];
        standing?: { pending: boolean; lastAiredAt?: number };
    } = {},
) {
    const opened: Record<string, unknown>[] = [];
    const productions = {
        scheduledAfter: vi.fn(async () => options.scheduled ?? []),
        // What a STANDING commission asks: is one already coming, and when did the last one air.
        standingIn: vi.fn(async () => options.standing ?? { pending: false }),
        open: vi.fn(async (input: Record<string, unknown>) => {
            opened.push(input);
            return { id: `p${opened.length}`, ...input };
        }),
    };
    const bands = { active: vi.fn(async () => options.bands ?? [{ kind: 'callin', at: 'clock', minute: 30 }]) };
    const jobs = { send: vi.fn(async () => undefined) };

    return {
        opened,
        productions,
        jobs,
        scheduler: new ProductionScheduler(productions as never, bands as never, jobs as never, config(), logger as never),
    };
}

// A moment with a :30 band comfortably inside the three-hour read-ahead.
const now = Date.UTC(2026, 7, 25, 12, 0, 0);

describe('commissioning what the clock wants', () => {
    it('takes the running broadcast with it', async () => {
        const { scheduler, opened } = build();

        await scheduler.ripen(now, { brief: 'heavy metal hits', personaId: 'persona-1' });

        expect(opened[0]).toMatchObject({ kind: 'callin', brief: 'heavy metal hits', personaId: 'persona-1' });
    });

    it('says nothing about a show that asked for nothing', async () => {
        // An ordinary broadcast: a playlist, no brief, no host of its own. Passing an empty brief
        // would be the station telling a model the show is about "".
        const { scheduler, opened } = build();

        await scheduler.ripen(now, { brief: '   ' });

        expect(opened[0]).not.toHaveProperty('brief');
        expect(opened[0]).not.toHaveProperty('personaId');
    });

    it('commissions nothing twice for one slot, which is what makes it safe on every pass', async () => {
        const first = build();
        await first.scheduler.ripen(now, {});
        const at = first.opened[0]?.scheduledFor as number;

        const again = build({ scheduled: [{ kind: 'callin', scheduledFor: at }] });
        await again.scheduler.ripen(now, {});

        expect(again.opened).toEqual([]);
    });

    it('sends the first pass rather than running one', async () => {
        const { scheduler, jobs } = build();

        await scheduler.ripen(now, {});

        expect(jobs.send).toHaveBeenCalledWith('director.produce', expect.objectContaining({ pass: 'outline' }));
    });

    it('ignores a band whose kind is not made as a production', async () => {
        const { scheduler, opened } = build({ bands: [{ kind: 'news', at: 'clock', minute: 30 }] });

        await scheduler.ripen(now, {});

        expect(opened).toEqual([]);
    });
});

// The other half, and the one that is not about the clock at all: a broadcast told to take calls
// keeps taking them for as long as it runs, spaced from the last one that AIRED.
describe('a broadcast that takes calls', () => {
    const show = { broadcastId: 'b1', callins: true, callinEveryMinutes: 30 };

    const taking = (options: { standing?: { pending: boolean; lastAiredAt?: number } } = {}) => build({ bands: [], ...options });

    it('puts somebody on the phone even where the clock asked for nothing', async () => {
        const { scheduler, opened } = taking();

        await scheduler.ripen(now, show);

        expect(opened).toHaveLength(1);
        expect(opened[0]).toMatchObject({ kind: 'callin' });
    });

    it('does not wait for the spacing before the FIRST one', async () => {
        // A station told to take calls and then made to wait half an hour for the first is one an
        // operator assumes is broken.
        const { scheduler, opened } = taking({ standing: { pending: false } });

        await scheduler.ripen(now, show);

        expect(opened).toHaveLength(1);
    });

    it('commissions nothing while one is already coming', async () => {
        // The guard that has to come first: a call takes minutes to write, and the spacing clock
        // does not start until it airs. Without this, a commit pass every few seconds queues a
        // switchboard.
        const { scheduler, opened } = taking({ standing: { pending: true } });

        await scheduler.ripen(now, show);

        expect(opened).toEqual([]);
    });

    it('waits out the spacing after one has aired', async () => {
        const { scheduler, opened } = taking({ standing: { pending: false, lastAiredAt: now - 10 * 60_000 } });

        await scheduler.ripen(now, show);

        expect(opened).toEqual([]);
    });

    it('takes another once the spacing has passed', async () => {
        const { scheduler, opened } = taking({ standing: { pending: false, lastAiredAt: now - 31 * 60_000 } });

        await scheduler.ripen(now, show);

        expect(opened).toHaveLength(1);
    });

    it('takes none at all for a broadcast that was not told to', async () => {
        const { scheduler, opened } = taking();

        await scheduler.ripen(now, { ...show, callins: false });
        await scheduler.ripen(now, { ...show, callinEveryMinutes: 0 });
        // A production is spaced against the broadcast it is inside, so one with no broadcast at all
        // has nothing to be spaced against.
        await scheduler.ripen(now, { callins: true, callinEveryMinutes: 30 });

        expect(opened).toEqual([]);
    });

    it('airs when it is ready rather than at an instant nobody chose', async () => {
        // No `scheduledFor`, which is also what keeps it `background` at the model for its whole
        // life: nothing is waiting on air for it.
        const { scheduler, opened } = taking();

        await scheduler.ripen(now, show);

        expect(opened[0]).not.toHaveProperty('scheduledFor');
    });
});
