// The boundary: what a plugin says becomes rows the station keeps, with ids qualified so two plugins
// cannot collide, and a piece that could never be placed in its series' order dropped rather than
// stored. One failing plugin, or one failing series, must cost only itself.

import { describe, expect, it, vi } from 'vitest';
import type { NarrationPiece, NarrationSeries } from '@deadair/plugin-sdk';

import { NarrationsService } from '../../../src/modules/narrations/narrations.service.js';
import type { NarrationPieceListing, NarrationPieceRecord } from '../../../src/modules/narrations/narration.piece.js';
import type { NarrationPieceRepository } from '../../../src/modules/narrations/narration.piece.repository.js';
import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

const series = (over: Partial<NarrationSeries> = {}): NarrationSeries => ({
    id: 'frankenstein',
    title: 'Frankenstein',
    order: 'serial',
    ...over,
});

const piece = (over: Partial<NarrationPiece> = {}): NarrationPiece => ({
    id: 'ch4',
    seriesId: 'frankenstein',
    seriesTitle: 'Frankenstein',
    title: 'Chapter 4',
    ordinal: 3,
    ...over,
});

/** One installed plugin, as the registry hands it over. */
function plugin(id: string, instance: Partial<Record<'listSeries' | 'listPieces' | 'getText', unknown>>) {
    return {
        id,
        status: 'active',
        manifest: { id, capabilities: ['narration'] },
        instance: { listSeries: async () => [], listPieces: async () => [], getText: async () => undefined, ...instance },
    };
}

/** A row as the repository reads one back, for the routes that start from one. */
const stored = (over: Partial<NarrationPieceRecord> = {}): NarrationPieceRecord => ({
    id: 'piece-1',
    seriesId: 'deadair.audiobook:frankenstein',
    pieceId: 'ch4',
    seriesTitle: 'Frankenstein',
    title: 'Chapter 4',
    seriesOrder: 'serial',
    ordinal: 3,
    seenAt: Date.parse('2026-09-16T10:00:00.000Z'),
    renderAttempts: 0,
    ...over,
});

function build(records: readonly ReturnType<typeof plugin>[], options: { row?: NarrationPieceRecord } = {}) {
    const written: NarrationPieceListing[][] = [];
    const withdrawn: { seriesId: string; listed: string[] }[] = [];
    const pieces = {
        record: vi.fn(async (listings: readonly NarrationPieceListing[]) => {
            written.push([...listings]);
            return listings.length;
        }),
        withdraw: vi.fn(async (seriesId: string, listed: readonly string[]) => {
            withdrawn.push({ seriesId, listed: [...listed] });
            return 1;
        }),
        list: vi.fn(async () => []),
        get: vi.fn(async () => options.row),
        claimRender: vi.fn(async () => true),
    } as unknown as NarrationPieceRepository;

    const registry = { list: vi.fn(() => records) } as unknown as PluginRegistry;
    // The real invoker's contract as far as this is concerned: run the thunk, let it throw.
    const pluginInvoker = {
        invoke: vi.fn(async (_id: string, _name: string, run: () => Promise<unknown>) => await run()),
    } as unknown as PluginInvoker;
    const jobs = { send: vi.fn(async () => {}) } as never;

    const service = new NarrationsService(registry, pluginInvoker, pieces, jobs, logger as never);
    return { service, written, withdrawn, pieces, jobs: jobs as unknown as { send: ReturnType<typeof vi.fn> } };
}

