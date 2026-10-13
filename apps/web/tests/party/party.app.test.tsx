// The guest page end to end against a stubbed station: joining with the code, being turned away, and
// asking for a record.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError } from '@deadair/sdk';

import { PartyApp } from '../../src/party/party.app';
import { GUEST_STORAGE_KEY } from '../../src/party/party.session';
import { render, screen, setupUser } from '../utils/render';

const joinParty = vi.fn();
const searchRequestableRecords = vi.fn();
const createRequest = vi.fn();
const listMyRequests = vi.fn();
const insistOnRequest = vi.fn();
const getNowPlaying = vi.fn();

vi.mock('../../src/party/party.client', () => ({
    setGuestToken: vi.fn(),
    partySdk: {
        requests: {
            party: { joinParty: (...args: unknown[]) => joinParty(...args) },
            searchRequestableRecords: (...args: unknown[]) => searchRequestableRecords(...args),
            createRequest: (...args: unknown[]) => createRequest(...args),
            listMyRequests: () => listMyRequests(),
            insistOnRequest: (...args: unknown[]) => insistOnRequest(...args),
        },
        nowplaying: { getNowPlaying: () => getNowPlaying() },
    },
}));

vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));

const EXPIRES = DateTime.utc().plus({ hours: 3 });

beforeEach(() => {
    joinParty.mockResolvedValue({ accessToken: 'jwt', expiresAt: EXPIRES });
    listMyRequests.mockResolvedValue({ requests: [] });
    getNowPlaying.mockResolvedValue({
        station: 'Deadair',
        onAir: true,
        listeners: 1,
        mounts: [],
        track: { kind: 'record', title: 'The Last in Line', artist: 'Dio' },
    });
});

afterEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/party');
});

describe('the guest page', () => {
    it('joins with the code in the address, then tidies the code out of it', async () => {
        window.history.replaceState(null, '', '/party#dp_abc');

        render(<PartyApp />);

        expect(await screen.findByText('Your requests')).toBeInTheDocument();
        expect(joinParty).toHaveBeenCalledWith({ token: 'dp_abc' });
        expect(window.location.hash).toBe('');
        expect(JSON.parse(window.localStorage.getItem(GUEST_STORAGE_KEY)!).pass).toBe('dp_abc');
        expect(await screen.findByText('On air: The Last in Line by Dio')).toBeInTheDocument();
    });

    it('carries on as the same guest after a reload, without joining again', async () => {
        window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify({ pass: 'dp_abc', accessToken: 'jwt', expiresAt: EXPIRES.toISO() }));

        render(<PartyApp />);

        expect(await screen.findByText('Your requests')).toBeInTheDocument();
        expect(joinParty).not.toHaveBeenCalled();
    });

    it('says the party has ended when the code is no longer good', async () => {
        window.history.replaceState(null, '', '/party#dp_old');
        joinParty.mockRejectedValue(new SdkError(404, 'Not Found', {}, new Headers()));

        render(<PartyApp />);

        expect(await screen.findByText('This party has ended')).toBeInTheDocument();
    });

    it('asks for the code when the page was opened without one', async () => {
        render(<PartyApp />);

        expect(await screen.findByText('Scan the party’s code')).toBeInTheDocument();
    });

    it('turns the guest away the moment the station says the party is over', async () => {
        window.history.replaceState(null, '', '/party#dp_abc');
        listMyRequests.mockRejectedValue(new SdkError(401, 'Unauthorized', {}, new Headers()));

        render(<PartyApp />);

        expect(await screen.findByText('This party has ended')).toBeInTheDocument();
        expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBeNull();
    });

    it('finds a record and asks for it with a dedication', async () => {
        window.history.replaceState(null, '', '/party#dp_abc');
        searchRequestableRecords.mockResolvedValue({ tracks: [{ trackId: 't-1', title: 'Holy Diver', artist: 'Dio', album: 'Holy Diver' }] });
        createRequest.mockResolvedValue({
            id: 'r-1',
            status: 'queued',
            title: 'Holy Diver',
            artist: 'Dio',
            requesterName: 'Sam',
            source: 'app',
            createdAt: DateTime.utc(),
        });
        const user = setupUser();
        render(<PartyApp />);
        await screen.findByText('Your requests');

        await user.type(screen.getByLabelText('Search for a record'), 'holy');
        await user.click(await screen.findByRole('button', { name: 'Request “Holy Diver”' }));
        await user.type(screen.getByLabelText('Your name'), 'Sam');
        await user.type(screen.getByLabelText('Dedicate it to'), 'Marcus');
        await user.click(screen.getByRole('button', { name: 'Send request' }));

        expect(createRequest).toHaveBeenCalledWith({ trackId: 't-1', name: 'Sam', dedicateTo: 'Marcus' });
        expect(searchRequestableRecords).toHaveBeenCalledWith({ q: 'holy', limit: 25 });
    });

    it('offers to play a refused record anyway, and asks again for it when pressed', async () => {
        window.history.replaceState(null, '', '/party#dp_abc');
        const refused = {
            id: 'r-1',
            status: 'declined',
            title: 'Holy Diver',
            artist: 'Dio',
            requesterName: 'Sam',
            source: 'app',
            createdAt: DateTime.utc(),
            reason: 'It has aired lately, or it does not fit this hour.',
            overrulable: true,
        };
        listMyRequests.mockResolvedValue({
            requests: [refused, { ...refused, id: 'r-0', title: 'Rainbow in the Dark', overrulable: undefined }],
        });
        insistOnRequest.mockResolvedValue({ ...refused, id: 'r-2', status: 'queued', overrulable: undefined, insisted: true });
        const user = setupUser();
        render(<PartyApp />);

        await user.click(await screen.findByRole('button', { name: 'Play “Holy Diver” anyway' }));

        expect(insistOnRequest).toHaveBeenCalledWith('r-1');
        expect(screen.queryByRole('button', { name: 'Play “Rainbow in the Dark” anyway' })).not.toBeInTheDocument();
    });
});
