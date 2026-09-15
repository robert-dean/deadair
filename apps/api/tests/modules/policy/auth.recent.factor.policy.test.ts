// The step-up rule every sensitive credential change sits behind: a factor of the right sort,
// verified recently. A request made with an API key carries an `apikey` factor of kind
// `possession` authenticated the moment the request arrived, which read naively is the freshest
// strong factor there could be. These pin that it never counts.

import { describe, expect, it } from 'vitest';
import { DateTime, Duration } from 'luxon';
import type { AuthenticationSessionFactor } from '@maroonedsoftware/authentication';
import type { PolicyResult } from '@maroonedsoftware/policies';

import { AuthRecentFactorPolicy, type AuthRecentFactorPolicyContext } from '../../../src/modules/policy/policies/auth.recent.factor.policy.js';
import type { ServerPolicyEnvelope } from '../../../src/modules/policy/policy.envelope.js';
import type { UserActor } from '../../../src/modules/permissions/authorization.context.js';

const NOW = DateTime.fromISO('2026-09-14T12:00:00Z');

/** The context `assertRecentStrongFactorIfAnyEnrolled` passes: five minutes, no bootstrap factors. */
const STRONG: AuthRecentFactorPolicyContext = { within: Duration.fromObject({ minutes: 5 }), excludeMethods: ['email', 'password', 'oidc'] };

const factor = (method: string, kind: string): AuthenticationSessionFactor =>
    ({ method, methodId: `${method}-1`, kind, issuedAt: NOW, authenticatedAt: NOW }) as unknown as AuthenticationSessionFactor;

const actor = (factors: AuthenticationSessionFactor[], apiKey = false): UserActor => ({
    kind: 'user',
    sessionToken: 's-1',
    actorId: 'u-1',
    factors,
    platformRoles: new Set(['admin']),
    ...(apiKey ? { apiKey: { id: 'k-1', name: 'doorbell', grants: new Set(['view', 'manage'] as const) } } : {}),
});

const evaluate = (subject: UserActor): Promise<PolicyResult> =>
    new AuthRecentFactorPolicy().evaluate(STRONG, { actor: subject, now: NOW } as ServerPolicyEnvelope);

const outcome = (result: PolicyResult) => result as { allowed: boolean; details?: { kind?: string } };

describe('AuthRecentFactorPolicy', () => {
    it('accepts a person who has just verified an authenticator', async () => {
        expect(outcome(await evaluate(actor([factor('password', 'knowledge'), factor('authenticator', 'possession')]))).allowed).toBe(true);
    });

    it('refuses a request made with an API key as unavailable, so no re-verify dialog opens for a machine', async () => {
        const result = outcome(await evaluate(actor([factor('apikey', 'possession')], true)));

        expect(result.allowed).toBe(false);
        expect(result.details?.kind).toBe('step_up_unavailable');
    });

    it('never counts an apikey factor as a recent strong one, even on an actor without the key field', async () => {
        const result = outcome(await evaluate(actor([factor('apikey', 'possession')])));

        expect(result.allowed).toBe(false);
        expect(result.details?.kind).not.toBe('step_up_unavailable');
    });
});
