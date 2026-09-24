// The operator's view of listener requests. Open requests by default, the one needing a decision
// drawn so it is seen, grant in one click, decline after asking and with the operator's own words.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError } from '@deadair/sdk';

import { RequestsPanel } from '../../../src/components/requests/requests.panel';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listRequests = vi.fn();
const grantRequest = vi.fn();
const declineRequest = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        requests: {
            listRequests: (...args: unknown[]) => listRequests(...args),
            grantRequest: (...args: unknown[]) => grantRequest(...args),
            declineRequest: (...args: unknown[]) => declineRequest(...args),
        },
    },
}));

afterEach(() => {
    listRequests.mockReset();
    grantRequest.mockReset();
    declineRequest.mockReset();
});

const request = (overrides: Record<string, unknown> = {}) => ({
    id: 'r-1',
    status: 'waiting',
    title: 'Teardrop',
    artist: 'Massive Attack',
    requesterName: 'Sam',
    source: 'chat',
    createdAt: DateTime.fromISO('2026-09-24T12:00:00Z'),
    ...overrides,
});

describe('RequestsPanel', () => {
    it('lists open requests, with who asked and from where', async () => {
        listRequests.mockResolvedValue({ requests: [request(), request({ id: 'r-2', status: 'aired', title: 'Angel' })] });
        render(<RequestsPanel />);

        expect(await screen.findByText('Teardrop')).toBeInTheDocument();
        expect(screen.getByText('Needs a decision')).toBeInTheDocument();
        expect(screen.getByText(/From a chat/)).toBeInTheDocument();
        // Played is not open, so it waits behind Recent.
        expect(screen.queryByText('Angel')).not.toBeInTheDocument();
    });

    it('shows everything recent on asking', async () => {
        listRequests.mockResolvedValue({ requests: [request({ status: 'aired', title: 'Angel' })] });
        render(<RequestsPanel />);
        const user = setupUser();

        await user.click(await screen.findByText('Recent'));

        expect(await screen.findByText('Angel')).toBeInTheDocument();
    });

    it('grants a waiting request in one click', async () => {
        listRequests.mockResolvedValue({ requests: [request()] });
        grantRequest.mockResolvedValue(request({ status: 'queued' }));
        render(<RequestsPanel />);
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Grant' }));

        await waitFor(() => expect(grantRequest).toHaveBeenCalledWith('r-1'));
    });

    it('declines after asking, with the operator’s words', async () => {
        listRequests.mockResolvedValue({ requests: [request({ status: 'pending' })] });
        declineRequest.mockResolvedValue(request({ status: 'declined' }));
        render(<RequestsPanel />);
        const user = setupUser();

        expect(screen.queryByRole('button', { name: 'Grant' })).not.toBeInTheDocument();
        await user.click(await screen.findByRole('button', { name: 'Decline' }));
        await user.type(await screen.findByLabelText('What to tell them'), 'Not tonight.');
        await user.click(screen.getAllByRole('button', { name: 'Decline' }).at(-1)!);

        await waitFor(() => expect(declineRequest).toHaveBeenCalledWith('r-1', { reason: 'Not tonight.' }));
    });

    it('offers nothing to decide on a request already in the running order', async () => {
        listRequests.mockResolvedValue({ requests: [request({ status: 'queued' })] });
        render(<RequestsPanel />);

        expect(await screen.findByText('In the running order')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('says so, rather than failing, to somebody who is not an operator', async () => {
        listRequests.mockRejectedValue(new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Forbidden' }, new Headers()));
        render(<RequestsPanel />);

        expect(await screen.findByText(/for the station’s operators/)).toBeInTheDocument();
    });

    it('shows a dedication as the listener wrote it, so an operator can decide on it', async () => {
        listRequests.mockResolvedValue({ requests: [request({ dedicateTo: 'Danielle', message: 'you still owe me twenty bucks' })] });
        render(<RequestsPanel />);

        expect(await screen.findByText('For Danielle: “you still owe me twenty bucks”')).toBeInTheDocument();
    });
});
