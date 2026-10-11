import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from 'injectkit';
import { Duration, DateTime } from 'luxon';
import { httpError } from '@maroonedsoftware/errors';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { AuthenticationSessionService } from '@maroonedsoftware/authentication';
import { ActorsRepository } from '#modules/authentication/repositories/actors.repository.js';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { PartyJoinLimiter } from './party.join.limiter.js';
import { PartyPassRepository, type PartyPassRow } from './party.passes.repository.js';
import type { PartyGuestSession, PartyJoin, PartyPass, PartyStart, PartyState } from './types/requests.types.js';

/** How long a pass lasts when the operator does not say. */
export const DEFAULT_PARTY_HOURS = 6;

/** How many guests one pass admits. A party, not a stadium: past this the pass is somebody's group chat. */
export const MAX_PARTY_GUESTS = 300;

/** What starts every pass, so one pasted somewhere it should not be is recognisable for what it is. */
const TOKEN_PREFIX = 'dp_';

/** The token's SHA-256, which is how a join finds its pass without the token being stored in the clear. */
export const hashPartyToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * A party: the pass an operator starts, and the guests who join with it.
 *
 * Starting one mints a token the console shows as a QR code pointing at the station's `/party` page.
 * Joining with it makes a GUEST actor and a session for it that lasts exactly as long as the pass, and
 * that session reaches the `requests.ask` routes and nothing else (see `GuestActor` and
 * `tests/routes/guest.reach.test.ts`). One actor per guest is what makes the request arbiter's one at a
 * time hold for each guest, since it counts by requester key.
 *
 * Ending a party stops the pass, switches its guests off and revokes their sessions, so they are turned
 * away at once rather than on their next request. A pass that simply runs out needs none of that: the
 * middleware refuses a guest whose pass is not live, and the guest's session expires on the same
 * instant the pass does. There is only ever one party: starting one ends the last.
 */
@Injectable()
export class PartyService {
    constructor(
        private readonly authz: AuthorizationContext,
        private readonly passes: PartyPassRepository,
        private readonly actors: ActorsRepository,
        private readonly sessions: AuthenticationSessionService,
        private readonly encryption: EncryptionProvider,
        private readonly limiter: PartyJoinLimiter,
    ) {}

    async get(): Promise<PartyState> {
        const live = await this.passes.live();
        return live === undefined ? {} : { party: await this.toPass(live) };
    }

    async start(body: PartyStart): Promise<PartyPass> {
        const { actorId } = this.authz.requireUser();
        await this.endParty();

        const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
        const row = await this.passes.create({
            createdBy: actorId,
            tokenHash: hashPartyToken(token),
            tokenSealed: this.encryption.encrypt(token),
            expiresAt: DateTime.utc().plus({ hours: body.hours ?? DEFAULT_PARTY_HOURS }),
        });
        return { token, createdAt: row.createdAt, expiresAt: row.expiresAt, guests: 0 };
    }

    async end(): Promise<void> {
        this.authz.requireUser();
        await this.endParty();
    }

    /**
     * A guest's way in. Every refusal of the pass itself is the same 404, so a caller trying tokens
     * learns nothing about which ones were ever real.
     */
    async join(body: PartyJoin): Promise<PartyGuestSession> {
        await this.limiter.consume(this.authz.request.clientAddress ?? this.authz.request.ipAddress ?? 'unknown');

        const pass = await this.passes.liveByHash(hashPartyToken(body.token.trim()));
        if (pass === undefined) throw httpError(404).withDetails({ message: 'This party has ended, or the code is not one of the station’s.' });
        if ((await this.passes.guestCount(pass.id)) >= MAX_PARTY_GUESTS) {
            throw httpError(409).withDetails({ message: 'This party is full.' });
        }

        const actor = await this.actors.create('guest');
        await this.passes.addGuest(pass.id, actor.id);

        // The pass is a bearer secret the guest possesses, which is what the library's `apikey` method
        // already means: it never counts as a second factor or a recent one (`auth.recent.factor`
        // excludes it), so a guest's session can never pass a step-up. The method list is closed, and
        // a guest is told apart by its `actorType` claim, never by this.
        const lifetime = pass.expiresAt.diffNow();
        const session = await this.sessions.createSession(
            actor.id,
            { actorType: 'guest', partyPassId: pass.id },
            { method: 'apikey', methodId: pass.id, kind: 'possession', issuedAt: DateTime.utc(), authenticatedAt: DateTime.utc() },
            lifetime.as('milliseconds') > 0 ? lifetime : Duration.fromMillis(1),
        );
        const token = await this.sessions.issueTokenForSession(session.sessionToken);
        return { accessToken: token.accessToken, expiresAt: pass.expiresAt };
    }

    /** End whatever party is on, and send its guests home: switched off, every session revoked. */
    private async endParty(): Promise<void> {
        const guests = await this.passes.endAll();
        for (const guest of guests) {
            await this.actors.update(guest, false);
            await this.sessions.revokeAllForSubject(guest, 'logout').catch(() => 0);
        }
    }

    private async toPass(row: PartyPassRow): Promise<PartyPass> {
        return {
            token: this.encryption.decrypt(row.tokenSealed),
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            guests: await this.passes.guestCount(row.id),
        };
    }
}
