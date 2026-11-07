// Leans and never-play rules on the Programme page. What is pinned: a lean says what it favours and
// until when and can be stopped; a rule says whether it holds now and when it is scoped to; and a new
// rule sends a season or a window of hours only when both of its ends were filled in, and modes or
// schedule blocks only when some were chosen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { RulesPanel } from '../../../src/components/schedule/rules.panel';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listNeverPlayRules = vi.fn();
const addANeverPlayRule = vi.fn();
const removeANeverPlayRule = vi.fn();
const readTheGenreSteer = vi.fn();
const steerTowardGenres = vi.fn();
const stopSteering = vi.fn();
const readTheTalkDirection = vi.fn();
const directThePresenters = vi.fn();
const stopDirectingThePresenters = vi.fn();
const listSchedule = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        director: {
            listNeverPlayRules: () => listNeverPlayRules(),
            addANeverPlayRule: (body: unknown) => addANeverPlayRule(body),
            removeANeverPlayRule: (id: string) => removeANeverPlayRule(id),
            readTheGenreSteer: () => readTheGenreSteer(),
            steerTowardGenres: (body: unknown) => steerTowardGenres(body),
            stopSteering: () => stopSteering(),
            readTheTalkDirection: () => readTheTalkDirection(),
            directThePresenters: (body: unknown) => directThePresenters(body),
            stopDirectingThePresenters: () => stopDirectingThePresenters(),
        },
        schedule: {
            listSchedule: () => listSchedule(),
        },
    },
}));

afterEach(() => {
    vi.resetAllMocks();
});

beforeEach(() => {
    readTheTalkDirection.mockResolvedValue({});
});

const slot = (id: string, label: string) => ({ id, label, startsAtMinutes: 0, endsAtMinutes: 60, mode: 'rotation' });

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

    it('shows the note to the presenters in force and stops it', async () => {
        listNeverPlayRules.mockResolvedValue({ rules: [] });
        readTheGenreSteer.mockResolvedValue({});
        readTheTalkDirection.mockResolvedValue({
            direction: { words: "It's Sam's birthday tonight", endsAt: DateTime.fromISO('2026-10-04T21:00:00') },
        });
        stopDirectingThePresenters.mockResolvedValue({});
        const user = setupUser();
        render(<RulesPanel />);

        expect(await screen.findByText(/The presenters are leaning on "It's Sam's birthday tonight" until/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Stop' }));

        await waitFor(() => expect(stopDirectingThePresenters).toHaveBeenCalled());
    });

    it('tells the presenters a trimmed line for the hours chosen', async () => {
        listNeverPlayRules.mockResolvedValue({ rules: [] });
        readTheGenreSteer.mockResolvedValue({});
        directThePresenters.mockResolvedValue({});
        const user = setupUser();
        render(<RulesPanel />);

        const button = await screen.findByRole('button', { name: 'Tell them' });
        expect(button).toBeDisabled();
        await user.type(screen.getByRole('textbox', { name: 'What to tell them' }), "  We're snowed in, keep it cosy ");
        await user.click(button);

        await waitFor(() => expect(directThePresenters).toHaveBeenCalledWith({ words: "We're snowed in, keep it cosy", hours: 3 }));
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

    it('adds a rule refusing live recordings with nothing to type, and names it in the list', async () => {
        listNeverPlayRules.mockResolvedValue({ rules: [{ id: 'r1', field: 'version', value: 'live', inForce: true }] });
        readTheGenreSteer.mockResolvedValue({});
        addANeverPlayRule.mockResolvedValue({ rules: [] });
        const user = setupUser();
        render(<RulesPanel />);

        expect(await screen.findByText('Version')).toBeInTheDocument();
        await user.click(screen.getByRole('radio', { name: 'Live recordings' }));
        expect(screen.queryByRole('textbox', { name: 'Genre' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Add rule' }));

        await waitFor(() => expect(addANeverPlayRule).toHaveBeenCalledWith({ field: 'version', value: 'live' }));
    });

    it('names the modes and schedule blocks a rule is limited to, and the id of a block that is gone', async () => {
        listNeverPlayRules.mockResolvedValue({
            rules: [{ id: 'r1', field: 'genre', value: 'Metal', modes: ['rotation', 'feature'], slotIds: ['s1', 'gone'], inForce: false }],
        });
        listSchedule.mockResolvedValue({ slots: [slot('s1', 'Breakfast')] });
        readTheGenreSteer.mockResolvedValue({});
        render(<RulesPanel />);

        expect(await screen.findByText('only in Rotation, Feature · only during Breakfast, gone')).toBeInTheDocument();
    });

    it('limits a new rule to the modes and blocks chosen, and clears them once it is added', async () => {
        listNeverPlayRules.mockResolvedValue({ rules: [] });
        listSchedule.mockResolvedValue({ slots: [slot('s1', 'Breakfast'), slot('s2', 'Late show')] });
        readTheGenreSteer.mockResolvedValue({});
        addANeverPlayRule.mockResolvedValue({ rules: [] });
        const user = setupUser();
        render(<RulesPanel />);

        await user.type(await screen.findByRole('textbox', { name: 'Genre' }), 'Metal');
        await user.click(screen.getByRole('combobox', { name: 'Only in these modes' }));
        await user.click(await screen.findByRole('option', { name: 'Setlist' }));
        await user.click(screen.getByRole('combobox', { name: 'Only during these blocks' }));
        await user.click(await screen.findByRole('option', { name: 'Late show' }));
        await user.click(screen.getByRole('button', { name: 'Add rule' }));

        await waitFor(() => expect(addANeverPlayRule).toHaveBeenCalledWith({ field: 'genre', value: 'Metal', modes: ['setlist'], slotIds: ['s2'] }));
        await waitFor(() => expect(screen.getByPlaceholderText('Every mode')).toBeInTheDocument());
        expect(screen.getByPlaceholderText('Whatever is on')).toBeInTheDocument();
    });
});
