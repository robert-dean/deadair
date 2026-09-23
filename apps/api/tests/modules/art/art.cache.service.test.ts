// The download half, with `fetch` and the resolver injected: what counts as art, what is too big,
// where the station will not fetch from, and the fact that every failure lands as a row rather than
// as a thrown error, because the sweep's next pass reads those rows to decide what to skip.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@maroonedsoftware/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArtCacheOptions, ArtCacheService } from '../../../src/modules/art/art.cache.service.js';
import { ArtRepository } from '../../../src/modules/art/art.repository.js';
import { ArtStore } from '../../../src/modules/art/art.store.js';
import type { AddressResolver } from '../../../src/modules/plugins/plugin.grants.js';
import { PluginOperatorHosts } from '../../../src/modules/plugins/plugin.operator.hosts.js';

const URL_JPG = 'https://coverartarchive.org/release/abc/front-500';
const BYTES = Buffer.from('cover art');

let root: string;
let store: ArtStore;

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() } as unknown as Logger;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-art-cache-test-'));
    store = new ArtStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

/** Every name public unless a test says otherwise, so nothing here reaches a real resolver. */
const publicResolver: AddressResolver = async () => ['93.184.215.14'];

/** The servers the operator configured, as `PluginOperatorHosts` would read them. */
const operatorHosts = (...hosts: string[]) => ({ list: vi.fn(async () => new Set(hosts)) }) as unknown as PluginOperatorHosts;

/** A service over the given network, with no operator servers unless a test names some. */
const serviceFor = (
    repository: ArtRepository,
    fetch: typeof globalThis.fetch,
    { resolve = publicResolver, trusted = operatorHosts() }: { resolve?: AddressResolver; trusted?: PluginOperatorHosts } = {},
): ArtCacheService => new ArtCacheService(repository, store, trusted, new ArtCacheOptions(fetch, resolve), logger);

/** A repository that records what it was told rather than touching a database. */
const fakeRepository = () => {
    const successes: { sourceUrl: string; checksum: string; ext: string; byteSize: number }[] = [];
    const failures: { sourceUrl: string; error: string }[] = [];

    const repository = {
        recordSuccess: vi.fn(async (sourceUrl: string, bytes: { checksum: string; ext: string; byteSize: number }) => {
            successes.push({ sourceUrl, ...bytes });
            return { id: 'asset-id', sourceUrl, checksum: bytes.checksum };
        }),
        recordFailure: vi.fn(async (sourceUrl: string, error: string) => {
            failures.push({ sourceUrl, error });
        }),
    };

    return { repository: repository as unknown as ArtRepository, successes, failures };
};

const respondWith = (body: Buffer | undefined, init: { status?: number; contentType?: string } = {}) =>
    vi.fn(async (_: string | URL | Request, __?: RequestInit) => {
        const headers = new Headers(init.contentType === undefined ? {} : { 'content-type': init.contentType });
        return new Response(body === undefined ? null : new Uint8Array(body), { status: init.status ?? 200, headers });
    });

/** A redirect to `location`, as a server answering `redirect: 'manual'` sends it. */
const redirectTo = (location: string, status = 302): Response => new Response(null, { status, headers: { location } });

const image = (): Response => new Response(new Uint8Array(BYTES), { headers: { 'content-type': 'image/jpeg' } });

