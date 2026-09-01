// What is pinned here is that both voices survive on both shapes. A request carries a sentence the
// plugin wrote and a sentence the host wrote, and an operator weighing one needs both — so the
// phone's rearrangement is allowed to move them, and not to drop either.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginGrant, PluginGrantList } from '@deadair/sdk';

import { PluginGrantsCard } from '../../../src/components/settings/plugin.grants.card';
import { stubPhoneMedia } from '../../utils/phone';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listPluginGrants = vi.fn();
const decidePluginGrant = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        plugins: {
            listPluginGrants: (...args: unknown[]) => listPluginGrants(...args),
            decidePluginGrant: (...args: unknown[]) => decidePluginGrant(...args),
        },
    },
}));

afterEach(() => {
    listPluginGrants.mockReset();
    decidePluginGrant.mockReset();
});

const GRANT: PluginGrant = {
    pluginId: 'deadair.rss',
    pluginName: 'News feeds',
    capability: 'network.open',
    label: 'Reach any address',
    describes: 'The plugin may fetch from hosts its manifest does not name.',
    reason: 'Feeds move between hosts and I follow where they go.',
    decision: 'denied',
};

const LIST: PluginGrantList = { grants: [GRANT] };

describe('PluginGrantsCard', () => {
    it('says nothing at all when nothing has asked for anything', async () => {
        listPluginGrants.mockResolvedValue({ grants: [] });
        render(<PluginGrantsCard />);

        await waitFor(() => expect(listPluginGrants).toHaveBeenCalled());
        expect(screen.queryByText('What plugins have asked for')).not.toBeInTheDocument();
    });

    it('names the plugin, both sentences and the answer', async () => {
        listPluginGrants.mockResolvedValue(LIST);
        render(<PluginGrantsCard />);

        expect(await screen.findByText('News feeds')).toBeInTheDocument();
        expect(screen.getByText('Reach any address')).toBeInTheDocument();
        expect(screen.getByText('“Feeds move between hosts and I follow where they go.”')).toBeInTheDocument();
        expect(screen.getByText('The plugin may fetch from hosts its manifest does not name.')).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Allow' })).toBeInTheDocument();
    });

    // Nothing is dropped on the way to a phone: five things go into deciding a permission and the
    // card rearranges them rather than choosing four. The control in particular has to come with,
    // because it is the only thing on this surface an operator can do.
    it('gives a phone cards, and keeps the whole request and its control', async () => {
        const restore = stubPhoneMedia();
        try {
            listPluginGrants.mockResolvedValue(LIST);
            decidePluginGrant.mockResolvedValue({ grants: [{ ...GRANT, decision: 'allowed' }] });
            const user = setupUser();

            render(<PluginGrantsCard />);

            expect(await screen.findByText('News feeds')).toBeInTheDocument();
            expect(screen.getByText('Reach any address')).toBeInTheDocument();
            expect(screen.getByText('“Feeds move between hosts and I follow where they go.”')).toBeInTheDocument();
            expect(screen.getByText('The plugin may fetch from hosts its manifest does not name.')).toBeInTheDocument();
            expect(screen.queryByRole('table')).not.toBeInTheDocument();

            await user.click(screen.getByRole('radio', { name: 'Allow' }));

            await waitFor(() => {
                expect(decidePluginGrant).toHaveBeenCalledWith('deadair.rss', { capability: 'network.open', decision: 'allowed' });
            });
        } finally {
            restore();
        }
    });

    it('says so when the requests cannot be read', async () => {
        listPluginGrants.mockRejectedValue(new Error('the registry is gone'));
        render(<PluginGrantsCard />);

        await waitFor(() => expect(screen.getByText('Requests unavailable')).toBeInTheDocument());
    });
});
