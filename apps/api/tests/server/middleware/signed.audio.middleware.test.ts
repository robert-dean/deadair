// This middleware IS the policy on the three audio routes, which are `security: none` in the
// contract because a headerless fetch has no session for a policy to read. A hole here is a
// full-length record served to whoever asks for it.
//
// The list of paths is as load-bearing as the check, in both directions: a route on the list is
// gated, and a `security: none` audio route that is NOT on the list is open. The last describe reads
// the contracts and holds the two together.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { PolicyService } from '@maroonedsoftware/policies';

import { SIGNED_AUDIO_PATHS, isSignedAudioPath, signedAudioMiddleware } from '../../../src/server/middleware/signed.audio.middleware.js';
import { LiquidsoapEndpoint } from '../../../src/modules/playout/liquidsoap.endpoint.js';
import { signAudioPath } from '../../../src/modules/playout/playout.audio.token.js';
import { BRIDGE_PATH_PREFIX } from '../../../src/server/middleware/bridge.secret.middleware.js';

const SECRET = 'bridge-secret';
const SEGMENT = '/segments/8c1c9f2e-3b6a-4d1e-9c1a-2f3b4c5d6e7f/audio';
const STORED = `/audio/${'ab'.repeat(32)}/mp3`;
const TRACK = '/playout/audio/8c1c9f2e-3b6a-4d1e-9c1a-2f3b4c5d6e7f';

/** A policy service whose only policy is the read floor, granted to whoever the test says. */
const policies = (granted: boolean) => ({
    assert: vi.fn(async (policy: string) => {
        if (policy !== 'platform.view') throw new Error(`unexpected policy ${policy}`);
        if (!granted) throw Object.assign(new Error('platform_view_required'), { status: 403 });
    }),
});

/**
 * A request as Koa presents it, with the parts this middleware touches: the path, the query, the
 * session the authentication middleware left, and the scoped container.
 */
const request = (path: string, options: { query?: Record<string, string>; session?: 'user' | 'none'; granted?: boolean; secret?: string } = {}) => {
    const service = policies(options.granted ?? true);
    return {
        path,
        query: options.query ?? {},
        authenticationSession: options.session === 'user' ? { sessionToken: 's', claims: { actorType: 'user' } } : invalidAuthenticationSession,
        container: {
            get: (token: unknown) => {
                if (token === LiquidsoapEndpoint) return { secret: () => options.secret ?? SECRET };
                if (token === PolicyService) return service;
                return undefined;
            },
        },
        service,
    };
};

async function run(ctx: ReturnType<typeof request>): Promise<{ passed: boolean; status?: number }> {
    const next = vi.fn(async () => {});
    try {
        await signedAudioMiddleware()(ctx as never, next);
        return { passed: next.mock.calls.length > 0 };
    } catch (error) {
        return { passed: false, status: (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode };
    }
}

describe('signedAudioMiddleware', () => {
    it('lets a URL signed over its path through, with no session at all', async () => {
        const t = signAudioPath(SECRET, SEGMENT, Date.now() + 60_000);

        expect(await run(request(SEGMENT, { query: { t } }))).toEqual({ passed: true });
    });

    it.each([SEGMENT, STORED, TRACK])('gates %s', async path => {
        const t = signAudioPath(SECRET, path, Date.now() + 60_000);

        expect(await run(request(path, { query: { t } }))).toEqual({ passed: true });
        expect((await run(request(path))).status).toBe(401);
    });

    it('refuses a token cut for another path', async () => {
        const t = signAudioPath(SECRET, STORED, Date.now() + 60_000);

        expect((await run(request(SEGMENT, { query: { t } }))).status).toBe(401);
    });

    it('refuses an expired token', async () => {
        const t = signAudioPath(SECRET, SEGMENT, Date.now() - 1_000);

        expect((await run(request(SEGMENT, { query: { t } }))).status).toBe(401);
    });

    it('refuses every token while the secret is unseeded', async () => {
        const t = signAudioPath('', SEGMENT, Date.now() + 60_000);

        expect((await run(request(SEGMENT, { query: { t }, secret: '' }))).status).toBe(401);
    });

    it('does not let a session rescue a bad token', async () => {
        // A caller presenting a token is the player; a wrong one is a wrong one.
        expect((await run(request(SEGMENT, { query: { t: 'nonsense' }, session: 'user' }))).status).toBe(401);
    });

    it('holds a call with no token to the read floor, exactly as the generated route would', async () => {
        const ctx = request(SEGMENT, { session: 'user', granted: true });

        expect(await run(ctx)).toEqual({ passed: true });
        expect(ctx.service.assert).toHaveBeenCalledWith('platform.view', expect.anything());
    });

    it('refuses a session that does not hold the floor', async () => {
        expect((await run(request(SEGMENT, { session: 'user', granted: false }))).status).toBe(403);
    });

    it('refuses no session and no token with a 401', async () => {
        expect((await run(request(SEGMENT))).status).toBe(401);
    });

    it('leaves every other path alone', async () => {
        for (const path of [
            '/segments',
            '/segments/not-a-uuid/audio',
            '/audio/short/mp3',
            '/playout/status',
            `${BRIDGE_PATH_PREFIX}aired`,
            '/pads/8c1c9f2e-3b6a-4d1e-9c1a-2f3b4c5d6e7f/audio',
        ]) {
            expect(await run(request(path)), path).toEqual({ passed: true });
        }
    });
});

/**
 * The contracts and the list, held together. Every `security: none` operation in the two areas that
 * serve audio is either under the bridge prefix, where the bridge gate covers it, or matched by this
 * middleware; and every pattern on the list matches a route that exists.
 */
describe('the audio routes the contracts leave to this middleware', () => {
    const contracts = join(import.meta.dirname, '../../../data/contracts');
    const areas = ['render/render.ck', 'playout/playout.ck'];

    /** Each operation's path and whether any of its methods is `security: none`. */
    const anonymousOperations = (file: string): string[] => {
        const text = readFileSync(join(contracts, file), 'utf8');
        const found: string[] = [];
        const blocks = text.split(/^operation(?:\([^)]*\))?\s+/m).slice(1);
        for (const block of blocks) {
            const path = block.split(':')[0]!.trim();
            if (/^\s*security:\s*none\s*$/m.test(block)) found.push(path);
        }
        return found;
    };

    /** A concrete path for a template, so the patterns can be asked about it. */
    const exampleOf = (template: string): string =>
        template
            .replace(/\{(id|sourceId)\}/g, '8c1c9f2e-3b6a-4d1e-9c1a-2f3b4c5d6e7f')
            .replace(/\{checksum\}/g, 'ab'.repeat(32))
            .replace(/\{ext\}/g, 'mp3');

    it('gates every anonymous audio route, and leaves the bridge to its own gate', () => {
        const anonymous = areas.flatMap(anonymousOperations);
        expect(anonymous.length).toBeGreaterThan(0);

        for (const template of anonymous) {
            const example = exampleOf(template);
            const covered = example.startsWith(BRIDGE_PATH_PREFIX) || isSignedAudioPath(example);
            expect(covered, `${template} is security: none and nothing gates it`).toBe(true);
        }
    });

    it('names no route the contracts do not serve', () => {
        const examples = areas.flatMap(anonymousOperations).map(exampleOf);

        for (const pattern of SIGNED_AUDIO_PATHS) {
            expect(
                examples.some(example => pattern.test(example)),
                `${pattern} matches no contract route`,
            ).toBe(true);
        }
    });

    it('no longer leaves the pad route open', () => {
        expect(anonymousOperations('render/render.ck')).not.toContain('/pads/{id}/audio');
    });
});
