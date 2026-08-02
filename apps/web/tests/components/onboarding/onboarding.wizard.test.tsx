import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';
import type { OnboardingRequirement } from '@deadair/sdk';

import { OnboardingWizard } from '../../../src/components/onboarding/onboarding.wizard';
import { invalidateOnboardingRequirements, setOnboardingRequirements, submitRequirement } from '../../../src/api/onboarding';
import { render, screen, waitFor } from '../../utils/render';

const invalidate = vi.fn().mockResolvedValue(undefined);

vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({ invalidate }),
}));

vi.mock('../../../src/api/onboarding');

const submitRequirementMock = vi.mocked(submitRequirement);
const setOnboardingRequirementsMock = vi.mocked(setOnboardingRequirements);
const invalidateOnboardingRequirementsMock = vi.mocked(invalidateOnboardingRequirements);

async function completeAdminStep() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'longenough1');
    await user.type(screen.getByLabelText('Confirm password'), 'longenough1');
    await user.click(screen.getByRole('button', { name: 'Create administrator' }));
}

afterEach(() => {
    // Call history only: the mocked module's implementations are set per test.
    vi.clearAllMocks();
});

const ADMIN_ACCOUNT: OnboardingRequirement = {
    key: 'admin.account',
    title: 'Administrator',
    optional: false,
};

const UNKNOWN_REQUIREMENT: OnboardingRequirement = {
    key: 'some.unrecognised.key',
    title: 'Mystery setting',
    optional: false,
};

const OPTIONAL_UNKNOWN: OnboardingRequirement = {
    key: 'another.unrecognised.key',
    title: 'Optional mystery setting',
    optional: true,
};

describe('OnboardingWizard', () => {
    it('renders the admin.account step for that requirement', () => {
        render(<OnboardingWizard requirements={[ADMIN_ACCOUNT]} />);

        expect(screen.getByRole('button', { name: 'Create administrator' })).toBeInTheDocument();
    });

    it('renders the neutral unsupported panel for an unrecognised key rather than throwing', () => {
        expect(() => render(<OnboardingWizard requirements={[UNKNOWN_REQUIREMENT]} />)).not.toThrow();

        expect(screen.getByText('Not supported in this build')).toBeInTheDocument();
        expect(screen.getByText('some.unrecognised.key')).toBeInTheDocument();
    });

    it('offers Skip for an optional requirement', () => {
        render(<OnboardingWizard requirements={[OPTIONAL_UNKNOWN]} />);

        expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    });

    it('does not offer Skip for a required requirement', () => {
        render(<OnboardingWizard requirements={[UNKNOWN_REQUIREMENT]} />);

        expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    });

    it('seeds the cache from the list a completed step returns, then invalidates the router', async () => {
        const remaining: OnboardingRequirement[] = [OPTIONAL_UNKNOWN];
        submitRequirementMock.mockResolvedValue(remaining);
        render(<OnboardingWizard requirements={[ADMIN_ACCOUNT]} />);

        await completeAdminStep();

        await waitFor(() => {
            expect(setOnboardingRequirementsMock).toHaveBeenCalledWith(remaining);
        });
        expect(invalidateOnboardingRequirementsMock).not.toHaveBeenCalled();
        expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it('invalidates the cache instead of seeding it when the step completes without a list', async () => {
        submitRequirementMock.mockRejectedValue(new SdkError(409, 'Conflict', { statusCode: 409, message: 'Already exists' }, new Headers()));
        render(<OnboardingWizard requirements={[ADMIN_ACCOUNT]} />);

        await completeAdminStep();

        await waitFor(() => {
            expect(invalidateOnboardingRequirementsMock).toHaveBeenCalledTimes(1);
        });
        expect(setOnboardingRequirementsMock).not.toHaveBeenCalled();
        expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it('stays finished rather than re-rendering the step when the reloaded list comes back empty', async () => {
        submitRequirementMock.mockResolvedValue([]);
        const { rerender } = render(<OnboardingWizard requirements={[ADMIN_ACCOUNT]} />);

        await completeAdminStep();
        await waitFor(() => {
            expect(invalidate).toHaveBeenCalledTimes(1);
        });

        // What the router hands back once the seeded, now-empty list is re-read.
        rerender(<OnboardingWizard requirements={[]} />);

        expect(screen.getByText('Nothing left to configure.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create administrator' })).not.toBeInTheDocument();
    });
});
