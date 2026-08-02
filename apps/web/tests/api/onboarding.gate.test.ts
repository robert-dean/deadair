import { describe, expect, it } from 'vitest';
import type { OnboardingRequirement } from '@deadair/sdk';

import { resolveOnboardingRedirect } from '../../src/api/onboarding.gate';

const REQUIREMENT: OnboardingRequirement = {
    key: 'admin.account',
    title: 'Administrator',
    optional: false,
};

describe('resolveOnboardingRedirect', () => {
    it('routes to /onboarding when requirements are outstanding and off the wizard', () => {
        expect(resolveOnboardingRedirect('/', [REQUIREMENT])).toBe('/onboarding');
    });

    it('stays put when requirements are outstanding and already on the wizard', () => {
        expect(resolveOnboardingRedirect('/onboarding', [REQUIREMENT])).toBeUndefined();
    });

    it('routes to / when requirements are empty and still on the wizard', () => {
        expect(resolveOnboardingRedirect('/onboarding', [])).toBe('/');
    });

    it('stays put when requirements are empty and elsewhere', () => {
        expect(resolveOnboardingRedirect('/', [])).toBeUndefined();
    });
});
