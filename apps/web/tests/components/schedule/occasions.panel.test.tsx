// Occasions on the Programme page. What is pinned: a row says when it falls and when next, and can be
// switched, given a mood and moved; a write sends the whole occasion back without what only the station
// can say; and the form sends only the fields the chosen kind reads.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OccasionsPanel } from '../../../src/components/schedule/occasions.panel';
import { datesIn, inputOfDraft, movedOccasion, BLANK_OCCASION } from '../../../src/components/schedule/occasions.edits';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listOccasions = vi.fn();
const addAnOccasion = vi.fn();
const changeAnOccasion = vi.fn();
const removeAnOccasion = vi.fn();
const reorderOccasions = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        schedule: {
            listOccasions: () => listOccasions(),
            addAnOccasion: (body: unknown) => addAnOccasion(body),
            changeAnOccasion: (id: string, body: unknown) => changeAnOccasion(id, body),
            removeAnOccasion: (id: string) => removeAnOccasion(id),
            reorderOccasions: (body: unknown) => reorderOccasions(body),
        },
    },
}));

afterEach(() => {
    vi.resetAllMocks();
});

const halloween = { id: 'a', words: 'Halloween', ruleKind: 'fixed', month: 10, day: 31, enabled: true, position: 10, nextDate: '2027-10-31' };
const thanksgiving = {
    id: 'b',
    words: 'Thanksgiving',
    ruleKind: 'weekday',
    month: 11,
    ordinal: 4,
    weekday: 4,
    enabled: false,
    position: 20,
    nextDate: '2026-11-26',
};
const ranOut = { id: 'c', words: 'Diwali', ruleKind: 'dates', dates: ['2001-11-14'], enabled: true, position: 30 };
const answer = { occasions: [halloween, thanksgiving, ranOut], calendars: [{ calendar: 'hebrew', months: ['Tishri', 'Kislev'] }] };