describe('ArtCacheService.cache', () => {
    it('stores the bytes and records the asset', async () => {
        const { repository, successes } = fakeRepository();
        const fetch = respondWith(BYTES, { contentType: 'image/jpeg' });

        const outcome = await serviceFor(repository, fetch).cache(URL_JPG);

        expect(outcome).toEqual({ cached: true, id: 'asset-id' });
        expect(successes).toHaveLength(1);
        expect(successes[0]!.ext).toBe('jpg');
        expect(successes[0]!.byteSize).toBe(BYTES.byteLength);
        expect(await store.read(successes[0]!.checksum, 'jpg')).toEqual(BYTES);
    });

    it('reads the extension off the content type, parameters and all', async () => {
        const { repository, successes } = fakeRepository();
        const fetch = respondWith(BYTES, { contentType: 'IMAGE/PNG; charset=binary' });

        await serviceFor(repository, fetch).cache(URL_JPG);

        expect(successes[0]!.ext).toBe('png');
    });

    it('records a failure rather than throwing when the upstream is unhappy', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = respondWith(Buffer.from('nope'), { status: 404, contentType: 'text/html' });

        const outcome = await serviceFor(repository, fetch).cache(URL_JPG);

        expect(outcome.cached).toBe(false);
        expect(failures[0]!.error).toContain('404');
    });

    it('refuses a response that is not an image', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = respondWith(Buffer.from('<html>rate limited</html>'), { contentType: 'text/html' });

        expect((await serviceFor(repository, fetch).cache(URL_JPG)).cached).toBe(false);
        expect(failures[0]!.error).toContain('not an image');
    });

    it('refuses an image larger than the cap', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = respondWith(Buffer.alloc(6 * 1024 * 1024, 1), { contentType: 'image/jpeg' });

        expect((await serviceFor(repository, fetch).cache(URL_JPG)).cached).toBe(false);
        expect(failures[0]!.error).toContain('larger than');
    });

    it('refuses an empty body', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = respondWith(Buffer.alloc(0), { contentType: 'image/jpeg' });

        expect((await serviceFor(repository, fetch).cache(URL_JPG)).cached).toBe(false);
        expect(failures[0]!.error).toContain('empty');
    });

    // These URLs come from plugin code. `file:` would turn a bad mapping into a local file read.
    it('refuses a scheme that is not http(s), without fetching', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = vi.fn();

        expect((await serviceFor(repository, fetch).cache('file:///etc/passwd')).cached).toBe(false);
        expect(failures[0]!.error).toContain('file:');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('records a failure when the fetch itself blows up', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = vi.fn(async () => {
            throw new Error('connect ECONNREFUSED');
        });

        expect((await serviceFor(repository, fetch).cache(URL_JPG)).cached).toBe(false);
        expect(failures[0]!.error).toContain('ECONNREFUSED');
    });

    // Two URLs for the same image are two rows, but the store is content-addressed, so they share
    // one file. That is the whole reason the disk layout is not keyed by the asset id.
    it('writes one file for two URLs carrying identical bytes', async () => {
        const { repository, successes } = fakeRepository();
        const fetch = respondWith(BYTES, { contentType: 'image/jpeg' });
        const service = serviceFor(repository, fetch);

        await service.cache(URL_JPG);
        await service.cache('https://i.scdn.co/image/abc');

        expect(successes).toHaveLength(2);
        expect(successes[0]!.checksum).toBe(successes[1]!.checksum);
    });
});

