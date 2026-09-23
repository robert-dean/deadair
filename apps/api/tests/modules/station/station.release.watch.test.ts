// The release watch. What is pinned is everything an operator could notice going wrong: a switch
// turned off sends nothing and hides the answer at once, a failure never escapes and never erases a
// good answer, GitHub is asked at most once per window, and only final station releases newer than the
// build count.
//
// The switch is always handed over as a STRING, because that is what every layer of `AppConfig`
// holds: a test that passed `false` would pass whether or not the off-case worked.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { BuildRevision } from '../../../src/modules/shared/build.revision.js';
import { BundledChangelog } from '../../../src/modules/station/station.changelog.js';
import {
    CHECK_EVERY_MS,
    CHECK_NOW_FLOOR_MS,
    RELEASE_KEYS,
    RELEASES_ENDPOINT,
    ReleaseWatch,
    newerReleases,
} from '../../../src/modules/station/station.release.watch.js';

const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const githubRelease = (tag: string, over: Record<string, unknown> = {}) => ({
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-09-24T10:00:00Z',
    body: `\n- What changed in ${tag}.\n`,
    html_url: `https://github.com/robert-dean/deadair/releases/tag/${tag}`,
    ...over,
});

describe('newerReleases', () => {
    it('keeps final station releases newer than the build, newest first, with their notes and pages', () => {
        const found = newerReleases(
            [githubRelease('v0.26.3'), githubRelease('v0.27.0'), githubRelease('v0.26.2'), githubRelease('v0.26.1')],
            '0.26.2',
        );

        expect(found).toEqual([
            {
                version: '0.27.0',
                date: '2026-09-24',
                notes: '- What changed in v0.27.0.',
                url: 'https://github.com/robert-dean/deadair/releases/tag/v0.27.0',
            },
            {
                version: '0.26.3',
                date: '2026-09-24',
                notes: '- What changed in v0.26.3.',
                url: 'https://github.com/robert-dean/deadair/releases/tag/v0.26.3',
            },
        ]);
    });

    it('compares versions as numbers rather than as text', () => {
        expect(newerReleases([githubRelease('v0.10.0')], '0.9.4').map(release => release.version)).toEqual(['0.10.0']);
    });

    it('skips drafts, prereleases and the other products on the same page', () => {
        const found = newerReleases(
            [
                githubRelease('v0.30.0', { draft: true }),
                githubRelease('v0.29.0', { prerelease: true }),
                githubRelease('v0.28.0-rc.1'),
                githubRelease('streamdeck-v0.9.0'),
                githubRelease('desktop-v1.0.0'),
            ],
            '0.26.2',
        );

        expect(found).toEqual([]);
    });

    it('does not hand on a page that is not this repository’s', () => {
        const [release] = newerReleases([githubRelease('v0.27.0', { html_url: 'https://example.com/phish' })], '0.26.2');

        expect(release!.url).toBe('https://github.com/robert-dean/deadair/releases/tag/v0.27.0');
    });

    it('answers nothing for an answer that is not a list, and tolerates a release with no body or date', () => {
        expect(newerReleases({ message: 'API rate limit exceeded' }, '0.26.2')).toEqual([]);
        expect(newerReleases([githubRelease('v0.27.0', { body: null, published_at: null })], '0.26.2')).toEqual([
            { version: '0.27.0', notes: '', url: 'https://github.com/robert-dean/deadair/releases/tag/v0.27.0' },
        ]);
    });
});

function harness(over: { enabled?: string; current?: string; version?: string; fetcher?: typeof fetch } = {}) {
    const settings: Record<string, string> = over.enabled === undefined ? {} : { [RELEASE_KEYS.checkForUpdates]: over.enabled };
    const config = { get: (key: string, fallback: unknown) => settings[key] ?? fallback } as unknown as AppConfig;
    const fetcher =
        over.fetcher ??
        (vi.fn(
            async () => new Response(JSON.stringify([githubRelease('v0.27.0'), githubRelease('v0.26.2')]), { status: 200 }),
        ) as unknown as typeof fetch);
    let now = 1_800_000_000_000;
    const changelog = new BundledChangelog(over.current === undefined ? [] : [{ version: over.current, notes: '' }]);
    const watch = new ReleaseWatch(config, changelog, new BuildRevision(undefined, over.version), quiet, fetcher, () => now);
    return {
        watch,
        fetcher: fetcher as unknown as ReturnType<typeof vi.fn>,
        settings,
        advance: (ms: number) => {
            now += ms;
        },
    };
}

