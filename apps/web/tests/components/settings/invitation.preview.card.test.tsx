// The invitation as the station would email it, under the Mail form. The properties that matter:
// saved wording the station cannot use is said out loud rather than discovered from the log; the
// role switch asks for the other invitation; nothing is asked before the mail fields are showing;
// and somebody without the operator role sees nothing rather than an error.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { InvitationPreviewCard } from '../../../src/components/settings/invitation.preview.card';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const getSettings = vi.fn();
const previewInvitation = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        settings: {
            getSettings: (...args: unknown[]) => getSettings(...args),
            previewInvitation: (...args: unknown[]) => previewInvitation(...args),
        },
    },
}));

afterEach(() => {
    getSettings.mockReset();
    previewInvitation.mockReset();
});

const withMail = (values: Record<string, string>) => ({ descriptors: [], values, configured: {}, derived: {} });
const PREVIEW = {
    subject: 'You are invited to Night Owl',
    html: '<!DOCTYPE html><html><body><p>Hello</p></body></html>',
    text: 'Hello\n\nMake your account (https://your-station.example/invite#sample)',
    ownWording: false,
};

describe('InvitationPreviewCard', () => {
    it('shows the subject, the email in a sandboxed frame, and its plain text', async () => {
        getSettings.mockResolvedValue(withMail({ 'mail.host': 'smtp.example.com' }));
        previewInvitation.mockResolvedValue(PREVIEW);
        const user = setupUser();

        render(<InvitationPreviewCard />);

        expect(await screen.findByText('You are invited to Night Owl')).toBeInTheDocument();
        expect(screen.getByText("The station's own wording")).toBeInTheDocument();
        const frame = screen.getByTitle('Invitation email preview');
        expect(frame).toHaveAttribute('sandbox', '');
        expect(frame).toHaveAttribute('srcdoc', PREVIEW.html);
        expect(previewInvitation).toHaveBeenCalledWith({ role: 'listener' });

        await user.click(screen.getByRole('tab', { name: 'Plain text' }));
        expect(await screen.findByText(/Make your account \(https:\/\/your-station\.example/)).toBeVisible();
    });

    it('says why saved wording is not being used', async () => {
        getSettings.mockResolvedValue(withMail({ 'mail.host': 'smtp.example.com', 'mail.invitation.body': 'No link.' }));
        previewInvitation.mockResolvedValue({ ...PREVIEW, problem: 'it has to include {{link}}' });

        render(<InvitationPreviewCard />);

        expect(await screen.findByText('Your saved wording is not being used')).toBeInTheDocument();
        expect(screen.getByText('it has to include {{link}}')).toBeInTheDocument();
    });

    it('asks for the admin invitation when the switch is moved', async () => {
        getSettings.mockResolvedValue(withMail({ 'mail.host': 'smtp.example.com' }));
        previewInvitation.mockResolvedValue(PREVIEW);
        const user = setupUser();

        render(<InvitationPreviewCard />);
        await screen.findByText('You are invited to Night Owl');
        await user.click(screen.getByText('Admin'));

        await waitFor(() => expect(previewInvitation).toHaveBeenCalledWith({ role: 'admin' }));
    });

    it('asks nothing while there is no mail server, since the wording fields are not showing', async () => {
        getSettings.mockResolvedValue(withMail({}));

        render(<InvitationPreviewCard />);

        await waitFor(() => expect(getSettings).toHaveBeenCalled());
        expect(previewInvitation).not.toHaveBeenCalled();
        expect(screen.queryByText('What an invitation looks like')).not.toBeInTheDocument();
    });

    it('draws nothing for somebody without the operator role', async () => {
        getSettings.mockResolvedValue(withMail({ 'mail.host': 'smtp.example.com' }));
        previewInvitation.mockRejectedValue(new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Forbidden' }, new Headers()));

        render(<InvitationPreviewCard />);

        await waitFor(() => expect(previewInvitation).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByText('What an invitation looks like')).not.toBeInTheDocument());
    });
});
