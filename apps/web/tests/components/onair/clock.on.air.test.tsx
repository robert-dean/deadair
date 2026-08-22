// The on-air page is where a broadcast is actually started, and until now it said what the station
// would PLAY and nothing about what it would SAY. What is tested is the sentence: that it describes
// the clock in force, that it tells an empty clock apart from one whose rules are all switched off,
// that it names a band the station cannot honour without being opened first, and that opening it
// reaches the real editor rather than a copy of it.

import { describe, expect, it, vi } from 'vitest';
import type { ClockBandList } from '@deadair/sdk';

import { ClockOnAir } from '../../../src/components/onair/clock.on.air';
import { render, screen, setupUser } from '../../utils/render';

const listClockBands = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        director: {
            listClockBands: () => listClockBands(),
            createClockBand: vi.fn(),
            updateClockBand: vi.fn(),
            deleteClockBand: vi.fn(),
        },
        topics: { listTopics: () => Promise.resolve({ topics: [] }) },
    },
}));

type Band = ClockBandList['bands'][number];

const band = (over: Partial<Band> = {}): Band => ({
    id: 'band-1',
    kind: 'news',
    at: 'clock',
    minute: 30,
    position: 0,
    enabled: true,
    ...over,
});

const clock = (bands: Band[], producibleKinds: string[] = ['news', 'ident', 'talkbreak']): ClockBandList => ({ bands, producibleKinds });

describe('ClockOnAir', () => {
    it('says what the station will say, and when', async () => {
        listClockBands.mockResolvedValue(clock([band(), band({ id: 'band-2', kind: 'ident', at: 'interval', everyMs: 90 * 60_000 })]));

        render(<ClockOnAir />);

        expect(await screen.findByText('On the clock: news at :30 · ident every 90m')).toBeTruthy();
    });

    it('leads with the subject, the way the running order will name it', async () => {
        listClockBands.mockResolvedValue(clock([band({ topicId: 'topic-1', topicLabel: 'Technology' })]));

        render(<ClockOnAir />);

        expect(await screen.findByText('On the clock: Technology news at :30')).toBeTruthy();
    });

    it('tells an operator what an empty clock means, rather than saying nothing', async () => {
        listClockBands.mockResolvedValue(clock([]));

        render(<ClockOnAir />);

        expect(await screen.findByText(/Nothing on the clock: the station keeps its ordinary spacing/)).toBeTruthy();
    });

    it('tells a clock nobody wrote apart from one every rule is switched off on', async () => {
        listClockBands.mockResolvedValue(clock([band({ enabled: false })]));

        render(<ClockOnAir />);

        expect(await screen.findByText(/every band is switched off/)).toBeTruthy();
    });

    it('names a band nothing can produce without being opened first', async () => {
        // The panel badges this too, and the panel is behind the fold. A rule that looks right and
        // is passed over every time its slot comes round is the one state worth saying unasked.
        listClockBands.mockResolvedValue(clock([band({ kind: 'weather' })], ['news']));

        render(<ClockOnAir />);

        expect(await screen.findByText('On the clock: weather at :30 (nothing can produce this)')).toBeTruthy();
    });

    it('claims nothing about the clock before the clock has answered', async () => {
        listClockBands.mockReturnValue(new Promise(() => {}));

        render(<ClockOnAir />);

        expect(screen.queryByText(/On the clock/)).toBeNull();
        expect(screen.queryByText(/Nothing on the clock/)).toBeNull();
    });

    it('opens onto the clock the station already has, rather than a second one', async () => {
        listClockBands.mockResolvedValue(clock([band()]));
        const user = setupUser();

        render(<ClockOnAir />);

        await user.click(await screen.findByRole('button', { name: /Change what it says/ }));

        // The panel's own affordance, which is what proves this is `ClockPanel` and not a summary
        // that would send an operator to another page to write one line.
        expect(await screen.findByRole('button', { name: 'Add band' })).toBeTruthy();
        expect(screen.getByText(/belongs to the station rather than to a broadcast/)).toBeTruthy();
    });
});
