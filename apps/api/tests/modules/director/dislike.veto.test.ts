// DislikeVeto is the subscriber on the other side of `catalog.disliked`: an operator forbidding
// something has to reach a running order that was vetted before they said so. Everything
// interesting about WHICH records go is decided in `DirectorConsoleService.vetoDisliked` and
// everything about what happens to them in `StationLineup.veto`, so what is tested here is that it
// forwards, that it stops when it is stopped, and that it cannot take the rating down with it.
//
// The scope double is `enrichment.refresh.test.ts`'s, for the same reason: a singleton that opens
// its own scope per event, with no database behind it.

import { describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';

import { DislikeVeto } from '../../../src/modules/director/dislike.veto.js';
import { StationBus } from '../../../src/modules/shared/station.bus.js';

const silent = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as unknown as Logger;

function build(options: { throws?: boolean } = {}) {
    const vetoDisliked = vi.fn(async () => {
        if (options.throws) throw new Error('the mailbox is gone');
    });
    const scope = { get: vi.fn(() => ({ vetoDisliked })), disposeAsync: vi.fn(async () => {}) };
    const container = { createScopedContainer: vi.fn(() => scope) } as unknown as Container;

    const logger = silent();
    const bus = new StationBus(silent());
    const veto = new DislikeVeto(container, bus, logger);

    return { veto, bus, vetoDisliked, scope, logger };
}

/** `StationBus.publish` fans out synchronously but the subscriber's own work is async. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('DislikeVeto', () => {
    it('asks the console to take the forbidden records out, naming what was rated', async () => {
        const { veto, bus, vetoDisliked } = build();
        veto.start();

        bus.publish('catalog.disliked', { level: 'artist', id: 'art_1', name: 'Grateful Dead' });
        await flush();

        expect(vetoDisliked).toHaveBeenCalledWith('Grateful Dead');
    });

    it('does the same for a record and for a song, because the veto re-judges the whole order', async () => {
        // The level is on the event for the feed's sake and nothing reads it to decide anything:
        // `ratingsFor` has already collapsed all three into one number per record.
        const { veto, bus, vetoDisliked } = build();
        veto.start();

        bus.publish('catalog.disliked', { level: 'album', id: 'alb_1', name: 'American Beauty' });
        bus.publish('catalog.disliked', { level: 'track', id: 'trk_1', name: 'Truckin' });
        await flush();

        expect(vetoDisliked.mock.calls).toEqual([['American Beauty'], ['Truckin']]);
    });

    it('opens a scope per event and closes it again, since a rating can land with no request in flight', async () => {
        // A singleton holding the subscription cannot capture a scoped service at construction:
        // there may be no request to borrow a connection from when the event arrives, and a scope
        // left open is a pooled connection nobody gives back.
        const { veto, bus, scope } = build();
        veto.start();

        bus.publish('catalog.disliked', { level: 'artist', id: 'art_1', name: 'Grateful Dead' });
        bus.publish('catalog.disliked', { level: 'artist', id: 'art_2', name: 'Phish' });
        await flush();

        expect(scope.disposeAsync).toHaveBeenCalledTimes(2);
    });

    it('stops asking once stopped', async () => {
        const { veto, bus, vetoDisliked } = build();
        veto.start();
        veto.stop();

        bus.publish('catalog.disliked', { level: 'artist', id: 'art_1', name: 'Grateful Dead' });
        await flush();

        expect(vetoDisliked).not.toHaveBeenCalled();
    });

    it('subscribes once however many times it is started', async () => {
        const { veto, bus, vetoDisliked } = build();
        veto.start();
        veto.start();

        bus.publish('catalog.disliked', { level: 'artist', id: 'art_1', name: 'Grateful Dead' });
        await flush();

        expect(vetoDisliked).toHaveBeenCalledTimes(1);
    });

    it('swallows a failure, because the rating it followed has already succeeded', async () => {
        // This runs inside an `AfterCommit` task with nobody to hand a rejection to, and the write
        // it followed is durable. An unhandled rejection here would be a rating that reports failure
        // after succeeding.
        const { veto, bus, logger } = build({ throws: true });
        veto.start();

        bus.publish('catalog.disliked', { level: 'artist', id: 'art_1', name: 'Grateful Dead' });
        await flush();

        expect(logger.warn).toHaveBeenCalled();
    });
});
