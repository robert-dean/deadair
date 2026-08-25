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

function build(options: { bands?: { kind: string; at: string; minute: number }[]; scheduled?: { kind: string; scheduledFor: number }[] } = {}) {
    const opened: Record<string, unknown>[] = [];
    const productions = {
        scheduledAfter: vi.fn(async () => options.scheduled ?? []),
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