// An art URL is whatever an upstream said, and what comes back an image is served publicly. So every
// hop is resolved and refused if it is private, unless it is a server the operator configured.
describe('ArtCacheService.cache, where it will not fetch from', () => {
    it('refuses a private literal without fetching', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = vi.fn(async () => image());

        expect((await serviceFor(repository, fetch).cache('http://169.254.169.254/latest/meta-data/')).cached).toBe(false);
        expect(failures[0]!.error).toContain('private address 169.254.169.254');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('refuses a public name that resolves to a private address, without fetching', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = vi.fn(async () => image());
        const resolve = vi.fn<AddressResolver>(async () => ['93.184.215.14', '127.0.0.1']);

        expect((await serviceFor(repository, fetch, { resolve }).cache('https://img.example.com/cover.jpg')).cached).toBe(false);
        expect(resolve).toHaveBeenCalledWith('img.example.com');
        expect(failures[0]!.error).toContain('img.example.com reaches the private address 127.0.0.1');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('refuses a public host redirecting to a private one, before connecting to it', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = vi.fn(async (input: string | URL | Request) =>
            new URL(String(input)).hostname === 'img.example.com' ? redirectTo('http://127.0.0.1:9000/cover.jpg') : image(),
        );

        expect((await serviceFor(repository, fetch).cache('https://img.example.com/cover.jpg')).cached).toBe(false);
        expect(failures[0]!.error).toContain('127.0.0.1 reaches the private address 127.0.0.1 (redirected there by img.example.com)');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('refuses a redirect to a public name that resolves privately', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = vi.fn(async () => redirectTo('https://sneaky.example.net/cover.jpg'));
        const resolve: AddressResolver = async hostname => (hostname === 'sneaky.example.net' ? ['10.0.0.8'] : ['93.184.215.14']);

        expect((await serviceFor(repository, fetch, { resolve }).cache('https://img.example.com/cover.jpg')).cached).toBe(false);
        expect(failures[0]!.error).toContain('private address 10.0.0.8');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('fails closed on a name that does not resolve', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = vi.fn(async () => image());
        const resolve: AddressResolver = async () => {
            throw new Error('getaddrinfo ENOTFOUND');
        };

        expect((await serviceFor(repository, fetch, { resolve }).cache('https://img.example.com/cover.jpg')).cached).toBe(false);
        expect(failures[0]!.error).toContain('could not be resolved');
        expect(fetch).not.toHaveBeenCalled();
    });

    // The catch the guard has to leave room for: Navidrome's cover URLs are on the operator's own
    // server, which is on the LAN, and the operator saying where it is is what makes it theirs.
    it('fetches from a Navidrome on the LAN at the address the operator configured', async () => {
        const { repository, successes } = fakeRepository();
        const fetch = vi.fn(async () => image());
        const trusted = operatorHosts('192.168.1.10:4533');

        const outcome = await serviceFor(repository, fetch, { trusted }).cache(
            'http://192.168.1.10:4533/rest/getCoverArt.view?id=al-1&u=dj&t=abc&s=def',
        );

        expect(outcome).toEqual({ cached: true, id: 'asset-id' });
        expect(successes).toHaveLength(1);
    });

    it('trusts a configured server by name without resolving it', async () => {
        const { repository } = fakeRepository();
        const fetch = vi.fn(async () => image());
        const resolve = vi.fn<AddressResolver>(async () => ['192.168.1.10']);
        const trusted = operatorHosts('navidrome.home:4533');

        expect(
            (await serviceFor(repository, fetch, { resolve, trusted }).cache('http://navidrome.home:4533/rest/getCoverArt.view?id=1')).cached,
        ).toBe(true);
        expect(resolve).not.toHaveBeenCalled();
    });

    // A Navidrome vouches for its own port, not for everything else on that machine: Icecast's admin
    // or the analysis sidecar can be one port away.
    it('refuses another port on the configured server', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = vi.fn(async () => image());
        const trusted = operatorHosts('192.168.1.10:4533');

        expect((await serviceFor(repository, fetch, { trusted }).cache('http://192.168.1.10:8000/admin/cover.jpg')).cached).toBe(false);
        expect(failures[0]!.error).toContain('private address 192.168.1.10');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('reads the operator servers once per sweep', async () => {
        const { repository } = fakeRepository();
        const fetch = vi.fn(async () => image());
        const trusted = operatorHosts('192.168.1.10:4533');
        const service = serviceFor(repository, fetch, { trusted });

        await service.cache('http://192.168.1.10:4533/rest/getCoverArt.view?id=1');
        await service.cache('http://192.168.1.10:4533/rest/getCoverArt.view?id=2');

        expect(trusted.list).toHaveBeenCalledTimes(1);
    });
});

describe('ArtCacheService.cache, following redirects', () => {
    it('follows a public chain by hand, resolving a relative location against the hop that sent it', async () => {
        const { repository, successes } = fakeRepository();
        const hops: string[] = [];
        const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            expect(init?.redirect).toBe('manual');
            const url = new URL(String(input));
            hops.push(url.href);
            if (url.hostname === 'coverartarchive.org') return redirectTo('https://archive.org/download/mbid-abc/front.jpg', 307);
            if (url.pathname.startsWith('/download/')) return redirectTo('/items/mbid-abc/front.jpg');
            return image();
        });

        expect((await serviceFor(repository, fetch).cache(URL_JPG)).cached).toBe(true);
        expect(hops).toEqual([URL_JPG, 'https://archive.org/download/mbid-abc/front.jpg', 'https://archive.org/items/mbid-abc/front.jpg']);
        expect(successes[0]!.sourceUrl).toBe(URL_JPG);
    });

    it('gives up on a chain longer than the cap', async () => {
        const { repository, failures } = fakeRepository();
        let n = 0;
        const fetch = vi.fn(async () => redirectTo(`https://img.example.com/${++n}`));

        expect((await serviceFor(repository, fetch).cache(URL_JPG)).cached).toBe(false);
        expect(failures[0]!.error).toContain('redirected more than 5 times');
        expect(fetch).toHaveBeenCalledTimes(6);
    });

    it('refuses a redirect to a scheme that is not http(s)', async () => {
        const { repository, failures } = fakeRepository();
        const fetch = vi.fn(async () => redirectTo('file:///etc/passwd'));

        expect((await serviceFor(repository, fetch).cache(URL_JPG)).cached).toBe(false);
        expect(failures[0]!.error).toContain('refusing a redirect to file:');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
