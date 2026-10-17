// What a party guest can reach, checked across every router rather than route by route.
//
// A guest holds no platform role, so the gates that refuse it are the policies every other route
// names: `platform.view`, `platform.manage` and `oauth.grant` all admit only a user (see
// `tests/modules/policy/platform.policies.test.ts`). What keeps it that way is that no route quietly
// names something weaker. This reads the routers' source, which the contracts generate, and holds
// every route to one of four answers: a policy that refuses a guest, `requests.ask` on the four
// routes a guest is for, a `policy: none` route reviewed below, or no policy at all, which is a public
// route and gives a guest nothing an anonymous caller does not already have. A new route that fits
// none of them fails here, and the fix is to decide what a guest should be able to do with it.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCES = [join(here, '../../src/routes'), join(here, '../../src/mcp')];

/** Policies that admit only a signed-in user, and so refuse a guest. */
const REFUSES_A_GUEST = new Set(['platform.view', 'platform.manage', 'oauth.grant']);

/** The routes a guest is for. Nothing else may name `requests.ask`. */
const GUEST_ROUTES = new Set(['GET /requests/search', 'POST /requests', 'GET /requests/mine', 'POST /requests/:id/insist']);

/**
 * `policy: none` admits ANY session, a guest's included, so each of these was read for what it does
 * with one. Every service behind them starts with `requireAuthentication`, which refuses a guest, or
 * works only from a sign-in challenge id a guest was never given.
 */
const ANY_SESSION_REVIEWED = new Map([
    ['GET /auth/factors', 'listFactors: requireAuthentication'],
    ['POST /auth/factors/register', 'registerFactor: requireAuthentication'],
    ['POST /auth/factors/verify', 'verifyFactorRegistration: requireAuthentication'],
    ['POST /auth/mfa/start', 'startFactorChallenge: needs a pending sign-in challenge id'],
    ['DELETE /auth/factors/:method/:methodId', 'removeFactor: requireAuthentication'],
    ['PUT /auth/password', 'setPassword: requireAuthentication'],
]);

interface Route {
    route: string;
    /** The named policy, `false` for `policy: none`, or absent for a public route. */
    policy?: string | false;
}

const ROUTE = /\.(get|post|put|patch|delete)\((['`])(.+?)\2,(.*)$/;
const NAMED = /requirePolicy\(\{ policy: '([^']+)' \}\)/;
const ANY = /requirePolicy\(\{ policy: false \}\)/;

const routes = (): Route[] =>
    SOURCES.flatMap(dir =>
        readdirSync(dir)
            .filter(name => name.endsWith('.router.ts'))
            .flatMap(name =>
                readFileSync(join(dir, name), 'utf8')
                    .split('\n')
                    .flatMap((line): Route[] => {
                        const match = ROUTE.exec(line);
                        if (!match) return [];
                        const route = `${match[1]!.toUpperCase()} ${match[3]}`;
                        const rest = match[4]!;
                        const named = NAMED.exec(rest);
                        if (named) return [{ route, policy: named[1] }];
                        if (ANY.test(rest)) return [{ route, policy: false }];
                        if (rest.includes('requirePolicy')) throw new Error(`unrecognised policy on ${route}: ${rest}`);
                        return [{ route }];
                    }),
            ),
    );

describe('what a party guest can reach', () => {
    const all = routes();

    it('reads every router, so a change in how they are written cannot empty this test', () => {
        expect(all.length).toBeGreaterThan(250);
        expect(all.filter(r => r.policy === 'platform.view').length).toBeGreaterThan(50);
    });

    it('names requests.ask on the four routes a guest is for, and nowhere else', () => {
        const asking = all.filter(r => r.policy === 'requests.ask').map(r => r.route);
        expect(asking.sort()).toEqual([...GUEST_ROUTES].sort());
    });

    it('lets a guest join without a session, which is the one way a guest gets one', () => {
        expect(all.find(r => r.route === 'POST /party/join')).toEqual({ route: 'POST /party/join' });
    });

    it('names a policy that refuses a guest on every other gated route', () => {
        const other = all.filter(r => typeof r.policy === 'string' && r.policy !== 'requests.ask' && !REFUSES_A_GUEST.has(r.policy));
        expect(other).toEqual([]);
    });

    it('admits any session only on routes reviewed for what a guest could do with them', () => {
        const unreviewed = all.filter(r => r.policy === false && !ANY_SESSION_REVIEWED.has(r.route)).map(r => r.route);
        expect(unreviewed).toEqual([]);
    });
});
