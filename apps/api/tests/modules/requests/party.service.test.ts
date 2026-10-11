// A party: starting one, ending one, and a guest joining with its pass. What matters is that the pass
// is never stored in the clear, that a guest's session lives exactly as long as the pass, that ending
// a party sends every guest home at once, and that a refused pass says nothing about why.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import { MAX_PARTY_GUESTS, PartyService, hashPartyToken } from '../../../src/modules/requests/party.service.js';
import type { PartyPassRow } from '../../../src/modules/requests/party.passes.repository.js';

const operator = new AuthorizationContext(
    { kind: 'user', sessionToken: 's', actorId: 'op-1', platformRoles: new Set(['admin']), factors: [] },
    { clientAddress: '198.51.100.7' },
);

/** Sealing that is visibly not the clear text, and reversible. */
const encryption = { encrypt: (plain: string) => `sealed(${plain})`, decrypt: (sealed: string) => sealed.slice(7, -1) };

interface World {
    live?: PartyPassRow;
    guests?: number;
    endedGuests?: string[];
}

function build(world: World = {}, authz: AuthorizationContext = operator) {
    const passes = {
        live: vi.fn(async () => world.live),
        liveByHash: vi.fn(async (hash: string) =>
            world.live && hash === hashPartyToken(encryption.decrypt(world.live.tokenSealed)) ? world.live : undefined,
        ),
        create: vi.fn(async (pass: { tokenSealed: string; expiresAt: DateTime }) => ({
            id: 'pass-2',
            tokenSealed: pass.tokenSealed,
            createdAt: DateTime.utc(),
            expiresAt: pass.expiresAt,
        })),
        endAll: vi.fn(async () => world.endedGuests ?? []),
        addGuest: vi.fn(async () => undefined),
        guestCount: vi.fn(async () => world.guests ?? 0),
    };
    const actors = { create: vi.fn(async () => ({ id: 'guest-1' })), update: vi.fn(async () => undefined) };
    const sessions = {
        createSession: vi.fn(async () => ({ sessionToken: 'guest-session' })),
        issueTokenForSession: vi.fn(async () => ({ accessToken: 'jwt', refreshToken: 'never-sent', expiresIn: 1, tokenType: 'Bearer' })),
        revokeAllForSubject: vi.fn(async () => 1),
    };
    const limiter = { consume: vi.fn(async () => undefined) };
    const service = new PartyService(authz, passes as never, actors as never, sessions as never, encryption as never, limiter as never);
    return { service, passes, actors, sessions, limiter };
}

const livePass = (token = 'dp_abc', hoursLeft = 3): PartyPassRow => ({
    id: 'pass-1',
    tokenSealed: encryption.encrypt(token),
    createdAt: DateTime.utc().minus({ hours: 1 }),
    expiresAt: DateTime.utc().plus({ hours: hoursLeft }),
});

describe('starting a party', () => {
    it('mints a pass, stores only its hash and a sealed copy, and lasts six hours unless told', async () => {
        const { service, passes } = build();

        const pass = await service.start({});

        expect(pass.token).toMatch(/^dp_[A-Za-z0-9_-]{43}$/);
        const stored = passes.create.mock.calls[0]![0] as { tokenHash: string; tokenSealed: string; createdBy: string; expiresAt: DateTime };
        expect(stored.tokenHash).toBe(hashPartyToken(pass.token));
        expect(stored.tokenSealed).toBe(`sealed(${pass.token})`);
        expect(stored.createdBy).toBe('op-1');
        expect(Math.round(stored.expiresAt.diffNow().as('hours'))).toBe(6);
    });

    it('lasts as long as the operator says', async () => {
        const { service, passes } = build();

        await service.start({ hours: 2 });

        expect(Math.round((passes.create.mock.calls[0]![0] as { expiresAt: DateTime }).expiresAt.diffNow().as('hours'))).toBe(2);
    });

    it('ends the party that was on first, sending its guests home', async () => {
        const { service, passes, actors, sessions } = build({ endedGuests: ['g-1', 'g-2'] });

        await service.start({});

        expect(passes.endAll).toHaveBeenCalledBefore(passes.create);
        expect(actors.update).toHaveBeenCalledWith('g-1', false);
        expect(actors.update).toHaveBeenCalledWith('g-2', false);
        expect(sessions.revokeAllForSubject).toHaveBeenCalledWith('g-1', 'logout');
    });
});

