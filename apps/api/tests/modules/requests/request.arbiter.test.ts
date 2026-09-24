// The arbitration, which Ideas #76 names as the real design problem: one request per person, a
// cooldown, and a cap, so a night does not become a jukebox with a voice-over. Every refusal is a
// sentence said to the person asking, so each is pinned by what it says.

import { describe, expect, it } from 'vitest';

import { arbitrate, type RequestFacts } from '../../../src/modules/requests/request.arbiter.js';

const facts = (overrides: Partial<RequestFacts> = {}): RequestFacts => ({
    enabled: true,
    onAir: true,
    cooldownMs: 30 * 60_000,
    trackAlreadyOpen: false,
    openCount: 0,
    maxOpen: 3,
    now: 10_000_000,
    ...overrides,
});

describe('arbitrate', () => {
    it('lets a first request through', () => {
        expect(arbitrate(facts())).toEqual({ ok: true });
    });

    it('refuses when requests are off, and when the station is off the air', () => {
        expect(arbitrate(facts({ enabled: false }))).toMatchObject({ ok: false, reason: 'The station is not taking requests right now.' });
        expect(arbitrate(facts({ onAir: false }))).toMatchObject({ ok: false, reason: expect.stringContaining('off the air') });
    });

    it('allows one open request per person, and names it', () => {
        expect(arbitrate(facts({ openForRequester: 'Teardrop by Massive Attack' }))).toEqual({
            ok: false,
            reason: 'You already have a request in: Teardrop by Massive Attack. One at a time.',
        });
    });

    it('holds a person to the cooldown after a request of theirs was let through, and says how long is left', () => {
        const now = 10_000_000;
        expect(arbitrate(facts({ now, lastGrantedAt: now - 20 * 60_000 }))).toEqual({
            ok: false,
            reason: 'One request every 30 minutes, so try again in 10 minutes.',
        });
    });

    it('lets them ask again once the cooldown has passed, and not at all when it is zero', () => {
        const now = 10_000_000;
        expect(arbitrate(facts({ now, lastGrantedAt: now - 31 * 60_000 }))).toEqual({ ok: true });
        expect(arbitrate(facts({ now, lastGrantedAt: now - 1, cooldownMs: 0 }))).toEqual({ ok: true });
    });

    it('does not take the same record twice', () => {
        expect(arbitrate(facts({ trackAlreadyOpen: true }))).toMatchObject({
            ok: false,
            reason: expect.stringContaining('already asked for that one'),
        });
    });

    it('closes the line when the cap is reached', () => {
        expect(arbitrate(facts({ openCount: 3 }))).toMatchObject({ ok: false, reason: expect.stringContaining('request line is full') });
        expect(arbitrate(facts({ openCount: 2 }))).toEqual({ ok: true });
    });
});
