import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import type { RelationTuple } from '@maroonedsoftware/permissions';
import { ErrorCodes } from '@deadair/error-codes';
import { DeadairPermissionsTupleRepository } from './permissions.repository.js';
import { isPlatformRoleName, PLATFORM_NAMESPACE, PLATFORM_OBJECT_ID, PLATFORM_ROLE_NAMES, type PlatformRoleName } from './platform.roles.js';

/** The tuple that says `actorId` holds `role` on the station. */
export const platformRoleTuple = (actorId: string, role: PlatformRoleName): RelationTuple => ({
    object: { namespace: PLATFORM_NAMESPACE, id: PLATFORM_OBJECT_ID },
    relation: role,
    subject: { kind: 'concrete', namespace: 'user', id: actorId },
});

/**
 * The one writer of a person's platform role.
 *
 * A person holds ONE role. The tuple store would happily hold two, and the middleware would union
 * them, so the rule is kept here rather than by the schema: `assign` removes every other role tuple
 * before writing the new one. `PLATFORM_ROLE_NAMES` is ordered highest first, so `roleOf` still
 * answers sensibly for an account that predates the rule and holds more than one.
 *
 * The guards are the API's, not the console's: the console disables the controls on your own row,
 * but a request that skips the console has to meet the same refusal.
 */
@Injectable()
export class PlatformRoleService {
    constructor(private readonly tuples: DeadairPermissionsTupleRepository) {}

    /** The role `actorId` holds, or `undefined` for an account nobody granted one. */
    async roleOf(actorId: string): Promise<PlatformRoleName | undefined> {
        const held = new Set(
            (
                await this.tuples.listRelationsForSubjectOnObject(
                    { namespace: PLATFORM_NAMESPACE, id: PLATFORM_OBJECT_ID },
                    { kind: 'concrete', namespace: 'user', id: actorId },
                )
            ).filter(isPlatformRoleName),
        );
        return PLATFORM_ROLE_NAMES.find(role => held.has(role));
    }

    /**
     * Give `actorId` exactly `role`. `createdBy` is who granted it: the administrator acting, or the
     * account itself where nobody signed in performed it (onboarding, a first provider sign-in).
     */
    async assign(actorId: string, role: PlatformRoleName, createdBy: string): Promise<void> {
        const others = PLATFORM_ROLE_NAMES.filter(name => name !== role).map(name => platformRoleTuple(actorId, name));
        await this.tuples.delete(others);
        await this.tuples.write([platformRoleTuple(actorId, role)], createdBy);
    }

    /** How many people hold `role`, counting only concrete grants. */
    async countHolders(role: PlatformRoleName): Promise<number> {
        return await this.tuples.countPlatformRoleHolders(role);
    }

    /**
     * Refuse a role change the station must not make: nobody changes their own role, and the last
     * admin cannot be moved off it, since there would then be nobody able to move them back.
     */
    async assertMayReassign(callerId: string, targetId: string, role: PlatformRoleName): Promise<void> {
        if (callerId === targetId) {
            throw httpError(409).withDetails({ code: ErrorCodes.OWN_ACCOUNT_REFUSED, message: 'you cannot change your own role' });
        }
        if (role !== 'admin') await this.assertNotLastAdmin(targetId);
    }

    /** Refuse to switch off yourself or the last admin, for the reason {@link assertMayReassign} gives. */
    async assertMayDeactivate(callerId: string, targetId: string): Promise<void> {
        if (callerId === targetId) {
            throw httpError(409).withDetails({ code: ErrorCodes.OWN_ACCOUNT_REFUSED, message: 'you cannot switch off your own account' });
        }
        await this.assertNotLastAdmin(targetId);
    }

    private async assertNotLastAdmin(targetId: string): Promise<void> {
        if ((await this.roleOf(targetId)) !== 'admin') return;
        if ((await this.countHolders('admin')) <= 1) {
            throw httpError(409).withDetails({ code: ErrorCodes.LAST_ADMIN, message: 'the station must keep at least one admin' });
        }
    }
}