describe('the party that is on', () => {
    it('shows its pass again, unsealed, with how many have joined', async () => {
        const { service } = build({ live: livePass('dp_xyz'), guests: 4 });

        const state = await service.get();

        expect(state.party?.token).toBe('dp_xyz');
        expect(state.party?.guests).toBe(4);
    });

    it('is nothing when no party is on', async () => {
        await expect(build().service.get()).resolves.toEqual({});
    });
});

describe('ending a party', () => {
    it('switches every guest off and revokes their sessions, so they are turned away at once', async () => {
        const { service, actors, sessions } = build({ endedGuests: ['g-1'] });

        await service.end();

        expect(actors.update).toHaveBeenCalledWith('g-1', false);
        expect(sessions.revokeAllForSubject).toHaveBeenCalledWith('g-1', 'logout');
    });

    it('is an operator’s to do, not a guest’s', async () => {
        const guest = new AuthorizationContext({ kind: 'guest', sessionToken: 's', actorId: 'g-1', partyPassId: 'pass-1' });
        await expect(build({}, guest).service.end()).rejects.toMatchObject({ statusCode: 403 });
    });
});

describe('joining a party', () => {
    const anonymous = new AuthorizationContext({ kind: 'system', sessionToken: '', source: 'http' }, { clientAddress: '203.0.113.9' });

    it('makes a guest actor and a guest session that ends when the pass does', async () => {
        const pass = livePass('dp_abc', 3);
        const { service, actors, passes, sessions, limiter } = build({ live: pass }, anonymous);

        const joined = await service.join({ token: ' dp_abc ' });

        expect(limiter.consume).toHaveBeenCalledWith('203.0.113.9');
        expect(actors.create).toHaveBeenCalledWith('guest');
        expect(passes.addGuest).toHaveBeenCalledWith('pass-1', 'guest-1');
        const [subject, claims, factor, lifetime] = sessions.createSession.mock.calls[0] as unknown as [
            string,
            unknown,
            { kind: string },
            { as: (u: string) => number },
        ];
        expect(subject).toBe('guest-1');
        expect(claims).toEqual({ actorType: 'guest', partyPassId: 'pass-1' });
        expect(factor.kind).toBe('possession');
        expect(Math.round(lifetime.as('hours'))).toBe(3);
        // The bearer only: a refresh token would outlive nothing and is never handed over.
        expect(joined).toEqual({ accessToken: 'jwt', expiresAt: pass.expiresAt });
        expect(JSON.stringify(joined)).not.toContain('never-sent');
    });

    it('answers the same 404 for a pass that never was and one that has ended, and makes nobody', async () => {
        const { service, actors } = build({}, anonymous);

        await expect(service.join({ token: 'dp_guess' })).rejects.toMatchObject({ statusCode: 404 });
        expect(actors.create).not.toHaveBeenCalled();
    });

    it('turns a guest away from a full party', async () => {
        const { service, actors } = build({ live: livePass(), guests: MAX_PARTY_GUESTS }, anonymous);

        await expect(service.join({ token: 'dp_abc' })).rejects.toMatchObject({ statusCode: 409 });
        expect(actors.create).not.toHaveBeenCalled();
    });

    it('spends the address’s allowance before looking at the pass, so guessing costs the guesser', async () => {
        const { service, limiter, passes } = build({}, anonymous);
        limiter.consume.mockRejectedValueOnce(Object.assign(new Error('429'), { statusCode: 429 }));

        await expect(service.join({ token: 'dp_abc' })).rejects.toMatchObject({ statusCode: 429 });
        expect(passes.liveByHash).not.toHaveBeenCalled();
    });
});
