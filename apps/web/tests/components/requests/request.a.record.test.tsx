// Asking for a record from the desk. What it has to get right is that it is a REQUEST: the body is
// the one a listener would send, a record from a provider is asked for by its source, and a refusal
// (a 201 like any other answer) stays on screen with the station's reason instead of closing.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListenerRequest, ListenerRequestCreate, RequestableTrack } from '@deadair/sdk';

import { RequestARecord } from '../../../src/components/requests/request.a.record';
import { render, screen, setupUser } from '../../utils/render';

const sent: ListenerRequestCreate[] = [];
let answer: Partial<ListenerRequest> = { status: 'pending' };
const tracks: RequestableTrack[] = [
    { trackId: '11111111-1111-4111-8111-111111111111', title: 'Gimme Shelter', artist: 'The Rolling Stones', album: 'Let It Bleed' },
    { source: { pluginId: 'deezer', externalId: 'dz-9' }, sourceName: 'Deezer', title: 'Paint It Black', artist: 'The Rolling Stones' },
];

vi.mock('../../../src/api/client', () => ({
    sdk: {
        requests: {
            searchRequestableRecords: () => Promise.resolve({ tracks }),
            createRequest: (body: ListenerRequestCreate) => {
                sent.push(body);
                return Promise.resolve({ id: 'r1', title: 'Gimme Shelter', artist: 'The Rolling Stones', ...answer });
            },
            listRequests: () => Promise.resolve({ requests: [] }),
        },
    },
}));

const choose = async (title: string) => {
    render(<RequestARecord />);
    const user = setupUser();
    await user.click(screen.getByRole('button', { name: 'Request a record' }));
    await user.type(screen.getByLabelText('Search for a record'), 'stones');
    await user.click(await screen.findByRole('button', { name: `Request ${title} by The Rolling Stones` }));
    return user;
};

describe('RequestARecord', () => {
    beforeEach(() => {
        sent.length = 0;
        answer = { status: 'pending' };
    });

    it('asks for a record the station holds by its track, with what the operator typed', async () => {
        const user = await choose('Gimme Shelter');
        await user.type(screen.getByLabelText('Who is asking'), 'Sam');
        await user.type(screen.getByLabelText('Dedicate it to'), 'Alex');
        await user.click(screen.getByRole('button', { name: 'Send the request' }));

        expect(sent).toEqual([{ trackId: tracks[0]!.trackId, name: 'Sam', dedicateTo: 'Alex' }]);
    });

    it('asks for a provider’s record by its source, and leaves blank fields out', async () => {
        const user = await choose('Paint It Black');
        await user.click(screen.getByRole('button', { name: 'Send the request' }));

        expect(sent).toEqual([{ source: { pluginId: 'deezer', externalId: 'dz-9' } }]);
    });

    it('keeps a refusal on screen with the station’s reason, and will not send it again', async () => {
        answer = { status: 'declined', reason: 'It aired an hour ago.' };
        const user = await choose('Gimme Shelter');
        await user.click(screen.getByRole('button', { name: 'Send the request' }));

        expect(await screen.findByText('It aired an hour ago.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send the request' })).toBeDisabled();
    });

    it('opens itself when the address asked for it, and says so once so the ask can leave the address', async () => {
        const arrived = vi.fn();
        render(<RequestARecord openOnArrival onArrived={arrived} />);

        expect(await screen.findByLabelText('Search for a record')).toBeInTheDocument();
        expect(arrived).toHaveBeenCalledTimes(1);
    });

    it('stays shut without the ask', () => {
        render(<RequestARecord />);
        expect(screen.queryByLabelText('Search for a record')).not.toBeInTheDocument();
    });
});