describe('ReleaseWatch', () => {
    it('asks GitHub and remembers the newer releases', async () => {
        const { watch, fetcher } = harness({ current: '0.26.2' });

        await watch.check();

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0]![0]).toBe(RELEASES_ENDPOINT);
        const reading = watch.reading();
        expect(reading.enabled).toBe(true);
        expect(reading.checkedAt).toBe(1_800_000_000_000);
        expect(reading.newer.map(release => release.version)).toEqual(['0.27.0']);
    });

    it('sends nothing at all while the switch is off, and hides what it knew the moment it is turned off', async () => {
        const { watch, fetcher, settings } = harness({ current: '0.26.2' });
        await watch.check();

        settings[RELEASE_KEYS.checkForUpdates] = 'false';

        expect(watch.reading()).toEqual({ enabled: false, newer: [] });
        await watch.check();
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('asks afresh when the switch is turned back on, rather than showing what it knew before', async () => {
        const { watch, fetcher, settings } = harness({ current: '0.26.2', enabled: 'false' });
        await watch.check();
        expect(fetcher).not.toHaveBeenCalled();

        settings[RELEASE_KEYS.checkForUpdates] = 'true';
        expect(watch.reading().checkedAt).toBeUndefined();
        await watch.check();

        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('asks at most once per window, and again once the window has passed', async () => {
        const { watch, fetcher, advance } = harness({ current: '0.26.2' });

        await watch.check();
        advance(CHECK_EVERY_MS - 1);
        await watch.check();
        expect(fetcher).toHaveBeenCalledTimes(1);

        advance(1);
        await watch.check();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('shares one request between two checks that meet', async () => {
        const { watch, fetcher } = harness({ current: '0.26.2' });

        await Promise.all([watch.check(), watch.check()]);

        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('keeps the last good answer through a failure, and retries on the next run', async () => {
        const responses = [
            () => new Response(JSON.stringify([githubRelease('v0.27.0')]), { status: 200 }),
            () => new Response('{"message":"API rate limit exceeded"}', { status: 403 }),
            () => {
                throw new TypeError('fetch failed');
            },
            () => new Response('not json', { status: 200 }),
        ];
        const fetcher = vi.fn(async () => responses.shift()!()) as unknown as typeof fetch;
        const { watch, advance } = harness({ current: '0.26.2', fetcher });

        await watch.check();
        for (let i = 0; i < 3; i++) {
            advance(CHECK_EVERY_MS);
            await expect(watch.check()).resolves.toBeUndefined();
            expect(watch.reading().newer.map(release => release.version)).toEqual(['0.27.0']);
        }
        expect(fetcher).toHaveBeenCalledTimes(4);
        // A failed run leaves the last success as the time it was checked, so the next hourly run is
        // not told to wait out a window nothing earned.
        expect(watch.reading().checkedAt).toBe(1_800_000_000_000);
    });

    it('reads the image version when the build carries no changelog', async () => {
        const { watch, fetcher } = harness({ version: '0.26.2' });

        await watch.check();

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(watch.reading().newer.map(release => release.version)).toEqual(['0.27.0']);
    });

    it('asks nothing when the build cannot say which release it is', async () => {
        const { watch, fetcher } = harness();

        await watch.check();

        expect(fetcher).not.toHaveBeenCalled();
        expect(watch.reading()).toEqual({ enabled: true, newer: [] });
    });

    describe('checkNow', () => {
        it('asks inside the six-hour window, which is what the button is for', async () => {
            const { watch, fetcher, advance } = harness({ current: '0.26.2' });
            await watch.check();

            advance(CHECK_NOW_FLOOR_MS);
            await watch.checkNow();

            expect(fetcher).toHaveBeenCalledTimes(2);
        });

        it('asks nothing within a minute of the last question, answered or not', async () => {
            const fetcher = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;
            const { watch, advance } = harness({ current: '0.26.2', fetcher });
            await watch.check();

            advance(CHECK_NOW_FLOOR_MS - 1);
            await watch.checkNow();
            await watch.checkNow();

            expect(fetcher).toHaveBeenCalledTimes(1);
        });

        it('waits for a question already running rather than sending a second', async () => {
            let answer: (response: Response) => void = () => undefined;
            const fetcher = vi.fn(() => new Promise<Response>(resolve => (answer = resolve))) as unknown as typeof fetch;
            const { watch } = harness({ current: '0.26.2', fetcher });

            const scheduled = watch.check();
            const pressed = watch.checkNow();
            answer(new Response(JSON.stringify([githubRelease('v0.27.0')]), { status: 200 }));
            await Promise.all([scheduled, pressed]);

            expect(fetcher).toHaveBeenCalledTimes(1);
            expect(watch.reading().newer.map(release => release.version)).toEqual(['0.27.0']);
        });

        it('sends nothing while the switch is off', async () => {
            const { watch, fetcher } = harness({ current: '0.26.2', enabled: 'off' });

            await watch.checkNow();

            expect(fetcher).not.toHaveBeenCalled();
        });
    });
});
