// The recorder's whole contract is what it does when the write fails, because that is the case
// its callers are built on: every one of them `void`s the promise on the assumption that an event
// nobody reads to decide anything can never cost the station the thing it was describing.

import { describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';

import { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
import { StationEventsRepository, type StationEvent } from '../../../src/modules/activity/station.events.repository.js';

const event: StationEvent = { module: 'playout', kind: 'silence.cause', detail: 'The station is airing.' };

function build(append: () => Promise<void> = async () => {}) {
    const repository = { append: vi.fn(append) };
    const scope = { get: vi.fn(() => repository), disposeAsync: vi.fn(async () => {}) };
    const container = { createScopedContainer: vi.fn(() => scope) } as unknown as Container;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

    return { recorder: new ActivityRecorder(container, logger), repository, scope, logger };
}

describe('ActivityRecorder', () => {
    it('writes the event through a scope of its own', async () => {
        const { recorder, repository, scope } = build();

        await recorder.record(event);

        expect(scope.get).toHaveBeenCalledWith(StationEventsRepository);
        expect(repository.append).toHaveBeenCalledWith(event);
    });

    it('swallows a failed write and says so at warn', async () => {
        // The asymmetry this exists for: a lost row is a gap in a feed, and a thrown error is the
        // station losing the silence, air toggle or recovery the event was describing.
        const { recorder, logger } = build(async () => {
            throw new Error('no connection');
        });

        await expect(recorder.record(event)).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalledOnce();
        expect((logger.warn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('no connection');
    });

    it('disposes its scope whichever way the write went', async () => {
        // A connection leaked per event would be a leak per silence edge, which on a station
        // flapping between gates is a leak per few seconds.
        const ok = build();
        await ok.recorder.record(event);
        expect(ok.scope.disposeAsync).toHaveBeenCalledOnce();

        const failed = build(async () => {
            throw new Error('no connection');
        });
        await failed.recorder.record(event);
        expect(failed.scope.disposeAsync).toHaveBeenCalledOnce();
    });
});
