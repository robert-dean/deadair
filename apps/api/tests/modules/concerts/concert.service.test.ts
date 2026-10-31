// Asking when an artist is next nearby: the station's own place, the first plugin
// with a date winning, and a service that failed costing the date and not the break.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { Concert, ConcertQuery, PluginManifest } from '@deadair/plugin-sdk';

import { ConcertService } from '../../../src/modules/concerts/concert.service.js';
import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';

const SHOW: Concert = { artist: 'Queen', venue: 'Tabernacle', city: 'Atlanta', startsOn: '2026-11-14' };

const record = (id: string, getConcerts: (query: ConcertQuery) => Promise<Concert[]>): PluginRecord =>
    ({
        id,
        status: 'active',
        manifest: { id, capabilities: ['concerts'] } as unknown as PluginManifest,
        instance: { getConcerts },
    }) as unknown as PluginRecord;

const service = (plugins: PluginRecord[], location = 'Atlanta, GA'): ConcertService =>
    new ConcertService(
        { list: () => plugins } as unknown as PluginRegistry,
        { invoke: (_: string, __: string, call: () => Promise<unknown>) => call() } as unknown as PluginInvoker,
        { get: (_: string, fallback?: unknown) => (location === '' ? fallback : location) } as unknown as AppConfig,
        { info: vi.fn() } as unknown as Logger,
    );

describe('ConcertService.nextDate', () => {
    it('asks about the station location and answers with the soonest show in the window', async () => {
        const getConcerts = vi.fn(async () => [{ ...SHOW, startsOn: '2026-12-01' }, SHOW]);

        await expect(service([record('a', getConcerts)]).nextDate('Queen', '2026-11-01', '2027-01-30')).resolves.toEqual(SHOW);
        expect(getConcerts).toHaveBeenCalledWith({ artist: 'Queen', place: 'Atlanta, GA', from: '2026-11-01' });
    });

    it('answers nothing for a show outside the window, whatever a plugin hands back', async () => {
        const plugin = record('a', async () => [SHOW]);

        await expect(service([plugin]).nextDate('Queen', '2026-11-15', '2027-01-30')).resolves.toBeUndefined();
        await expect(service([plugin]).nextDate('Queen', '2026-10-01', '2026-11-13')).resolves.toBeUndefined();
    });

    it('answers nothing with no location, rather than asking a service about nowhere', async () => {
        const getConcerts = vi.fn(async () => [SHOW]);

        await expect(service([record('a', getConcerts)], '').nextDate('Queen', '2026-11-01', '2027-01-30')).resolves.toBeUndefined();
        expect(getConcerts).not.toHaveBeenCalled();
    });

    it('moves on from a plugin that failed, and refuses a listing with no venue', async () => {
        const failed = record('a', async () => {
            throw new Error('down');
        });
        const blank = record('b', async () => [{ ...SHOW, venue: ' ' }]);
        const good = record('c', async () => [SHOW]);

        await expect(service([good, blank, failed]).nextDate('Queen', '2026-11-01', '2027-01-30')).resolves.toEqual(SHOW);
    });
});
