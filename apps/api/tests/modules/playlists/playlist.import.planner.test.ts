// The planner decides the preview and the import alike, so what is tested here is both: which of the
// three outcomes each record gets, what row it would become, and that nothing is ever searched for or
// created while deciding.

import { describe, expect, it, vi } from 'vitest';
import type { CatalogResolverRepository } from '../../../src/modules/catalog/ingest/catalog.resolver.repository.js';
import {
    MAX_IMPORT_ENTRIES,
    PlaylistImportPlanner,
    type PlaylistImportEntryInput,
    type PlaylistImportEntrySource,
} from '../../../src/modules/playlists/playlist.import.planner.js';

interface Library {
    /** `<pluginId>:<externalId>` → track id. */
    bindings?: Record<string, string>;
    /** Title → track id, as `findTrack` would answer by identity. */
    byIdentity?: Record<string, string>;
}

function build(library: Library = {}) {
    const resolver = {
        findTrackSource: vi.fn(async (pluginId: string, externalId: string) => library.bindings?.[`${pluginId}:${externalId}`]),
        findTrack: vi.fn(async (identity: { title: string }) => library.byIdentity?.[identity.title]),
        ingestTrack: vi.fn(async () => {
            throw new Error('planning an import must never create a track');
        }),
    } as unknown as CatalogResolverRepository;
    return { planner: new PlaylistImportPlanner(resolver), resolver };
}

const source = (entries: PlaylistImportEntryInput[], overrides: Partial<PlaylistImportEntrySource> = {}): PlaylistImportEntrySource => ({
    name: 'Late night',
    prompt: '',
    entries,
    skipped: 0,
    notices: [],
    ...overrides,
});

const held: PlaylistImportEntryInput = { title: 'Teardrop', artists: ['Massive Attack'] };
const copy: PlaylistImportEntryInput = { title: 'Roads', artists: ['Portishead'], origin: { pluginId: 'deadair.spotify', externalId: 'sp-1' } };
const named: PlaylistImportEntryInput = { title: 'Unfinished Sympathy', artists: ['Massive Attack'], durationMs: 308_000 };

describe('PlaylistImportPlanner.plan', () => {
    it('sorts each record into matched, toAdd or toLookUp, in the order the source gave them', async () => {
        const { planner } = build({ byIdentity: { Teardrop: 'track-1' } });

        const { plan, rows } = await planner.plan(source([held, copy, named]));

        expect(plan.entries.map(entry => [entry.position, entry.outcome])).toEqual([
            [0, 'matched'],
            [1, 'toAdd'],
            [2, 'toLookUp'],
        ]);
        expect(plan).toMatchObject({ name: 'Late night', matched: 1, toAdd: 1, toLookUp: 1, skipped: 0 });
        expect(plan.entries[0]!.trackId).toBe('track-1');
        expect(rows).toEqual([
            { trackId: 'track-1' },
            { snapshot: { title: 'Roads', artists: ['Portishead'] }, origin: { pluginId: 'deadair.spotify', externalId: 'sp-1' } },
            { snapshot: { title: 'Unfinished Sympathy', artists: ['Massive Attack'], durationMs: 308_000 } },
        ]);
    });

    it('asks for the provider copy first when the source names one', async () => {
        const { planner, resolver } = build({ bindings: { 'deadair.spotify:sp-1': 'track-9' } });

        const { plan } = await planner.plan(source([copy]));

        expect(plan.entries[0]).toMatchObject({ outcome: 'matched', trackId: 'track-9' });
        expect(resolver.findTrack).not.toHaveBeenCalled();
    });

    it('falls back to the resolver keys when the provider copy is not bound here', async () => {
        const { planner } = build({ byIdentity: { Roads: 'track-4' } });

        const { plan } = await planner.plan(source([copy]));

        expect(plan.entries[0]).toMatchObject({ outcome: 'matched', trackId: 'track-4' });
    });

    it('keeps the name the operator chose over the one the source gives', async () => {
        const { planner } = build();

        const { plan } = await planner.plan(source([held]), 'Mine now');

        expect(plan.name).toBe('Mine now');
    });

    it('cuts a source past the ceiling rather than refusing it, and says so', async () => {
        const { planner } = build();
        const many = Array.from({ length: MAX_IMPORT_ENTRIES + 5 }, (_, n) => ({ title: `Record ${n}`, artists: ['Somebody'] }));

        const { plan, rows } = await planner.plan(source(many));

        expect(rows).toHaveLength(MAX_IMPORT_ENTRIES);
        expect(plan.notices).toEqual([expect.stringContaining(`first ${MAX_IMPORT_ENTRIES}`)]);
    });

    it('says when a source names nothing at all', async () => {
        const { planner } = build();

        const { plan } = await planner.plan(source([], { skipped: 3 }));

        expect(plan).toMatchObject({ matched: 0, toAdd: 0, toLookUp: 0, skipped: 3 });
        expect(plan.notices).toEqual([expect.stringContaining('empty')]);
    });

    it('carries the source notices through', async () => {
        const { planner } = build();

        const { plan } = await planner.plan(source([held], { notices: ['two lines were not records'] }));

        expect(plan.notices).toEqual(['two lines were not records']);
    });
});
