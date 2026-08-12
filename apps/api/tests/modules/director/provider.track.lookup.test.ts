// The failure this is shaped around is silent: a near-miss does not error, it airs the wrong
// record, and the running order says what was asked for while something else comes out of the
// speakers. So almost everything here is about what it REFUSES. A refusal costs one track from a
// batch that was oversampled for exactly that; a wrong match costs the operator's trust in the
// running order.

import { describe, expect, it, vi } from 'vitest';
import type { ProviderTrack } from '@deadair/plugin-sdk';

import { ProviderTrackLookup } from '../../../src/modules/director/provider.track.lookup.js';
import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

const passthroughInvoker = () =>
    ({ invoke: vi.fn(async (_id: string, _op: string, work: () => Promise<unknown>) => work()) }) as unknown as PluginInvoker;

const track = (title: string, artist: string, durationMs?: number): ProviderTrack => ({
    id: `${title}:${artist}:${durationMs ?? 0}`,
    title,
    artists: [artist],
    ...(durationMs === undefined ? {} : { durationMs }),
});

interface FakeOptions {
    id?: string;
    tracks?: ProviderTrack[];
    /** Omit `searchTracks` entirely, as a browse-only provider legitimately does. */
    searches?: boolean;
    fails?: boolean;
}

function fakeCatalog(options: FakeOptions = {}): PluginRecord {
    const instance: Record<string, unknown> = { listPlaylists: async () => [], getPlaylistTracks: async () => [] };

    if (options.searches !== false) {
        instance.searchTracks = vi.fn(async () => {
            if (options.fails === true) throw new Error('the provider was down');
            return options.tracks ?? [];
        });
    }

    return {
        id: options.id ?? 'deadair.provider',
        dir: '/plugins/provider',
        status: 'active',
        manifest: { capabilities: ['catalog'] },
        instance,
    } as unknown as PluginRecord;
}

const lookupFor = (records: PluginRecord[]) =>
    new ProviderTrackLookup({ list: () => records } as unknown as PluginRegistry, passthroughInvoker(), logger());

describe('ProviderTrackLookup deciding whether to ask at all', () => {
    it('says it cannot look anything up with no provider installed', () => {
        expect(lookupFor([]).canLookUp()).toBe(false);
    });

    it('says it cannot look anything up when the only provider is browse-only', () => {
        // Every catalog method is optional in the SDK. Calling one the plugin never wrote is a
        // TypeError in the middle of a refill.
        expect(lookupFor([fakeCatalog({ searches: false })]).canLookUp()).toBe(false);
    });

    it('says it can once a searchable provider is there', () => {
        expect(lookupFor([fakeCatalog()]).canLookUp()).toBe(true);
    });
});

describe('ProviderTrackLookup matching', () => {
    it('takes a copy whose title and lead artist match exactly', async () => {
        const lookup = lookupFor([fakeCatalog({ id: 'deadair.spotify', tracks: [track('Dopesmoker', 'Sleep')] })]);

        const found = await lookup.find('Dopesmoker', 'Sleep');

        expect(found).toMatchObject({ pluginId: 'deadair.spotify', track: { title: 'Dopesmoker' } });
    });

    it('matches through the normalization the catalog itself is keyed by', async () => {
        // A match here has to mean what a catalog match means, or the same record resolves one way
        // by name and another way by lookup.
        const lookup = lookupFor([fakeCatalog({ tracks: [track('DOPESMOKER  ', 'sleep')] })]);

        expect(await lookup.find('Dopesmoker', 'Sleep')).toBeDefined();
    });

    it('refuses a title that is nearly right', async () => {
        // "Dopesmoker (Remastered)" is a different recording, and airing it is not a smaller
        // mistake than airing nothing: nobody watching the console would ever know.
        const lookup = lookupFor([fakeCatalog({ tracks: [track('Dopesmoker (Remastered)', 'Sleep')] })]);

        expect(await lookup.find('Dopesmoker', 'Sleep')).toBeUndefined();
    });

    it('refuses the right title by the wrong artist', async () => {
        const lookup = lookupFor([fakeCatalog({ tracks: [track('Dopesmoker', 'Someone Else')] })]);

        expect(await lookup.find('Dopesmoker', 'Sleep')).toBeUndefined();
    });

    it('matches on the LEAD artist rather than a credit line', async () => {
        // The same rule every rotation key in this codebase is built on. A compilation credited to
        // several acts must not match on whoever appears second.
        const featuring: ProviderTrack = { id: 'x', title: 'A Song', artists: ['Someone Else', 'Sleep'] };
        const lookup = lookupFor([fakeCatalog({ tracks: [featuring] })]);

        expect(await lookup.find('A Song', 'Sleep')).toBeUndefined();
    });

    it('refuses to ask at all for a pick with no usable identity', async () => {
        const provider = fakeCatalog();
        const lookup = lookupFor([provider]);

        expect(await lookup.find('', 'Sleep')).toBeUndefined();
        expect((provider.instance as { searchTracks: ReturnType<typeof vi.fn> }).searchTracks).not.toHaveBeenCalled();
    });
});

describe('ProviderTrackLookup choosing between copies', () => {
    it('follows the operator’s provider preference before anything it could infer', async () => {
        const lookup = lookupFor([
            fakeCatalog({ id: 'deadair.spotify', tracks: [track('Dopesmoker', 'Sleep', 3_600_000)] }),
            fakeCatalog({ id: 'deadair.navidrome', tracks: [track('Dopesmoker', 'Sleep', 60_000)] }),
        ]);

        const found = await lookup.find('Dopesmoker', 'Sleep', ['deadair.navidrome', 'deadair.spotify']);

        expect(found?.pluginId).toBe('deadair.navidrome');
    });

    it('takes the fuller record when one provider offers an edit and the album version', async () => {
        const lookup = lookupFor([
            fakeCatalog({ tracks: [track('Dopesmoker', 'Sleep', 240_000), track('Dopesmoker', 'Sleep', 3_600_000)] }),
        ]);

        const found = await lookup.find('Dopesmoker', 'Sleep');

        expect(found?.track.durationMs).toBe(3_600_000);
    });

    it('leaves two copies of the same length in the order they were offered', async () => {
        // Within tolerance is the same recording described twice. Stable rather than arbitrary
        // between runs of the same input.
        const first = track('Dopesmoker', 'Sleep', 3_600_000);
        const lookup = lookupFor([fakeCatalog({ tracks: [first, track('Dopesmoker', 'Sleep', 3_601_000)] })]);

        expect((await lookup.find('Dopesmoker', 'Sleep'))?.track.id).toBe(first.id);
    });
});

describe('ProviderTrackLookup when a provider will not answer', () => {
    it('skips the one that failed and keeps the answer from the one that did', async () => {
        // One dead upstream must not decide whether a record the station could play from somewhere
        // else gets found.
        const lookup = lookupFor([
            fakeCatalog({ id: 'deadair.broken', fails: true }),
            fakeCatalog({ id: 'deadair.spotify', tracks: [track('Dopesmoker', 'Sleep')] }),
        ]);

        expect((await lookup.find('Dopesmoker', 'Sleep'))?.pluginId).toBe('deadair.spotify');
    });

    it('answers with nothing rather than throwing when every provider is down', async () => {
        const lookup = lookupFor([fakeCatalog({ fails: true })]);

        expect(await lookup.find('Dopesmoker', 'Sleep')).toBeUndefined();
    });
});
