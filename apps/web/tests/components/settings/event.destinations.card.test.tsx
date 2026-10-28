import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError } from '@deadair/sdk';

import { EventDestinationsCard } from '../../../src/components/settings/event.destinations.card';
import { clearSession } from '../../../src/auth/session.store';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

const listEventDestinations = vi.fn();
const listEventTypes = vi.fn();
const createEventDestination = vi.fn();
const updateEventDestination = vi.fn();
const deleteEventDestination = vi.fn();
const rotateEventDestinationSecret = vi.fn();
const testEventDestination = vi.fn();
const listEventDeliveries = vi.fn();
const startMFAChallenge = vi.fn();
const requestToken = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        authentication: {
            requestToken: (...args: unknown[]) => requestToken(...args),
            factors: {
                startMFAChallenge: (...args: unknown[]) => startMFAChallenge(...args),
            },
        },
        events: {
            listEventDestinations: (...args: unknown[]) => listEventDestinations(...args),
            listEventTypes: (...args: unknown[]) => listEventTypes(...args),
            createEventDestination: (...args: unknown[]) => createEventDestination(...args),
            updateEventDestination: (...args: unknown[]) => updateEventDestination(...args),
            deleteEventDestination: (...args: unknown[]) => deleteEventDestination(...args),
            rotateEventDestinationSecret: (...args: unknown[]) => rotateEventDestinationSecret(...args),
            testEventDestination: (...args: unknown[]) => testEventDestination(...args),
            listEventDeliveries: (...args: unknown[]) => listEventDeliveries(...args),
        },
    },
}));

afterEach(() => {
    for (const mock of [
        listEventDestinations,
        listEventTypes,
        createEventDestination,
        updateEventDestination,
        deleteEventDestination,
        rotateEventDestinationSecret,
        testEventDestination,
        listEventDeliveries,
        startMFAChallenge,
        requestToken,
    ])
        mock.mockReset();
    clearSession();
});

const AT = DateTime.fromISO('2026-10-14T20:00:00Z');
const HALL = {
    id: 'd-1',
    name: 'Hall light',
    url: 'http://192.168.1.20:8123/api/webhook/hall',
    enabled: true,
    events: [],
    consecutiveFailures: 0,
    lastDeliveredAt: AT,
    createdAt: AT,
    updatedAt: AT,
};
const RELAY = {
    id: 'd-2',
    name: 'Relay',
    url: 'https://relay.example.com/hook',
    enabled: false,
    events: ['request.received'],
    consecutiveFailures: 20,
    disabledReason: 'failing',
    lastFailure: 'Answered 404.',
    createdAt: AT,
    updatedAt: AT,
};
const SECRET = 'deadair_dest_0123456789abcdefghijABCDEFGHIJ0123456789a';

const stepUpDenied = () =>
    new SdkError(
        403,
        'Forbidden',
        {
            statusCode: 403,
            message: 'Forbidden',
            details: { kind: 'step_up_required', stepUp: { within: 'PT5M', excludeMethods: ['email', 'password', 'oidc'] } },
        },
        new Headers(),
    );

function withAuthenticator() {
    startMFAChallenge.mockResolvedValue({
        result: 'mfa_required',
        challenge_id: 'mfa-9',
        factors: [{ method: 'authenticator', method_id: 'totp-1', kind: 'possession', label: 'Phone' }],
    });
    requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-2', expires_in: 900, token_type: 'Bearer', scope: '' });
}

function withTypes() {
    listEventTypes.mockResolvedValue({
        types: [
            { type: 'track.started', description: 'A record began.', subscribable: true, example: {} },
            { type: 'destination.test', description: 'A test.', subscribable: false, example: {} },
        ],
    });
}

