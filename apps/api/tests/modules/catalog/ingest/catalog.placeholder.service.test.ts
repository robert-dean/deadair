// The rule this service exists to keep is negative: a placeholder may find a
// canonical track, and may never create one. Creating one would make an
// unresolvable row look resolved while pointing at music the station cannot
// play, so most of what follows checks that nothing was written when nothing
// matched.
//
// The second theme is that `origin_snapshot` is jsonb written by an importer
// that is free to change, so it is treated as untrusted input: one bad row must
// not throw and take the whole batch's transaction with it.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { CatalogPlaceholderService } from '../../../../src/modules/catalog/ingest/catalog.placeholder.service.js';
import type { CatalogPlaceholderRepository, PlaylistPlaceholder } from '../../../../src/modules/catalog/ingest/catalog.placeholder.repository.js';
import type { CatalogResolverRepository } from '../../../../src/modules/catalog/ingest/catalog.resolver.repository.js';

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

const placeholder = (overrides: Partial<PlaylistPlaceholder> = {}): PlaylistPlaceholder => ({
    id: 'row-1',
    playlistId: 'playlist-1',
    position: 0,
    originPluginId: 'deadair.spotify',
    originExternalId: 'ext-1',
    originSnapshot: { id: 'ext-1', title: 'Hoppípolla', artists: ['Sigur Rós'], durationMs: 268_000, isrc: 'GBAAA0500123' },
    ...overrides,
});

interface Answers {
    /** `<pluginId>:<externalId>` → canonical track id. */
    bindings?: Record<string, string>;
    /** Whatever `findTrack` should answer, by title. */
    byIdentity?: Record<string, string>;
}

function build(pending: PlaylistPlaceholder[], answers: Answers = {}) {
    const resolved: { id: string; trackId: string }[] = [];

    const placeholders = {
        listUnresolved: vi.fn(async () => pending),
        resolve: vi.fn(async (id: string, trackId: string) => {
            resolved.push({ id, trackId });
            return true;
        }),
    } as unknown as CatalogPlaceholderRepository;

    const resolver = {
        findTrackSource: vi.fn(async (pluginId: string, externalId: string) => answers.bindings?.[`${pluginId}:${externalId}`]),
        findTrack: vi.fn(async (identity: { title: string }) => answers.byIdentity?.[identity.title]),
        // Present so a test fails loudly if the service ever reaches for the
        // creating half of the resolver.
        ingestTrack: vi.fn(async () => {
            throw new Error('a placeholder pass must never create a canonical track');
        }),
        resolveTrack: vi.fn(async () => {
            throw new Error('a placeholder pass must never create a canonical track');
        }),
        resolveArtist: vi.fn(async () => {
            throw new Error('a placeholder pass must never create a canonical artist');
        }),
    } as unknown as CatalogResolverRepository;

    const logger = stubLogger();
    return { service: new CatalogPlaceholderService(placeholders, resolver, logger), placeholders, resolver, resolved, logger };
}

