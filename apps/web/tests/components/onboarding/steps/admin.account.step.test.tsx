import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';
import type { OnboardingRequirement } from '@deadair/sdk';

import { AdminAccountStep } from '../../../../src/components/onboarding/steps/admin.account.step';
import { queryKeys } from '../../../../src/api/query.keys';
import { createTestQueryClient, render, screen, waitFor } from '../../../utils/render';

const submitOnboardingRequirement = vi.fn();

vi.mock('../../../../src/api/client', () => ({
    sdk: {
        onboarding: {
            submitOnboardingRequirement: (...args: unknown[]) => submitOnboardingRequirement(...args),
        },
    },
}));

const REQUIREMENT: OnboardingRequirement = {
    key: 'admin.account',
    title: 'Administrator',
    optional: false,
};

function apiError(status: number, body: unknown): SdkError {
    return new SdkError(status, 'Error', body, new Headers());
}

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

afterEach(() => {
    submitOnboardingRequirement.mockReset();
});

describe('AdminAccountStep', () => {
    it('shows an inline error and does not submit for an invalid email', async () => {
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@localhost', 'longenough1', 'longenough1');

        expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
        expect(submitOnboardingRequirement).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('shows an inline error and does not submit for a 7-character password', async () => {
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@example.com', '1234567', '1234567');

        expect(await screen.findByText('Use at least 8 characters')).toBeInTheDocument();
        expect(submitOnboardingRequirement).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('shows an inline error and does not submit for a mismatched confirmation', async () => {
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@example.com', 'longenough1', 'different1');

        expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
        expect(submitOnboardingRequirement).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('submits admin.account with the entered credentials and hands the remaining list onward', async () => {
        const remaining: OnboardingRequirement[] = [];
        submitOnboardingRequirement.mockResolvedValue(remaining);
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@example.com', 'longenough1', 'longenough1');

        await waitFor(() => {
            expect(onComplete).toHaveBeenCalledWith(remaining);
        });
        expect(submitOnboardingRequirement).toHaveBeenCalledWith({
            key: 'admin.account',
            value: { email: 'admin@example.com', password: 'longenough1' },
        });
    });

    it('writes the returned list into the query cache so the gates need no second GET', async () => {
        const remaining: OnboardingRequirement[] = [];
        submitOnboardingRequirement.mockResolvedValue(remaining);
        const queryClient = createTestQueryClient();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={vi.fn()} />, { queryClient });

        await fillAndSubmit('admin@example.com', 'longenough1', 'longenough1');

        await waitFor(() => {
            expect(queryClient.getQueryData(queryKeys.onboarding.requirements())).toBe(remaining);
        });
    });

    it('puts server-side validation messages on the matching fields for an SdkError with details', async () => {
        submitOnboardingRequirement.mockRejectedValue(apiError(422, { statusCode: 422, message: 'Invalid', details: { email: 'Already taken' } }));
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@example.com', 'longenough1', 'longenough1');

        expect(await screen.findByText('Already taken')).toBeInTheDocument();
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('calls onComplete without a list when the account already exists (409)', async () => {
        submitOnboardingRequirement.mockRejectedValue(apiError(409, { statusCode: 409, message: 'Already exists' }));
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@example.com', 'longenough1', 'longenough1');

        await waitFor(() => {
            expect(onComplete).toHaveBeenCalledWith();
        });
        // Moving on is the whole response to a 409; reporting it as a failure too would be noise.
        expect(screen.queryByText('Already exists')).not.toBeInTheDocument();
    });

    it('renders the alert message and does not call onComplete for another status', async () => {
        submitOnboardingRequirement.mockRejectedValue(apiError(500, { statusCode: 500, message: 'Server exploded' }));
        const onComplete = vi.fn();
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={onComplete} />);

        await fillAndSubmit('admin@example.com', 'longenough1', 'longenough1');

        expect(await screen.findByText('Server exploded')).toBeInTheDocument();
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('tells the user how long to wait when the API rate limits the submission', async () => {
        submitOnboardingRequirement.mockRejectedValue(
            new SdkError(429, 'Too Many Requests', { statusCode: 429, message: 'Rate limited' }, new Headers({ 'retry-after': '4.2' })),
        );
        render(<AdminAccountStep requirement={REQUIREMENT} onComplete={vi.fn()} />);

        await fillAndSubmit('admin@example.com', 'longenough1', 'longenough1');

        expect(await screen.findByText('Too many attempts. Try again in 5 seconds.')).toBeInTheDocument();
    });
});
