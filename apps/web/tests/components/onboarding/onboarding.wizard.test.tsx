import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';
import type { OnboardingRequirement } from '@deadair/sdk';

import { OnboardingWizard } from '../../../src/components/onboarding/onboarding.wizard';
import { queryKeys } from '../../../src/api/query.keys';
import { createTestQueryClient, render, screen, waitFor } from '../../utils/render';

const invalidate = vi.fn().mockResolvedValue(undefined);
const submitOnboardingRequirement = vi.fn();

vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({ invalidate }),
}));

vi.mock('../../../src/api/client', () => ({
    sdk: {
        onboarding: {
            submitOnboardingRequirement: (...args: unknown[]) => submitOnboardingRequirement(...args),
        },
    },
}));

async function completeAdminStep() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'longenough1');
    await user.type(screen.getByLabelText('Confirm password'), 'longenough1');
    await user.click(screen.getByRole('button', { name: 'Create administrator' }));
}

afterEach(() => {
    vi.clearAllMocks();
});

const ADMIN_ACCOUNT: OnboardingRequirement = {
    key: 'admin.account',
    title: 'Administrator',
    optional: false,
};

/**
 * A key outside the generated union, which is the whole point: the wizard has to survive an API
 * that has learned a requirement this build has never heard of. The contract type cannot express
 * that by construction, so the cast is the test, not a shortcut around it.
 */
function unknownRequirement(key: string, optional: boolean): OnboardingRequirement {
    return { key, title: 'Mystery setting', optional } as unknown as OnboardingRequirement;
}

const UNKNOWN_REQUIREMENT = unknownRequirement('some.unrecognised.key', false);

const OPTIONAL_UNKNOWN = unknownRequirement('another.unrecognised.key', true);

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

    it('leaves the cache the step already seeded alone, and invalidates the router', async () => {
        const remaining: OnboardingRequirement[] = [OPTIONAL_UNKNOWN];
        submitOnboardingRequirement.mockResolvedValue(remaining);
        const queryClient = createTestQueryClient();
        const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
        render(<OnboardingWizard requirements={[ADMIN_ACCOUNT]} />, { queryClient });

        await completeAdminStep();

        await waitFor(() => {
            expect(invalidate).toHaveBeenCalledTimes(1);
        });
        // The mutation wrote the authoritative list, so re-asking the API would be a wasted round trip.
        expect(queryClient.getQueryData(queryKeys.onboarding.requirements())).toBe(remaining);
        expect(invalidateQueries).not.toHaveBeenCalled();
    });

    it('invalidates the cached list when the step completes without reporting one', async () => {
        submitOnboardingRequirement.mockRejectedValue(new SdkError(409, 'Conflict', { statusCode: 409, message: 'Already exists' }, new Headers()));
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(queryKeys.onboarding.requirements(), [ADMIN_ACCOUNT]);
        const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
        render(<OnboardingWizard requirements={[ADMIN_ACCOUNT]} />, { queryClient });

        await completeAdminStep();

        await waitFor(() => {
            expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.onboarding.requirements() });
        });
        expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it('stays finished rather than re-rendering the step when the reloaded list comes back empty', async () => {
        submitOnboardingRequirement.mockResolvedValue([]);
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
