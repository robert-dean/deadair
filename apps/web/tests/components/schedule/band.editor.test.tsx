// A band at a time of day can be on chosen days, which is what lets a news show run on weekdays. What is
// pinned: the days an existing band has are the ones its editor opens on and sends back, choosing none
// sends none (every day, not an empty set the API has to interpret), and an interval band, which has no
// day to be on, is never offered them.

import { describe, expect, it, vi } from 'vitest';
import type { ClockBand } from '@deadair/sdk';

import { BandEditor } from '../../../src/components/schedule/band.editor';
import { daysOf, whenOf } from '../../../src/components/schedule/clock.panel';
import { render, screen, setupUser } from '../../utils/render';

vi.mock('../../../src/api/client', () => ({
    sdk: { topics: { listTopics: () => Promise.resolve({ topics: [] }) } },
}));

const band = (over: Partial<ClockBand> = {}): ClockBand => ({
    id: 'band-1',
    kind: 'podcast',
    at: 'clock',
    hour: 18,
    minute: 0,
    position: 0,
    enabled: true,
    ...over,
});

function open(target: ClockBand) {
    const onSubmit = vi.fn();
    render(
        <BandEditor
            target={{ kind: 'edit', band: target }}
            kinds={['podcast']}
            onClose={vi.fn()}
            onSubmit={onSubmit}
            onDelete={vi.fn()}
            saving={false}
            deleting={false}
        />,
    );
    return onSubmit;
}

describe('BandEditor on chosen days', () => {
    it('opens on the days a band has and sends them back', async () => {
        const user = setupUser();
        const onSubmit = open(band({ days: [1, 2, 3, 4, 5] }));

        await user.click(await screen.findByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ at: 'clock', hour: 18, minute: 0, days: [1, 2, 3, 4, 5] }));
    });

    it('sends no days for a band on every day, and says what none means', async () => {
        const user = setupUser();
        const onSubmit = open(band());

        expect(await screen.findByText('No day chosen means every day.')).toBeTruthy();
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('days');
    });

    it('offers no days to an interval band', async () => {
        open(band({ at: 'interval', hour: undefined, minute: undefined, everyMs: 90 * 60_000 }));

        await screen.findByRole('button', { name: 'Save' });
        expect(screen.queryByText('No day chosen means every day.')).toBeNull();
    });
});

describe('daysOf', () => {
    it('says nothing for every day, and leaves the time to whenOf', () => {
        expect(daysOf(band({ days: [] }))).toBeUndefined();
        expect(daysOf(band())).toBeUndefined();
        expect(whenOf(band({ hour: undefined, minute: 30, days: [1, 2] }))).toBe(':30');
    });

    it('reads a run of three or more as a range, from Monday', () => {
        expect(daysOf(band({ days: [5, 1, 3, 2, 4] }))).toBe('Mon–Fri');
        expect(daysOf(band({ days: [2, 3, 4, 5] }))).toBe('Tue–Fri');
        expect(daysOf(band({ days: [6, 0] }))).toBe('Sat, Sun');
        expect(daysOf(band({ days: [1, 3, 5, 6, 0] }))).toBe('Mon, Wed, Fri–Sun');
    });
});