describe('OccasionsPanel', () => {
    it('says when each one falls, when next, and when a list has run out', async () => {
        listOccasions.mockResolvedValue(answer);
        render(<OccasionsPanel />);

        expect(await screen.findByText('Halloween')).toBeInTheDocument();
        expect(screen.getByText(/October 31/)).toBeInTheDocument();
        expect(screen.getByText(/fourth Thursday of November/i)).toBeInTheDocument();
        expect(screen.getByText('Dates run out')).toBeInTheDocument();
    });

    it('switches one on, sending the whole occasion without the fields only the station can say', async () => {
        const user = setupUser();
        listOccasions.mockResolvedValue(answer);
        changeAnOccasion.mockResolvedValue(answer);
        render(<OccasionsPanel />);

        await user.click(await screen.findByRole('switch', { name: /Thanksgiving/ }));

        await waitFor(() =>
            expect(changeAnOccasion).toHaveBeenCalledWith('b', {
                words: 'Thanksgiving',
                ruleKind: 'weekday',
                month: 11,
                ordinal: 4,
                weekday: 4,
                enabled: true,
            }),
        );
    });

    it('moves one up, and offers no move off either end', async () => {
        const user = setupUser();
        listOccasions.mockResolvedValue(answer);
        reorderOccasions.mockResolvedValue(answer);
        render(<OccasionsPanel />);

        expect(await screen.findByRole('button', { name: 'Move Halloween up' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Move Diwali down' })).toBeDisabled();

        await user.click(screen.getByRole('button', { name: 'Move Thanksgiving up' }));

        await waitFor(() => expect(reorderOccasions).toHaveBeenCalledWith({ ids: ['b', 'a', 'c'] }));
    });

    it('removes one', async () => {
        const user = setupUser();
        listOccasions.mockResolvedValue(answer);
        removeAnOccasion.mockResolvedValue({ ...answer, occasions: [thanksgiving, ranOut] });
        render(<OccasionsPanel />);

        await user.click(await screen.findByRole('button', { name: 'Remove Halloween' }));

        await waitFor(() => expect(removeAnOccasion).toHaveBeenCalledWith('a'));
        await waitFor(() => expect(screen.queryByText('Halloween')).not.toBeInTheDocument());
    });

    it('adds one, and says why when the station refuses it', async () => {
        const user = setupUser();
        listOccasions.mockResolvedValue(answer);
        addAnOccasion.mockRejectedValue(new Error('month 6 has no day 31'));
        render(<OccasionsPanel />);

        await user.type(await screen.findByRole('textbox', { name: /What the presenter says/ }), 'Founders Day');
        await user.click(screen.getByRole('button', { name: 'Add occasion' }));

        await waitFor(() =>
            expect(addAnOccasion).toHaveBeenCalledWith({ words: 'Founders Day', ruleKind: 'fixed', month: 1, day: 1, enabled: true }),
        );
        expect(await screen.findByText('That change could not be saved')).toBeInTheDocument();
    });

    it('cannot add one with no words', async () => {
        listOccasions.mockResolvedValue(answer);
        render(<OccasionsPanel />);

        expect(await screen.findByRole('button', { name: 'Add occasion' })).toBeDisabled();
    });

    it('fills the form to change one, and saves it under its own id', async () => {
        const user = setupUser();
        listOccasions.mockResolvedValue(answer);
        changeAnOccasion.mockResolvedValue(answer);
        render(<OccasionsPanel />);

        await user.click(await screen.findByRole('button', { name: 'Edit Thanksgiving' }));
        const words = await screen.findByRole('textbox', { name: /What the presenter says/ });
        expect(words).toHaveValue('Thanksgiving');

        await user.clear(words);
        await user.type(words, 'Turkey Day');
        await user.click(screen.getByRole('button', { name: 'Save occasion' }));

        await waitFor(() =>
            expect(changeAnOccasion).toHaveBeenCalledWith('b', {
                words: 'Turkey Day',
                ruleKind: 'weekday',
                month: 11,
                ordinal: 4,
                weekday: 4,
                enabled: false,
            }),
        );
    });
});

describe('the form as it is sent', () => {
    const draft = {
        ...BLANK_OCCASION,
        words: ' Day ',
        month: 5,
        day: 2,
        ordinal: -1,
        weekday: 1,
        offsetDays: -2,
        calendarMonth: 'Tishri',
        dates: '2026-11-08, 2027-10-29\n',
    };

    it('sends only what the kind reads', () => {
        expect(inputOfDraft({ ...draft, ruleKind: 'fixed' })).toEqual({ words: 'Day', enabled: true, ruleKind: 'fixed', month: 5, day: 2 });
        expect(inputOfDraft({ ...draft, ruleKind: 'weekday' })).toEqual({
            words: 'Day',
            enabled: true,
            ruleKind: 'weekday',
            month: 5,
            ordinal: -1,
            weekday: 1,
        });
        expect(inputOfDraft({ ...draft, ruleKind: 'easter' })).toEqual({ words: 'Day', enabled: true, ruleKind: 'easter', offsetDays: -2 });
        expect(inputOfDraft({ ...draft, ruleKind: 'calendar' })).toEqual({
            words: 'Day',
            enabled: true,
            ruleKind: 'calendar',
            calendar: 'hebrew',
            calendarMonth: 'Tishri',
            day: 2,
        });
        expect(inputOfDraft({ ...draft, ruleKind: 'dates' })).toEqual({
            words: 'Day',
            enabled: true,
            ruleKind: 'dates',
            dates: ['2026-11-08', '2027-10-29'],
        });
    });

    it('sends a mood only when there is one', () => {
        expect(inputOfDraft({ ...draft, mood: 'love' })).toHaveProperty('mood', 'love');
        expect(inputOfDraft(draft)).not.toHaveProperty('mood');
    });

    it('reads dates in whatever they were pasted with', () => {
        expect(datesIn('2026-11-08\n2027-10-29, 2028-10-17  ')).toEqual(['2026-11-08', '2027-10-29', '2028-10-17']);
    });

    it('moves an id a place, and answers nothing off either end', () => {
        expect(movedOccasion(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
        expect(movedOccasion(['a', 'b', 'c'], 'a', -1)).toBeUndefined();
        expect(movedOccasion(['a', 'b', 'c'], 'c', 1)).toBeUndefined();
    });
});
