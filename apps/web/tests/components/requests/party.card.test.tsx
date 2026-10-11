// A party from the operator's side: starting one, its code, ending it, and the one warning that
// matters, a code pointing at an address no guest's phone can reach.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError } from '@deadair/sdk';

import { PartyCard } from '../../../src/components/requests/party.card';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const getParty = vi.fn();
const startParty = vi.fn();
const endParty = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        requests: {
            party: {
                getParty: () => getParty(),
                startParty: (...args: unknown[]) => startParty(...args),
                endParty: () => endParty(),
            },
        },
    },
}));

vi.mock('@tanstack/react-router', () => ({ Link: (props: object) => <a {...props} /> }));

const live = { token: 'dp_abc', createdAt: DateTime.utc(), expiresAt: DateTime.utc().plus({ hours: 6 }), guests: 3 };

afterEach(() => {
    vi.resetAllMocks();
});

describe('PartyCard', () => {
    it('offers to start a party when none is on, and starts one for as long as asked', async () => {
        getParty.mockResolvedValue({});
        startParty.mockResolvedValue(live);
        const user = setupUser();
        render(<PartyCard />);

        await user.click(await screen.findByRole('button', { name: 'Start a party' }));
        const hours = screen.getByLabelText('How long the code works, in hours');
        await user.clear(hours);
        await user.type(hours, '3');
        await user.click(screen.getAllByRole('button', { name: 'Start a party' }).at(-1)!);

        await waitFor(() => expect(startParty).toHaveBeenCalledWith({ hours: 3 }));
        expect(await screen.findByText('3 guests have joined.')).toBeInTheDocument();
    });

    it('shows the code for the party that is on, pointing at the guest page', async () => {
        getParty.mockResolvedValue({ party: live });
        render(<PartyCard />);

        expect(await screen.findByTitle('The party’s code')).toBeInTheDocument();
        expect(screen.getByText('3 guests have joined.')).toBeInTheDocument();
    });

    it('warns when the code points at this machine, which no phone can reach', async () => {
        getParty.mockResolvedValue({ party: live });
        render(<PartyCard />);

        // jsdom's origin is localhost.
        expect(await screen.findByText(/which a guest’s phone cannot reach/)).toBeInTheDocument();
    });

    it('ends the party after asking', async () => {
        getParty.mockResolvedValue({ party: live });
        endParty.mockResolvedValue(undefined);
        const user = setupUser();
        render(<PartyCard />);

        await user.click(await screen.findByRole('button', { name: 'End the party' }));
        expect(screen.getByText(/every guest is turned away straight away/)).toBeInTheDocument();
        await user.click(screen.getAllByRole('button', { name: 'End the party' }).at(-1)!);

        await waitFor(() => expect(endParty).toHaveBeenCalled());
        expect(await screen.findByRole('button', { name: 'Start a party' })).toBeInTheDocument();
    });

    it('draws nothing for somebody who may not run a party', async () => {
        getParty.mockRejectedValue(new SdkError(403, 'Forbidden', {}, new Headers()));
        render(<PartyCard />);

        await waitFor(() => expect(getParty).toHaveBeenCalled());
        expect(screen.queryByText('Party')).not.toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});
