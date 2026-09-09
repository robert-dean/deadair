// The two MFA policies are mapped differently on purpose, and this is what pins each half. The
// first decides whether a sign-in stops at a challenge; the second would gate routes, and nothing
// evaluates it because every contract names its policy. Both are explained at length above the
// mapping itself.

import { describe, expect, it } from 'vitest';
import { DefaultMfaRequiredPolicy } from '@maroonedsoftware/authentication';
import { AlwaysAllowPolicy } from '@maroonedsoftware/policies';

import { DeadairMfaRequiredPolicy } from '../../../src/modules/authentication/mfa.required.policy.js';
import { ServerPolicyMappings } from '../../../src/modules/policy/policy.mappings.js';

describe('the policy mappings', () => {
    it('asks for a second factor at sign-in through the station’s rule', () => {
        // `MfaOrchestrator.issueOrChallenge` mints a challenge only when this policy DENIES, and
        // the rule denies only for an actor holding a viable second factor. Mapping AlwaysAllow
        // here is what used to make every authenticator route unreachable.
        expect(ServerPolicyMappings['auth.session.mfa.required']).toBe(DeadairMfaRequiredPolicy);
    });

    it('keeps the package rule underneath, so only the one added condition is the station’s', () => {
        // The station's policy adds exactly one thing — an email factor is not offered while there
        // is nowhere to send mail — and inherits every other judgement. Subclassing rather than
        // reimplementing is what stops the two drifting.
        expect(DeadairMfaRequiredPolicy.prototype).toBeInstanceOf(DefaultMfaRequiredPolicy);
    });

    it('leaves route gating on a second factor switched off', () => {
        // Deliberate, and the comment above the mapping says why: an omitted security block would
        // otherwise become an MFA gate, which is not a decision that has been taken.
        expect(ServerPolicyMappings['auth.session.mfa.satisfied']).toBe(AlwaysAllowPolicy);
    });
});
