// Festivals on the Programme page. What is pinned: a row says the dates, the place, the bill and where the
// festival stands; the form reads a pasted bill, headliners first, with an act's day after a comma; and a
// name with a comma in it stays a name.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FestivalsPanel } from '../../../src/components/schedule/festivals.panel';
import {
    actsOfLines,
    BLANK_FESTIVAL,
    canSaveFestival,
    draftOfFestival,
    inputOfFestivalDraft,
} from '../../../src/components/schedule/festivals.edits';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listFestivals = vi.fn();
const addAFestival = vi.fn();
const changeAFestival = vi.fn();
const removeAFestival = vi.fn();
const lookUpAFestival = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        schedule: {
            listFestivals: () => listFestivals(),
            addAFestival: (body: unknown) => addAFestival(body),
            changeAFestival: (id: string, body: unknown) => changeAFestival(id, body),
            removeAFestival: (id: string) => removeAFestival(id),
            lookUpAFestival: (query: unknown) => lookUpAFestival(query),
        },
    },
}));

afterEach(() => {
    vi.resetAllMocks();
});

const shakyKnees = {
    id: 'f1',
    name: 'Shaky Knees',
    startsOn: '2027-05-07',
    endsOn: '2027-05-09',
    place: 'Piedmont Park, Atlanta',
    acts: [{ artist: 'Foo Fighters', headliner: true }, { artist: 'Wet Leg', day: '2027-05-08' }, { artist: 'The Struts' }],
    state: 'upcoming',
};
const answer = { festivals: [shakyKnees] };

describe('FestivalsPanel', () => {
    it('says the dates, the place, the bill and where it stands', async () => {
        listFestivals.mockResolvedValue(answer);
        render(<FestivalsPanel />);

        expect(await screen.findByText('Shaky Knees')).toBeInTheDocument();
        expect(screen.getByText(/· Piedmont Park, Atlanta/)).toBeInTheDocument();
        expect(screen.getByText('3 acts on the bill, headlined by Foo Fighters')).toBeInTheDocument();
        expect(screen.getByText('Coming up')).toBeInTheDocument();
    });

    it('says so when there are none', async () => {
        listFestivals.mockResolvedValue({ festivals: [] });
        render(<FestivalsPanel />);

        expect(await screen.findByText('No festivals')).toBeInTheDocument();
    });

    it('opens one for editing with its bill split into headliners and everyone else', async () => {
        const user = setupUser();
        listFestivals.mockResolvedValue(answer);
        changeAFestival.mockResolvedValue(answer);
        render(<FestivalsPanel />);

        await user.click(await screen.findByRole('button', { name: 'Edit Shaky Knees' }));

        expect(screen.getByRole('textbox', { name: 'Headliners' })).toHaveValue('Foo Fighters');
        expect(screen.getByRole('textbox', { name: 'Everyone else on the bill' })).toHaveValue('Wet Leg, 2027-05-08\nThe Struts');

        await user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(changeAFestival).toHaveBeenCalled());
        expect(changeAFestival.mock.calls[0]![0]).toBe('f1');
        expect(changeAFestival.mock.calls[0]![1]).toEqual({
            name: 'Shaky Knees',
            startsOn: '2027-05-07',
            endsOn: '2027-05-09',
            place: 'Piedmont Park, Atlanta',
            acts: [{ artist: 'Foo Fighters', headliner: true }, { artist: 'Wet Leg', day: '2027-05-08' }, { artist: 'The Struts' }],
        });
    });

    it('looks one up, starts the form from it, and sends where it came from with the first save', async () => {
        const user = setupUser();
        listFestivals.mockResolvedValue({ festivals: [] });
        addAFestival.mockResolvedValue(answer);
        lookUpAFestival.mockResolvedValue({
            listings: [
                {
                    pluginId: 'deadair.ticketmaster',
                    eventId: 'G5v',
                    name: 'Shaky Knees',
                    startsOn: '2027-05-07',
                    endsOn: '2027-05-09',
                    place: 'Piedmont Park, Atlanta',
                    acts: ['Foo Fighters', 'Wet Leg'],
                },
            ],
            unanswered: ['Another service'],
        });
        render(<FestivalsPanel />);

        await user.type(await screen.findByRole('textbox', { name: 'Look it up' }), 'Shaky');
        await user.click(screen.getByRole('button', { name: 'Look up' }));
        expect(await screen.findByText('Could not ask: Another service')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Start from this' }));

        expect(lookUpAFestival).toHaveBeenCalledWith({ name: 'Shaky' });
        expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Shaky Knees');
        expect(screen.getByRole('textbox', { name: 'Everyone else on the bill' })).toHaveValue('Foo Fighters\nWet Leg');

        await user.click(screen.getByRole('button', { name: 'Add festival' }));
        await waitFor(() => expect(addAFestival).toHaveBeenCalled());
        expect(addAFestival.mock.calls[0]![0]).toEqual(
            expect.objectContaining({ name: 'Shaky Knees', sourcePluginId: 'deadair.ticketmaster', sourceEventId: 'G5v' }),
        );
    });

    it('says so when nothing is found', async () => {
        const user = setupUser();
        listFestivals.mockResolvedValue({ festivals: [] });
        lookUpAFestival.mockResolvedValue({ listings: [] });
        render(<FestivalsPanel />);

        await user.type(await screen.findByRole('textbox', { name: 'Look it up' }), 'Nowhere Fest');
        await user.click(screen.getByRole('button', { name: 'Look up' }));

        expect(await screen.findByText('Nothing found. You can still add it by hand.')).toBeInTheDocument();
    });

    it('removes one', async () => {
        const user = setupUser();
        listFestivals.mockResolvedValue(answer);
        removeAFestival.mockResolvedValue({ festivals: [] });
        render(<FestivalsPanel />);

        await user.click(await screen.findByRole('button', { name: 'Remove Shaky Knees' }));

        await waitFor(() => expect(removeAFestival).toHaveBeenCalledWith('f1'));
    });
});

describe('the festival form', () => {
    it('reads one act per line, a day after a comma or a bar, and drops blank lines', () => {
        expect(actsOfLines('Wet Leg, 2027-05-08\n\n  The Struts  \nFontaines D.C. | 2027-05-09', false)).toEqual([
            { artist: 'Wet Leg', day: '2027-05-08' },
            { artist: 'The Struts' },
            { artist: 'Fontaines D.C.', day: '2027-05-09' },
        ]);
    });

    it('keeps a name with a comma in it as a name', () => {
        expect(actsOfLines('Crosby, Stills, Nash & Young', true)).toEqual([{ artist: 'Crosby, Stills, Nash & Young', headliner: true }]);
    });

    it('sends a one-day festival with its first day as its last, and leaves an empty optional out', () => {
        expect(inputOfFestivalDraft({ ...BLANK_FESTIVAL, name: ' Day Fest ', startsOn: '2027-06-01', place: ' ' })).toEqual({
            name: 'Day Fest',
            startsOn: '2027-06-01',
            endsOn: '2027-06-01',
            acts: [],
        });
    });

    it('needs a name and a first day before it can save', () => {
        expect(canSaveFestival(BLANK_FESTIVAL)).toBe(false);
        expect(canSaveFestival({ ...BLANK_FESTIVAL, name: 'Fest', startsOn: '2027-06-01' })).toBe(true);
    });

    it('reads back what it wrote', () => {
        const draft = draftOfFestival({ ...shakyKnees, state: 'upcoming' } as never);
        expect(inputOfFestivalDraft(draft).acts).toEqual(shakyKnees.acts.map(act => (act.headliner ? act : { ...act })));
    });
});
