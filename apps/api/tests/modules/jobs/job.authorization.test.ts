// `overrideJobActor` is what tells the permission model who a job is. It changes
// no authorization outcome — `AccessControlService` already trusts every
// non-`http` system source — so the point of these tests is to pin the two
// things the rest of the job code leans on: that the actor is labelled
// `pg-boss` and correlated to the job id, and that it really does clear
// `AccessControlService`. A job that quietly stopped being trusted would
// otherwise surface as a 403 from somewhere deep inside a background walk.

import { describe, expect, it, vi } from 'vitest';
import type { JobContext } from '@maroonedsoftware/jobbroker';
import type { ScopedContainer } from 'injectkit';

import { overrideJobActor } from '../../../src/modules/jobs/job.authorization.js';
import { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import { isAllVisible } from '../../../src/modules/permissions/access.control.service.js';
import type { PermissionsService } from '../../../src/modules/permissions/permissions.service.js';

const jobContext = (overrides: Partial<JobContext> = {}): JobContext => ({
    id: 'job-1',
    name: 'catalog.sync',
    signal: new AbortController().signal,
    ...overrides,
});

/**
 * Records what was overridden, which is the whole observable effect of the
 * helper. Only `override` is exercised, so the rest of `ScopedContainer` is
 * deliberately absent rather than stubbed into existence.
 */
function fakeScope(): { scope: ScopedContainer; installed: () => AuthorizationContext } {
    const overrides = new Map<unknown, unknown>();
    const scope = { override: vi.fn((token: unknown, value: unknown) => overrides.set(token, value)) } as unknown as ScopedContainer;
    return { scope, installed: () => overrides.get(AuthorizationContext) as AuthorizationContext };
}

/**
 * A `PermissionsService` that denies everything. A trusted system actor never
 * reaches it, so any call is itself the failure: it would mean the job fell
 * through to the tuple walk.
 */
const denyingPermissions = (): PermissionsService =>
    ({
        checkSubject: vi.fn(async () => false),
        listObjects: vi.fn(async () => ({ ids: [], truncated: false })),
    }) as unknown as PermissionsService;

describe('overrideJobActor', () => {
    it('installs a pg-boss system actor correlated to the job id', () => {
        const { scope, installed } = fakeScope();

        overrideJobActor(scope, jobContext({ id: 'job-42' }));

        const context = installed();
        expect(context.actor).toEqual({ kind: 'system', sessionToken: '', source: 'pg-boss' });
        expect(context.request).toEqual({ requestId: 'job-42' });
    });

    it('overrides AuthorizationContext rather than any other token', () => {
        const { scope } = fakeScope();

        overrideJobActor(scope, jobContext());

        expect(scope.override).toHaveBeenCalledTimes(1);
        expect(scope.override).toHaveBeenCalledWith(AuthorizationContext, expect.any(AuthorizationContext));
    });

    it('produces an actor AccessControlService trusts, without consulting tuples', async () => {
        const { scope, installed } = fakeScope();
        overrideJobActor(scope, jobContext());
        const permissions = denyingPermissions();
        const access = new AccessControlService(installed(), permissions);

        await expect(access.require({ namespace: 'plugin', id: 'deadair.spotify' }, 'view')).resolves.toBeUndefined();
        await expect(access.canAccess({ namespace: 'plugin', id: 'deadair.spotify' }, 'view')).resolves.toBe(true);
        expect(permissions.checkSubject).not.toHaveBeenCalled();
    });

    it('sees every object in a namespace, so a job list is unfiltered', async () => {
        const { scope, installed } = fakeScope();
        overrideJobActor(scope, jobContext());
        const permissions = denyingPermissions();
        const access = new AccessControlService(installed(), permissions);

        const visible = await access.listVisibleIds('plugin', 'view');

        expect(isAllVisible(visible)).toBe(true);
        expect(permissions.listObjects).not.toHaveBeenCalled();
    });
});
