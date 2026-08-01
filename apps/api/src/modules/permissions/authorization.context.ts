import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { AuthenticationSessionFactor } from '@maroonedsoftware/authentication';
import type { PlatformRoleName } from '#modules/permissions/platform.roles.js';

// Discriminated union — every actor kind has its own shape and lifecycle.
export type Actor = UserActor | SystemActor | VendorActor;

interface HumanActor {
    kind: 'user';
    sessionToken: string;
    actorId: string;
    factors: ReadonlyArray<AuthenticationSessionFactor>;
}

export interface UserActor extends HumanActor {
    kind: 'user';
    // Platform permissions precomputed from Zanzibar tuple checks at middleware time.
    // Cheap-path checks like 'platform:edit' read from this set; per-resource
    // checks go through AccessControlService.require.
    rolePermissions: ReadonlySet<string>;
    // Platform-wide staff roles held by this user (e.g. admin, listener).
    // Loaded once per request from tuples on `platform:main`. AccessControlService
    // consults this set when a normal tuple check would deny.
    platformRoles: ReadonlySet<PlatformRoleName>;
}

export interface SystemActor {
    kind: 'system';
    sessionToken: string;
    source: 'pg-boss' | 'cli' | 'startup' | 'test' | 'http';
    actorId?: string;
}

export interface VendorActor {
    kind: 'vendor';
    sessionToken: string;
    vendor: string;
    eventId: string;
}

export interface RequestEnvelope {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
}

@Injectable()
export class AuthorizationContext {
    constructor(
        public readonly actor: Actor,
        public readonly request: RequestEnvelope = {},
    ) {}

    // Narrows to a `UserActor` or throws a 403. The user may not yet have a
    // person row (first request after login, before any org has been created).
    // Use this when you need the actorId.
    requireUser(): UserActor {
        if (this.actor.kind !== 'user') {
            throw httpError(403).withDetails({ message: `user actor required (got ${this.actor.kind})` });
        }
        return this.actor;
    }

    // Returns the authentication (login) identity for any human-backed actor.
    // Use for operations scoped to the login itself — factor enrollment,
    // session minting, password change. Rejects system and vendor actors (they
    // aren't humans and shouldn't be enrolling credentials).
    requireAuthentication(): { actorId: string; sessionToken: string } {
        if (this.actor.kind === 'user') {
            return { actorId: this.actor.actorId, sessionToken: this.actor.sessionToken };
        }
        throw httpError(403).withDetails({ message: `human authentication required (got ${this.actor.kind})` });
    }

    // Cheap role-permission check (set lookup) for org-scoped UI/route gating.
    // Returns false for non-user actors. Use AccessControlService.require for
    // per-resource checks.
    has(rolePermission: string): boolean {
        return this.actor.kind === 'user' && this.actor.rolePermissions.has(rolePermission);
    }

    // Returns true if the actor is a user holding any of the listed platform
    // roles. Used to gate Deadair-internal routes (admin actor listing,
    // session/login management, etc.) that used to check `kind === 'staff'`.
    hasPlatformRole(...roles: ReadonlyArray<PlatformRoleName>): boolean {
        if (this.actor.kind !== 'user') return false;
        for (const r of roles) {
            if (this.actor.platformRoles?.has(r)) return true;
        }
        return false;
    }

    // Throws 403 unless the actor holds at least one of the listed roles.
    requirePlatformRole(...roles: ReadonlyArray<PlatformRoleName>): void {
        if (!this.hasPlatformRole(...roles)) {
            throw httpError(403).withDetails({
                message: `platform role required (one of: ${roles.join(', ')})`,
            });
        }
    }
}