describe('NarrationsService.listSeries', () => {
    it('qualifies every id with the plugin that offered it', async () => {
        const { service } = build([plugin('deadair.audiobook', { listSeries: async () => [series()] })]);

        const listed = await service.listSeries();

        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({ id: 'deadair.audiobook:frankenstein', pluginId: 'deadair.audiobook', order: 'serial' });
    });

    it('keeps two plugins apart when both mint the same short series id', async () => {
        const { service } = build([
            plugin('deadair.audiobook', { listSeries: async () => [series()] }),
            plugin('deadair.gutenberg', { listSeries: async () => [series()] }),
        ]);

        const ids = (await service.listSeries()).map(one => one.id);

        expect(new Set(ids).size).toBe(2);
    });

    it('loses only its own series when a plugin cannot answer', async () => {
        const { service } = build([
            plugin('deadair.broken', {
                listSeries: async () => {
                    throw new Error('upstream down');
                },
            }),
            plugin('deadair.audiobook', { listSeries: async () => [series()] }),
        ]);

        expect(await service.listSeries()).toHaveLength(1);
    });

    it('drops a series with no id or no title rather than offering one nothing can name', async () => {
        const { service } = build([
            plugin('deadair.audiobook', {
                listSeries: async () => [series({ id: '' }), series({ id: 'x', title: '' }), series()],
            }),
        ]);

        expect(await service.listSeries()).toHaveLength(1);
    });
});

