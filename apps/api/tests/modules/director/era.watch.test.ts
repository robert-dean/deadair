// A feed producer writes on EDGES, so what is worth pinning here is not the sentence but WHEN one is
// written: once per period, again when the period changes, and again after a recovery. A row per
// refill would make the activity feed a log file with a primary key, and no row at all would leave an
// operator with a station running short and nothing saying why.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
import { EraWatch } from '../../../src/modules/director/era.watch.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

function build() {
    const record = vi.fn(async (_event: Record<string, unknown>) => undefined);
    const activity = { record } as unknown as ActivityRecorder;

    return { watch: new EraWatch(activity, logger), record };
}

describe('EraWatch', () => {
    it('says it once, however many refills run into the same period', () => {
        const { watch, record } = build();

        watch.starved({ from: 1930, to: 1939 }, 400);
        watch.starved({ from: 1930, to: 1939 }, 400);
        watch.starved({ from: 1930, to: 1939 }, 380);

        expect(record).toHaveBeenCalledTimes(1);
    });

    it('says it again when the operator narrows the period, because that is a new question', () => {
        // The reason the flag is keyed by the WINDOW rather than being a bare boolean. An operator
        // who read the first row, edited 1970-1979 down to 1975-1975 and got nothing has asked
        // something new and deserves an answer rather than silence.
        const { watch, record } = build();

        watch.starved({ from: 1970, to: 1979 }, 400);
        watch.starved({ from: 1975, to: 1975 }, 400);

        expect(record).toHaveBeenCalledTimes(2);
    });

    it('says it again after a recovery', () => {
        const { watch, record } = build();

        watch.starved({ from: 1930, to: 1939 }, 400);
        watch.clear();
        watch.starved({ from: 1930, to: 1939 }, 400);

        expect(record).toHaveBeenCalledTimes(2);
    });

    it('names the period, because "the station found nothing" is not something anyone can act on', () => {
        const { watch, record } = build();

        watch.starved({ from: 1968, to: 1979 }, 400);

        const written = record.mock.calls[0]![0] as unknown as { kind: string; detail: string; data: Record<string, unknown> };
        expect(written.kind).toBe('rotation.eraStarved');
        expect(written.detail).toMatch(/1968 to 1979/);
        expect(written.data).toMatchObject({ eraFrom: 1968, eraTo: 1979, playableSample: 400 });
    });

    it('describes an open-ended period as one, rather than leaving a sentence half-written', () => {
        const { watch, record } = build();

        watch.starved({ from: 1990 }, 12);
        watch.starved({ to: 1959 }, 12);

        const detail = (index: number) => (record.mock.calls[index]![0] as unknown as { detail: string }).detail;
        expect(detail(0)).toMatch(/from 1990 onwards/);
        expect(detail(1)).toMatch(/from 1959 and earlier/);
    });

    it('says an undated record was never the problem, since one is always eligible', () => {
        // Without this the operator's first move is to go and enrich the catalog, which is exactly
        // the wrong fix: an unknown year passes every period, so the records that fell out are ones
        // the catalog HAS dated.
        const { watch, record } = build();

        watch.starved({ from: 1930, to: 1939 }, 400);

        expect((record.mock.calls[0]![0] as unknown as { detail: string }).detail).toMatch(/does not know is always eligible/);
    });

    it('clears nothing it never said, so a quiet station stays quiet', () => {
        const { watch, record } = build();

        watch.clear();

        expect(record).not.toHaveBeenCalled();
    });
});
