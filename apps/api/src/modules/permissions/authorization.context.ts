import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { AuthenticationSessionFactor } from '@maroonedsoftware/authentication';
import type { PlatformRoleName } from '#modules/permissions/platform.roles.js';
import type { ApiKeyGrant } from '#modules/authentication/api.key.scopes.js';

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
    // Platform-wide staff roles held by this user (e.g. admin, listener).
    // Loaded once per request from tuples on `platform:main`. AccessControlService
    // consults this set when a normal tuple check would deny.
    platformRoles: ReadonlySet<PlatformRoleName>;
    // Present when the request was made with one of this user's API keys rather than a session
    // they signed in for. The key acts AS its owner, which is why it is a user actor rather than a
    // kind of its own: every write it makes is attributed to the owner and every role is the
    // owner's. What it adds is a ceiling, `grants`, resolved once per request from the key's
    // object in the `apikey` namespace, which already intersects the owner's roles with the scope
    // the key was given. The platform policies, `AccessControlService` and the helpers below all
    // narrow by it, and `requireAuthentication` refuses it outright.
    apiKey?: ApiKeyActor;
}

export interface ApiKeyActor {
    id: string;
    name: string;
    grants: ReadonlySet<ApiKeyGrant>;
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
    //
    // An API key is refused here even though it acts as a user, and this one seam is what keeps a
    // key away from every credential: enrolling or removing a factor, listing or revoking sessions,
    // starting a step-up, and managing keys all begin by calling it. The case that makes it more
    // than tidiness is `POST /auth/factors/verify`, which mints a persisted session from the
    // caller's session token and would otherwise turn a key into a month-long sign-in.
    requireAuthentication(): { actorId: string; sessionToken: string } {
        if (this.actor.kind === 'user') {
            if (this.actor.apiKey) {
                throw httpError(403).withDetails({ message: 'an API key cannot manage credentials; sign in to do this' });
            }
            return { actorId: this.actor.actorId, sessionToken: this.actor.sessionToken };
        }
        throw httpError(403).withDetails({ message: `human authentication required (got ${this.actor.kind})` });
    }

    // Returns true if the actor is a user holding any of the listed platform
    // roles. Used to gate Deadair-internal routes (admin actor listing,
    // session/login management, etc.) that used to check `kind === 'staff'`.
    //
    // A role check is a check for everything that role allows, which for `admin` is everything, so a
    // key answers here only when it may manage. Stricter than it needs to be for a check naming
    // `listener` alone, and deliberately so: nothing routed asks for one today, and the next caller
    // should not be the one who finds out that a view key passes an admin check.
    hasPlatformRole(...roles: ReadonlyArray<PlatformRoleName>): boolean {
        if (this.actor.kind !== 'user') return false;
        if (this.actor.apiKey && !this.actor.apiKey.grants.has('manage')) return false;
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
