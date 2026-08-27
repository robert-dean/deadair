// A band naming a sort of break nothing on this station can make claims its boundary and is then
// passed over, which the planner reports once per pass in a log line and nowhere an operator looks.
// What is tested here is that the page says it, and that it says it about the right rows: a rule
// switched off is not a rule the station failed to honour, and neither is a rule read before the
// answer arrived.

import { describe, expect, it, vi } from 'vitest';
import type { ClockBandList } from '@deadair/sdk';

import { ClockPanel } from '../../../src/components/schedule/clock.panel';
import { render, screen, waitFor } from '../../utils/render';

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

const band = (over: Partial<ClockBandList['bands'][number]> = {}): ClockBandList['bands'][number] => ({
    id: 'band-1',
    kind: 'news',
    at: 'clock',
    minute: 30,
    position: 0,
    enabled: true,
    ...over,
});

const clock = (bands: ClockBandList['bands'], producibleKinds: string[]): ClockBandList => ({ bands, producibleKinds });

describe('ClockPanel', () => {
    it('says nothing about a band the station can honour', async () => {
        listClockBands.mockResolvedValue(clock([band()], ['news']));

        render(<ClockPanel />);

        // `findAllByText`: the band's kind is on its row AND on the dial beside it, which is the
        // point of the dial. The claim here is about the warning, not the count.
        await screen.findAllByText(/news/);
        expect(screen.queryByText('nothing can produce this')).toBeNull();
    });

    it('names a band nothing can produce', async () => {
        listClockBands.mockResolvedValue(clock([band({ kind: 'weather' })], ['news', 'talkbreak']));

        render(<ClockPanel />);

        expect(await screen.findByText('nothing can produce this')).toBeTruthy();
    });

    it('leaves a switched-off band alone, because turning it on is the thing to do about it', async () => {
        listClockBands.mockResolvedValue(clock([band({ kind: 'weather', enabled: false })], ['news']));

        render(<ClockPanel />);

        expect(await screen.findByText('Off')).toBeTruthy();
        expect(screen.queryByText('nothing can produce this')).toBeNull();
    });

    it('does not accuse the whole clock while the answer is still on its way', async () => {
        // An unanswered query and a station that can produce nothing are the same empty list, and
        // flashing the warning on every row before the first read lands is how an operator learns
        // to skim it.
        let answer: (list: ClockBandList) => void = () => {};
        listClockBands.mockReturnValue(new Promise<ClockBandList>(resolve => (answer = resolve)));

        render(<ClockPanel />);

        expect(screen.queryByText('nothing can produce this')).toBeNull();

        answer(clock([band({ kind: 'weather' })], []));
        await waitFor(() => expect(screen.getByText('nothing can produce this')).toBeTruthy());
    });
});