describe('EventDestinationsCard', () => {
    it('lists each destination with what it is sent and how it is doing', async () => {
        withTypes();
        listEventDestinations.mockResolvedValue({ destinations: [HALL, RELAY] });
        render(<EventDestinationsCard />);

        const hall = (await screen.findByText('Hall light')).closest('tr')!;
        expect(within(hall).getByText('Every event')).toBeInTheDocument();
        expect(within(hall).getByText('Delivering')).toBeInTheDocument();

        const relay = screen.getByText('Relay').closest('tr')!;
        expect(within(relay).getByText('request.received')).toBeInTheDocument();
        expect(within(relay).getByText('Turned off by the station')).toBeInTheDocument();
        expect(within(relay).getByText('Answered 404.')).toBeInTheDocument();
    });

    it('says so when there are none', async () => {
        withTypes();
        listEventDestinations.mockResolvedValue({ destinations: [] });
        render(<EventDestinationsCard />);

        expect(await screen.findByText('No destinations yet. Add one below and send it a test.')).toBeInTheDocument();
    });

    it('adds a destination and shows its secret once', async () => {
        withTypes();
        listEventDestinations.mockResolvedValue({ destinations: [] });
        createEventDestination.mockResolvedValue({ ...HALL, secret: SECRET });
        const user = setupUser();
        render(<EventDestinationsCard />);

        await user.type(await screen.findByLabelText('Name'), 'Hall light');
        await user.type(screen.getByLabelText('Address'), HALL.url);
        await user.click(screen.getByRole('button', { name: 'Add destination' }));

        await waitFor(() => expect(createEventDestination).toHaveBeenCalledWith({ name: 'Hall light', url: HALL.url, events: [] }));
        expect(await screen.findByText(SECRET)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'I have copied it' }));
        expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    });

    it('re-verifies when the API asks for a recent factor, then adds the destination', async () => {
        withTypes();
        withAuthenticator();
        listEventDestinations.mockResolvedValue({ destinations: [] });
        createEventDestination.mockRejectedValueOnce(stepUpDenied()).mockResolvedValueOnce({ ...HALL, secret: SECRET });
        const user = setupUser();
        render(<EventDestinationsCard />);

        await user.type(await screen.findByLabelText('Name'), 'Hall light');
        await user.type(screen.getByLabelText('Address'), HALL.url);
        await user.click(screen.getByRole('button', { name: 'Add destination' }));
        expect(await screen.findByText('Confirm it is you')).toBeInTheDocument();
        await user.type(await screen.findByLabelText('Authenticator code'), '123456');

        expect(await screen.findByText(SECRET)).toBeInTheDocument();
        expect(createEventDestination).toHaveBeenCalledTimes(2);
    });

    it('re-verifies before saving a destination the API wants confirmed', async () => {
        withTypes();
        withAuthenticator();
        listEventDestinations.mockResolvedValue({ destinations: [HALL] });
        updateEventDestination.mockRejectedValueOnce(stepUpDenied()).mockResolvedValueOnce(HALL);
        const user = setupUser();
        render(<EventDestinationsCard />);

        await user.click(await screen.findByRole('button', { name: 'Edit' }));
        await user.click(await screen.findByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Confirm it is you')).toBeInTheDocument();
        await user.type(await screen.findByLabelText('Authenticator code'), '123456');

        await waitFor(() => expect(updateEventDestination).toHaveBeenCalledTimes(2));
    });

    it('sends a test and says what the destination answered', async () => {
        withTypes();
        listEventDestinations.mockResolvedValue({ destinations: [HALL] });
        testEventDestination.mockResolvedValue({ delivered: false, httpStatus: 503, durationMs: 41, error: 'Answered 503.' });
        const user = setupUser();
        render(<EventDestinationsCard />);

        await user.click(await screen.findByRole('button', { name: 'Send test' }));

        expect(await screen.findByText('Hall light did not take the test event')).toBeInTheDocument();
        expect(screen.getByText('It answered 503 in 41 ms. Answered 503.')).toBeInTheDocument();
        expect(testEventDestination).toHaveBeenCalledWith('d-1');
    });
});
