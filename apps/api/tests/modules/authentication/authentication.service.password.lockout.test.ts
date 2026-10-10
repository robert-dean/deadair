// Five wrong passwords in thirty seconds block a key for five minutes. Keyed by the account alone,
// that let anybody on the internet lock the operator out of their own station, and an unknown
// address never reached 429 at all, so the sixth try said whether an account existed. These run the
// real library service over the real adapter (an in-memory limiter in place of Redis, same limits),
// with the caller's address switched between attempts the way the authorization context would.

import { IsHttpError } from '@maroonedsoftware/errors';
import { PasswordFactorService } from '@maroonedsoftware/authentication';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticationService } from '../../../src/modules/authentication/authentication.service.js';
import { PasswordRateLimiter } from '../../../src/modules/authentication/password.rate.limiter.js';

const KNOWN = 'operator@radio.example.com';
const UNKNOWN = 'nobody@radio.example.com';
const RIGHT = 'correct horse battery staple';

const build = () => {
    const caller = { address: '203.0.113.7' };
    const limiter = new PasswordRateLimiter(new RateLimiterMemory({ points: 5, duration: 30, blockDuration: 300 }), () => caller.address);

    const passwordFactors = new PasswordFactorService(
        { getFactor: vi.fn(async () => ({ id: 'pw-1', active: true, needsReset: false, value: { hash: RIGHT, salt: 's' } })) } as never,
        limiter,
        {} as never,
        { verify: vi.fn(async (password: string, hash: string) => password === hash), hash: vi.fn(async () => ({ hash: 'x', salt: 's' })) } as never,
        {} as never,
        {} as never,
        { record: vi.fn(async () => undefined) } as never,
    );

    const service = Object.create(AuthenticationService.prototype) as AuthenticationService;
    Object.assign(service, {
        emailFactorRepository: {
            findFactor: vi.fn(async (email: string) => (email === KNOWN ? { actorId: 'actor-1', active: true } : undefined)),
        },
        passwordFactorService: passwordFactors,
        passwordHashProvider: { verify: vi.fn(async () => false), hash: vi.fn(async () => ({ hash: 'x', salt: 's' })) },
        passwordLimiter: limiter,
        actorsRepository: { get: vi.fn(async () => ({ type: 'user' })) },
        sessionActivity: { recordFactorFailure: vi.fn(async () => undefined) },
    });

    const signIn = (email: string, password: string) =>
        (service as never as { verifyPasswordAndResolveActor: (u: string, p: string) => Promise<unknown> }).verifyPasswordAndResolveActor(
            email,
            password,
        );
    const statusOf = async (email: string, password: string): Promise<number | 'ok'> => {
        try {
            await signIn(email, password);
            return 'ok';
        } catch (error) {
            if (IsHttpError(error)) return error.statusCode;
            throw error;
        }
    };

    return { caller, statusOf };
};

describe('password sign-in lockout', () => {
    it('locks out the client that guessed, while the operator signs in from somewhere else', async () => {
        const { caller, statusOf } = build();

        caller.address = '198.51.100.23';
        for (let guess = 0; guess < 5; guess++) expect(await statusOf(KNOWN, 'wrong')).toBe(401);
        expect(await statusOf(KNOWN, 'wrong')).toBe(429);
        // Locked: even the right password is refused from this client.
        expect(await statusOf(KNOWN, RIGHT)).toBe(429);

        caller.address = '203.0.113.7';
        expect(await statusOf(KNOWN, RIGHT)).toBe('ok');
    });

    it('answers an unknown address exactly as it answers a known one: 401 five times, then 429', async () => {
        const { caller, statusOf } = build();
        caller.address = '198.51.100.23';

        const known: (number | 'ok')[] = [];
        const unknown: (number | 'ok')[] = [];
        for (let attempt = 0; attempt < 6; attempt++) {
            known.push(await statusOf(KNOWN, 'wrong'));
            unknown.push(await statusOf(UNKNOWN, 'wrong'));
        }

        expect(known).toEqual([401, 401, 401, 401, 401, 429]);
        expect(unknown).toEqual(known);
    });

    it('locks an unknown address out per client too', async () => {
        const { caller, statusOf } = build();

        caller.address = '198.51.100.23';
        for (let guess = 0; guess < 6; guess++) await statusOf(UNKNOWN, 'wrong');
        expect(await statusOf(UNKNOWN, 'wrong')).toBe(429);

        caller.address = '203.0.113.7';
        expect(await statusOf(UNKNOWN, 'wrong')).toBe(401);
    });

    it('treats an address typed in another case as the same address', async () => {
        const { caller, statusOf } = build();
        caller.address = '198.51.100.23';

        for (let guess = 0; guess < 5; guess++) await statusOf(UNKNOWN, 'wrong');
        expect(await statusOf(UNKNOWN.toUpperCase(), 'wrong')).toBe(429);
    });
});

describe('PasswordRateLimiter', () => {
    it('prefixes every key with the caller read at call time, not at construction', async () => {
        const inner = new RateLimiterMemory({ points: 1, duration: 30 });
        const caller = { address: 'a' as string | undefined };
        const limiter = new PasswordRateLimiter(inner, () => caller.address);

        await limiter.consume('actor-1');
        caller.address = 'b';
        await expect(limiter.consume('actor-1')).resolves.toBeDefined();
        caller.address = 'a';
        await expect(limiter.consume('actor-1')).rejects.toBeDefined();

        expect(limiter.keyFor('actor-1')).toBe('a:actor-1');
        caller.address = undefined;
        expect(limiter.keyFor('actor-1')).toBe('unknown:actor-1');
    });
});
