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

function open(target: ClockBand, onClose = vi.fn()) {
    const onSubmit = vi.fn();
    render(
        <BandEditor
            target={{ kind: 'edit', band: target }}
            kinds={['podcast']}
            onClose={onClose}
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

// A hard marker is a band at a time of day that airs exactly on its time. The station keeps a stored `hard`
// when a save leaves it out, so the editor has to send `false` to make one soft again.
describe('BandEditor and a hard marker', () => {
    it('opens on a hard band switched on and sends it back hard', async () => {
        const user = setupUser();
        const onSubmit = open(band({ hard: true }));

        expect((await screen.findByRole('switch', { name: /On the dot/ })) as HTMLInputElement).toHaveProperty('checked', true);
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ hard: true }));
    });

    it('sends false, not nothing, when it is switched off', async () => {
        const user = setupUser();
        const onSubmit = open(band({ hard: true }));

        await user.click(await screen.findByRole('switch', { name: /On the dot/ }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ hard: false }));
    });

    it('offers no switch to an interval band, which has no time to hit', async () => {
        const user = setupUser();
        const onSubmit = open(band({ at: 'interval', hour: undefined, minute: undefined, everyMs: 1_200_000 }));

        await screen.findByRole('button', { name: 'Save' });
        expect(screen.queryByRole('switch', { name: /On the dot/ })).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('hard');
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

// Escape used to throw away whatever had been typed, and the backdrop did the same with one stray click.
describe('BandEditor holding an edit', () => {
    it('closes on Escape while nothing has changed', async () => {
        const user = setupUser();
        const onClose = vi.fn();
        open(band(), onClose);
        await screen.findByRole('button', { name: 'Save' });

        await user.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalled();
    });

    it('stays open on Escape once something has changed', async () => {
        const user = setupUser();
        const onClose = vi.fn();
        open(band(), onClose);

        await user.click(await screen.findByRole('switch', { name: /In force/ }));
        await user.keyboard('{Escape}');

        expect(onClose).not.toHaveBeenCalled();
    });
});
