import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';
import type { OnboardingRequirement } from '@deadair/sdk';

import { AdminAccountStep } from '../../../../src/components/onboarding/steps/admin.account.step';
import { submitRequirement } from '../../../../src/api/onboarding';
import { render, screen, waitFor } from '../../../utils/render';

vi.mock('../../../../src/api/onboarding');

const submitRequirementMock = vi.mocked(submitRequirement);

const REQUIREMENT: OnboardingRequirement = {
    key: 'admin.account',
    title: 'Administrator',
    optional: false,
};

async function fillAndSubmit(email: string, password: string, confirmPassword: string) {
    const user = userEvent.setup();
    if (email) {
        await user.type(screen.getByLabelText('Email'), email);
    }
    if (password) {
        await user.type(screen.getByLabelText('Password'), password);
    }
    if (confirmPassword) {
        await user.type(screen.getByLabelText('Confirm password'), confirmPassword);
    }
    await user.click(screen.getByRole('button', { name: 'Create administrator' }));
}

describe('AdminAccountStep', () => {
    it('shows an inline error and does not submit for an invalid email', async () => {
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@localhost', 'longenough1', 'longenough1');

        expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
        expect(submitRequirementMock).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('shows an inline error and does not submit for a 7-character password', async () => {
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@example.com', '1234567', '1234567');

        expect(await screen.findByText('Use at least 8 characters')).toBeInTheDocument();
        expect(submitRequirementMock).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('shows an inline error and does not submit for a mismatched confirmation', async () => {
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@example.com', 'longenough1', 'different1');

        expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
        expect(submitRequirementMock).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('submits admin.account with the entered credentials and hands the remaining list onward', async () => {
        const remaining: OnboardingRequirement[] = [];
        submitRequirementMock.mockResolvedValue(remaining);
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@example.com', 'longenough1', 'longenough1');

        await waitFor(() => {
            expect(onComplete).toHaveBeenCalledWith(remaining);
        });
        expect(submitRequirementMock).toHaveBeenCalledWith('admin.account', {
            email: 'admin@example.com',
            password: 'longenough1',
        });
    });

    it('puts server-side validation messages on the matching fields for an SdkError with details', async () => {
        submitRequirementMock.mockRejectedValue(
            new SdkError(422, 'Unprocessable Entity', { statusCode: 422, message: 'Invalid', details: { email: 'Already taken' } }, new Headers()),
        );
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@example.com', 'longenough1', 'longenough1');

        expect(await screen.findByText('Already taken')).toBeInTheDocument();
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('calls onComplete without a list when the account already exists (409)', async () => {
        submitRequirementMock.mockRejectedValue(new SdkError(409, 'Conflict', { statusCode: 409, message: 'Already exists' }, new Headers()));
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@example.com', 'longenough1', 'longenough1');

        await waitFor(() => {
            expect(onComplete).toHaveBeenCalledWith();
        });
    });

    it('renders the alert message and does not call onComplete for another status', async () => {
        submitRequirementMock.mockRejectedValue(new SdkError(500, 'Internal Server Error', { statusCode: 500, message: 'Server exploded' }, new Headers()));
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@example.com', 'longenough1', 'longenough1');

        expect(await screen.findByText('Server exploded')).toBeInTheDocument();
        expect(onComplete).not.toHaveBeenCalled();
    });
});