describe('NarrationsService.refresh', () => {
    it('records what a series holds, against the qualified series id', async () => {
        const { service, written } = build([
            plugin('deadair.audiobook', { listSeries: async () => [series()], listPieces: async () => [piece(), piece({ id: 'ch5', ordinal: 4 })] }),
        ]);

        const summary = await service.refresh();

        expect(summary).toMatchObject({ series: 1, listed: 2, added: 2, failed: [] });
        expect(written[0]?.[0]).toMatchObject({ seriesId: 'deadair.audiobook:frankenstein', pieceId: 'ch4', seriesOrder: 'serial', ordinal: 3 });
    });

    it('drops a serial piece with no ordinal, which no band could ever ask for', async () => {
        // A serial is worked through in order, so a piece with no place in that order is one the
        // station could never reach. The plugin broke its contract, and it costs that piece alone.
        const { service, written } = build([
            plugin('deadair.audiobook', { listSeries: async () => [series()], listPieces: async () => [piece({ ordinal: undefined }), piece()] }),
        ]);

        const summary = await service.refresh();

        expect(summary.listed).toBe(1);
        expect(written[0]).toHaveLength(1);
    });

    it('drops a latest piece with no date, for the same reason one step over', async () => {
        const { service, written } = build([
            plugin('deadair.column', {
                listSeries: async () => [series({ id: 'notes', order: 'latest' })],
                listPieces: async () => [piece({ publishedAt: undefined }), piece({ id: 'i2', publishedAt: '2026-09-15T00:00:00.000Z' })],
            }),
        ]);

        await service.refresh();

        expect(written[0]).toHaveLength(1);
        expect(written[0]?.[0]).toMatchObject({ pieceId: 'i2', seriesOrder: 'latest' });
    });

    it('drops a date that will not parse rather than the piece, in a serial', async () => {
        // Undated is a state a serial handles perfectly well: its order comes from the ordinal.
        const { service, written } = build([
            plugin('deadair.audiobook', { listSeries: async () => [series()], listPieces: async () => [piece({ publishedAt: 'the fourteenth' })] }),
        ]);

        await service.refresh();

        expect(written[0]).toHaveLength(1);
        expect(written[0]?.[0]).not.toHaveProperty('publishedAt');
    });

    it('records a failing series and carries on with the rest', async () => {
        const { service, written } = build([
            plugin('deadair.audiobook', {
                listSeries: async () => [series({ id: 'broken' }), series()],
                listPieces: async ({ seriesId }: { seriesId: string }) => {
                    if (seriesId === 'broken') throw new Error('could not open the file');
                    return [piece()];
                },
            }),
        ]);

        const summary = await service.refresh();

        expect(summary.failed).toEqual(['deadair.audiobook:broken']);
        expect(summary.series).toBe(2);
        expect(written.flat()).toHaveLength(1);
    });

    it('stops between series when the job is being abandoned', async () => {
        const controller = new AbortController();
        const { service } = build([
            plugin('deadair.audiobook', {
                listSeries: async () => [series(), series({ id: 'second' })],
                listPieces: async () => {
                    controller.abort();
                    return [piece()];
                },
            }),
        ]);

        const summary = await service.refresh(controller.signal);

        expect(summary.series).toBe(1);
    });

    it('withdraws what a series no longer lists, against everything the plugin did list', async () => {
        // The ids the plugin LISTED, including one the station could not place: a serial piece with no
        // ordinal is ignored, not dropped by its plugin, and must not read as withdrawn.
        const { service, withdrawn } = build([
            plugin('deadair.audiobook', {
                listSeries: async () => [series()],
                listPieces: async () => [piece(), piece({ id: 'ch5', ordinal: undefined })],
            }),
        ]);

        const summary = await service.refresh();

        expect(withdrawn).toEqual([{ seriesId: 'deadair.audiobook:frankenstein', listed: ['ch4', 'ch5'] }]);
        expect(summary.withdrawn).toBe(1);
    });

    it('withdraws nothing on an empty listing', async () => {
        // `[]` is what a plugin answers for a book it could not read today. Taking it as "no chapters"
        // would retire the whole book over a network blip.
        const { service, withdrawn } = build([plugin('deadair.audiobook', { listSeries: async () => [series()], listPieces: async () => [] })]);

        const summary = await service.refresh();

        expect(withdrawn).toEqual([]);
        expect(summary.withdrawn).toBe(0);
    });

    it('withdraws nothing on a listing as long as the refresh asked for', async () => {
        // `listPieces` has no offset, so an answer that fills the limit may be a window with the rest
        // of the book behind it.
        let asked = 0;
        const { service, withdrawn } = build([
            plugin('deadair.audiobook', {
                listSeries: async () => [series()],
                listPieces: async ({ limit }: { limit: number }) => {
                    asked = limit;
                    return Array.from({ length: limit }, (_, ordinal) => piece({ id: `ch${ordinal}`, ordinal }));
                },
            }),
        ]);

        await service.refresh();

        expect(asked).toBeGreaterThan(0);
        expect(withdrawn).toEqual([]);
    });

    it('withdraws nothing from a series that could not be listed', async () => {
        const { service, withdrawn } = build([
            plugin('deadair.audiobook', {
                listSeries: async () => [series()],
                listPieces: async () => {
                    throw new Error('could not open the file');
                },
            }),
        ]);

        await service.refresh();

        expect(withdrawn).toEqual([]);
    });

    it('offers nothing at all when no plugin declares the capability', async () => {
        const { service } = build([]);

        expect(service.hasNarrations()).toBe(false);
        expect(await service.refresh()).toMatchObject({ series: 0, listed: 0, added: 0 });
    });
});

describe('NarrationsService.requestRender', () => {
    it('refuses a piece the plugin has withdrawn, and asks for nothing', async () => {
        // The render would ask the plugin for words it has stopped offering, and write a failure onto a
        // row with nothing wrong with it.
        const { service, pieces, jobs } = build([], { row: stored({ withdrawnAt: Date.parse('2026-09-20T12:00:00.000Z') }) });

        await expect(service.requestRender('piece-1')).rejects.toMatchObject({ statusCode: 409 });
        expect(pieces.claimRender).not.toHaveBeenCalled();
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('answers a withdrawn piece it already holds audio for with its row', async () => {
        const { service, jobs } = build([], { row: stored({ withdrawnAt: Date.parse('2026-09-20T12:00:00.000Z'), segmentId: 'seg-1' }) });

        const answered = await service.requestRender('piece-1');

        expect(answered).toMatchObject({ id: 'piece-1', rendered: true, withdrawnAt: '2026-09-20T12:00:00.000Z' });
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('still asks for a piece that is listed', async () => {
        const { service, jobs } = build([], { row: stored() });

        await service.requestRender('piece-1');

        expect(jobs.send).toHaveBeenCalledWith('narrations.render', { pieceId: 'piece-1' });
    });
});
