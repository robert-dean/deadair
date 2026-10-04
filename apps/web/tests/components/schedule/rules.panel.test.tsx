// Leans and never-play rules on the Programme page. What is pinned: a lean says what it favours and
// until when and can be stopped; a rule says whether it holds now and when it is scoped to; and a new
// rule sends a season or a window of hours only when both of its ends were filled in.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { RulesPanel } from '../../../src/components/schedule/rules.panel';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listNeverPlayRules = vi.fn();
const addANeverPlayRule = vi.fn();
const removeANeverPlayRule = vi.fn();
const readTheGenreSteer = vi.fn();
const steerTowardGenres = vi.fn();
const stopSteering = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        director: {
            listNeverPlayRules: () => listNeverPlayRules(),
            addANeverPlayRule: (body: unknown) => addANeverPlayRule(body),
            removeANeverPlayRule: (id: string) => removeANeverPlayRule(id),
            readTheGenreSteer: () => readTheGenreSteer(),
            steerTowardGenres: (body: unknown) => steerTowardGenres(body),
            stopSteering: () => stopSteering(),
        },
    },
}));

afterEach(() => {
    vi.resetAllMocks();
});

describe('RulesPanel', () => {
    it('shows the lean in force and stops it', async () => {
        listNeverPlayRules.mockResolvedValue({ rules: [] });
        readTheGenreSteer.mockResolvedValue({ steer: { genres: ['Soul', 'Funk'], endsAt: DateTime.fromISO('2026-10-04T21:00:00') } });
        stopSteering.mockResolvedValue({});
        const user = setupUser();
        render(<RulesPanel />);

        expect(await screen.findByText(/Leaning toward Soul, Funk until/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Stop leaning' }));

        await waitFor(() => expect(stopSteering).toHaveBeenCalled());
    });

    it('says whether each rule holds now and when it is scoped to', async () => {
        listNeverPlayRules.mockResolvedValue({
            rules: [
                { id: 'r1', field: 'genre', value: 'Christmas', seasonFrom: '01-07', seasonTo: '11-24', inForce: true },
                { id: 'r2', field: 'tag', value: 'live', inForce: false },
            ],
        });
        readTheGenreSteer.mockResolvedValue({});
        render(<RulesPanel />);

        expect(await screen.findByText('Christmas')).toBeInTheDocument();
        expect(screen.getByText('01-07 to 11-24')).toBeInTheDocument();
        expect(screen.getByText('In force')).toBeInTheDocument();
        expect(screen.getByText('Not now')).toBeInTheDocument();
    });

    it('adds a rule without a half-filled season', async () => {
        listNeverPlayRules.mockResolvedValue({ rules: [] });
        readTheGenreSteer.mockResolvedValue({});
        addANeverPlayRule.mockResolvedValue({ rules: [] });
        const user = setupUser();
        render(<RulesPanel />);

        await user.type(await screen.findByRole('textbox', { name: 'Genre' }), 'Country');
        await user.type(screen.getByLabelText('From (MM-DD)'), '12-01');
        await user.click(screen.getByRole('button', { name: 'Add rule' }));

        await waitFor(() => expect(addANeverPlayRule).toHaveBeenCalledWith({ field: 'genre', value: 'Country' }));
    });
});