describe('CatalogPlaceholderService.resolvePending', () => {
    it('resolves through the binding when the plugin id is already known', async () => {
        // The exact answer to the exact question, and the only rung that needs
        // no snapshot at all.
        const { service, resolver, resolved } = build([placeholder()], { bindings: { 'deadair.spotify:ext-1': 'track-9' } });

        await expect(service.resolvePending()).resolves.toEqual({ scanned: 1, resolved: 1 });

        expect(resolved).toEqual([{ id: 'row-1', trackId: 'track-9' }]);
        expect(resolver.findTrack).not.toHaveBeenCalled();
    });

    it('falls back to the snapshot when no binding matches', async () => {
        const { service, resolver, resolved } = build([placeholder()], { byIdentity: { Hoppípolla: 'track-7' } });

        await expect(service.resolvePending()).resolves.toEqual({ scanned: 1, resolved: 1 });

        expect(resolved).toEqual([{ id: 'row-1', trackId: 'track-7' }]);
        expect(resolver.findTrack).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Hoppípolla', artists: ['Sigur Rós'], isrc: 'GBAAA0500123', durationMs: 268_000 }),
        );
    });

    it('leaves a row alone, and creates nothing, when the library still does not have it', async () => {
        const { service, resolved, placeholders } = build([placeholder()]);

        await expect(service.resolvePending()).resolves.toEqual({ scanned: 1, resolved: 0 });

        expect(resolved).toEqual([]);
        expect(placeholders.resolve).not.toHaveBeenCalled();
    });

    it('counts a row it lost the race on as scanned but not resolved', async () => {
        const { service, placeholders } = build([placeholder()], { bindings: { 'deadair.spotify:ext-1': 'track-9' } });
        (placeholders.resolve as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

        await expect(service.resolvePending()).resolves.toEqual({ scanned: 1, resolved: 0 });
    });

    describe('untrusted snapshots', () => {
        it.each([
            ['missing', undefined],
            ['null', null],
            ['an array', [{ title: 'Hoppípolla' }]],
            ['a bare string', 'Hoppípolla'],
            ['an object with no title', { artists: ['Sigur Rós'] }],
            ['an object whose title is not a string', { title: 42 }],
        ])('skips a row whose snapshot is %s, without throwing', async (_label, originSnapshot) => {
            const { service, resolver, resolved } = build([placeholder({ originSnapshot })]);

            await expect(service.resolvePending()).resolves.toEqual({ scanned: 1, resolved: 0 });

            expect(resolved).toEqual([]);
            expect(resolver.findTrack).not.toHaveBeenCalled();
        });

        it('drops non-string entries from an artists array rather than passing them on', async () => {
            const snapshot = { title: 'Hoppípolla', artists: ['Sigur Rós', 42, null] };
            const { service, resolver } = build([placeholder({ originSnapshot: snapshot })]);

            await service.resolvePending();

            expect(resolver.findTrack).toHaveBeenCalledWith(expect.objectContaining({ artists: ['Sigur Rós'] }));
        });

        it('keeps going after a bad row so one import cannot block the batch', async () => {
            const rows = [
                placeholder({ id: 'row-1', originSnapshot: 'nonsense' }),
                placeholder({ id: 'row-2', originExternalId: 'ext-2', originSnapshot: { title: 'Glósóli', artists: ['Sigur Rós'] } }),
            ];
            const { service, resolved } = build(rows, { byIdentity: { Glósóli: 'track-2' } });

            await expect(service.resolvePending()).resolves.toEqual({ scanned: 2, resolved: 1 });
            expect(resolved).toEqual([{ id: 'row-2', trackId: 'track-2' }]);
        });
    });

    describe('cancellation', () => {
        it('stops between rows when the signal is aborted', async () => {
            const controller = new AbortController();
            const rows = [placeholder({ id: 'row-1' }), placeholder({ id: 'row-2', originExternalId: 'ext-2' })];
            const { service, placeholders } = build(rows, { bindings: { 'deadair.spotify:ext-1': 't1', 'deadair.spotify:ext-2': 't2' } });
            (placeholders.resolve as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
                controller.abort();
                return true;
            });

            await expect(service.resolvePending(controller.signal)).resolves.toEqual({ scanned: 1, resolved: 1 });
        });

        it('does nothing at all when cancelled before the first row', async () => {
            const controller = new AbortController();
            controller.abort();
            const { service, resolved } = build([placeholder()], { bindings: { 'deadair.spotify:ext-1': 't1' } });

            await expect(service.resolvePending(controller.signal)).resolves.toEqual({ scanned: 0, resolved: 0 });
            expect(resolved).toEqual([]);
        });
    });

    it('stays quiet when there was nothing to scan', async () => {
        // An hourly-ish job that logs a line per empty run is a job people learn
        // to filter out.
        const { service, logger } = build([]);

        await expect(service.resolvePending()).resolves.toEqual({ scanned: 0, resolved: 0 });
        expect(logger.info).not.toHaveBeenCalled();
    });
});
