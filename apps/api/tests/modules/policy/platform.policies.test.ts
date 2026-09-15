// The two route gates every contract names. A signed-in person passes on their role alone; a request
// made with an API key passes only when the key was granted the same thing, and is refused with the
// RFC 6750 challenge a client can tell apart from "nobody on this account may".

import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import type { PolicyResult } from '@maroonedsoftware/policies';

import { PlatformManagePolicy, PlatformViewPolicy, type RequirePolicyContext } from '../../../src/modules/policy/policy.mappings.js';
import type { ServerPolicyEnvelope } from '../../../src/modules/policy/policy.envelope.js';
import type { UserActor } from '../../../src/modules/permissions/authorization.context.js';

type Grant = 'view' | 'manage';

const person = (roles: ReadonlyArray<'admin' | 'listener'>): UserActor => ({
    kind: 'user',
    sessionToken: 's-1',
    actorId: 'u-1',
    factors: [],
    platformRoles: new Set(roles),
});

const key = (roles: ReadonlyArray<'admin' | 'listener'>, grants: ReadonlyArray<Grant>): UserActor => ({
    ...person(roles),
    apiKey: { id: 'k-1', name: 'doorbell', grants: new Set(grants) },
});

const evaluate = async (policy: PlatformManagePolicy | PlatformViewPolicy, actor: UserActor): Promise<PolicyResult> =>
    policy.evaluate({} as RequirePolicyContext, { actor, now: DateTime.utc() } as ServerPolicyEnvelope);

const allowed = (result: PolicyResult): boolean => (result as { allowed?: boolean }).allowed === true;
const headers = (result: PolicyResult): Record<string, string> | undefined => (result as { headers?: Record<string, string> }).headers;
const reason = (result: PolicyResult): string | undefined => (result as { reason?: string }).reason;

describe('platform.view', () => {
    const policy = new PlatformViewPolicy();

    it('lets a signed-in listener through', async () => {
        expect(allowed(await evaluate(policy, person(['listener'])))).toBe(true);
    });

    it('lets a view key through', async () => {
        expect(allowed(await evaluate(policy, key(['admin'], ['view'])))).toBe(true);
    });

    it('lets a manage key through, because manage includes view', async () => {
        expect(allowed(await evaluate(policy, key(['admin'], ['view', 'manage'])))).toBe(true);
    });

    it('refuses a key granted nothing with insufficient_scope', async () => {
        const result = await evaluate(policy, key(['admin'], []));

        expect(allowed(result)).toBe(false);
        expect(reason(result)).toBe('insufficient_scope');
        expect(headers(result)).toEqual({ 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="view"' });
    });

    it('refuses a key whose owner holds no role as the owner would be refused', async () => {
        expect(reason(await evaluate(policy, key([], ['view', 'manage'])))).toBe('platform_view_required');
    });
});

describe('platform.manage', () => {
    const policy = new PlatformManagePolicy();

    it('lets a signed-in admin through', async () => {
        expect(allowed(await evaluate(policy, person(['admin'])))).toBe(true);
    });

    it('lets an admin’s manage key through', async () => {
        expect(allowed(await evaluate(policy, key(['admin'], ['view', 'manage'])))).toBe(true);
    });

    it('refuses an admin’s view key with the challenge naming manage', async () => {
        const result = await evaluate(policy, key(['admin'], ['view']));

        expect(allowed(result)).toBe(false);
        expect(reason(result)).toBe('insufficient_scope');
        expect(headers(result)).toEqual({ 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="manage"' });
    });

    it('refuses a listener’s key as the listener is refused, not as a scope problem', async () => {
        // The key cannot exceed its owner, and the answer says so: the owner may not manage at all.
        expect(reason(await evaluate(policy, key(['listener'], ['view', 'manage'])))).toBe('platform_manage_required');
    });
});
