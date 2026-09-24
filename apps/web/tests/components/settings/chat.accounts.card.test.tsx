// Linking a chat account so it can run operator commands. The card is an operator's: somebody without
// the role sees nothing. The code is shown once, with the exact message to send, and an unlink asks
// first.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError } from '@deadair/sdk';

import { ChatAccountsCard } from '../../../src/components/settings/chat.accounts.card';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listMessagingLinks = vi.fn();
const createMessagingLinkCode = vi.fn();
const removeMessagingLink = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        messaging: {
            listMessagingLinks: (...args: unknown[]) => listMessagingLinks(...args),
            createMessagingLinkCode: (...args: unknown[]) => createMessagingLinkCode(...args),
            removeMessagingLink: (...args: unknown[]) => removeMessagingLink(...args),
        },
    },
}));

afterEach(() => {
    listMessagingLinks.mockReset();
    createMessagingLinkCode.mockReset();
    removeMessagingLink.mockReset();
});

const LINK = { pluginId: 'deadair.telegram', platformUserId: '7', displayName: 'Robin', createdAt: DateTime.fromISO('2026-09-20T10:00:00Z') };

describe('ChatAccountsCard', () => {
    it('draws nothing for somebody who is not an operator', async () => {
        listMessagingLinks.mockRejectedValue(new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Forbidden' }, new Headers()));
        render(<ChatAccountsCard />);

        await waitFor(() => expect(listMessagingLinks).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByText('Chat accounts')).not.toBeInTheDocument());
    });

    it('lists a linked account by its name and platform', async () => {
        listMessagingLinks.mockResolvedValue({ links: [LINK] });
        render(<ChatAccountsCard />);

        expect(await screen.findByText('Robin on Telegram')).toBeInTheDocument();
    });

    it('shows a new code as the message to send', async () => {
        listMessagingLinks.mockResolvedValue({ links: [] });
        createMessagingLinkCode.mockResolvedValue({ code: 'ABCD2345', expiresAt: DateTime.fromISO('2026-09-24T12:10:00Z') });
        render(<ChatAccountsCard />);
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Link a chat account' }));

        expect(await screen.findByText('/link ABCD2345')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'New code' })).toBeInTheDocument();
    });

    it('unlinks an account after asking', async () => {
        listMessagingLinks.mockResolvedValue({ links: [LINK] });
        removeMessagingLink.mockResolvedValue(undefined);
        render(<ChatAccountsCard />);
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Unlink' }));
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Unlink' })).toHaveLength(2));
        await user.click(screen.getAllByRole('button', { name: 'Unlink' }).at(-1)!);

        await waitFor(() => expect(removeMessagingLink).toHaveBeenCalledWith('deadair.telegram', '7'));
    });
});
