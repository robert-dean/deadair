// The producer between the audience and the director. Everything interesting about a welcome is
// decided on one side or the other of it — the arrival edge in AudienceWatch, the cooldown and the
// placement in the director — so what is tested here is that it asks for the right thing, asks for
// nothing when the operator has turned greetings off, and cannot take the poll loop down with it.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { StationBus } from '../../../src/modules/shared/station.bus.js';
import { WELCOME_COOLDOWN_MS, WelcomeAnnouncer } from '../../../src/modules/director/welcome.announcer.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

function build(options: { result?: unknown; throws?: boolean } = {}) {
    const bus = new StationBus(logger);
    const requestBreak = vi.fn(async () => {
        if (options.throws) throw new Error('the mailbox is gone');
        return options.result ?? { accepted: true, requestId: 'req-1', segmentId: 'seg-1' };
    });
    const director = { requestBreak } as unknown as DirectorService;
    const announcer = new WelcomeAnnouncer(bus, director, logger);

    return { bus, announcer, requestBreak };
}

/** Let the request's own promise settle: the announcer deliberately awaits nothing. */
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('WelcomeAnnouncer', () => {
    it('asks for a welcome between records when somebody tunes in', async () => {
        const { bus, announcer, requestBreak } = build();
        announcer.start();

        bus.publish('audience.arrived', { count: 1 });
        await settle();

        expect(requestBreak).toHaveBeenCalledWith({
            kind: 'welcome',
            // Not `interrupt`: a greeting belongs in the gap, and talking over a record to say hello
            // is what an interruption is for.
            urgency: 'next',
            source: 'audience',
            reason: 'somebody tuned in',
            key: 'welcome',
            cooldownMs: WELCOME_COOLDOWN_MS,
        });
    });

    it('stops asking once stopped', async () => {
        const { bus, announcer, requestBreak } = build();
        announcer.start();
        announcer.stop();

        bus.publish('audience.arrived', { count: 1 });
        await settle();

        expect(requestBreak).not.toHaveBeenCalled();
    });

    it('subscribes once however many times it is started', async () => {
        const { bus, announcer, requestBreak } = build();
        announcer.start();
        announcer.start();

        bus.publish('audience.arrived', { count: 1 });
        await settle();

        expect(requestBreak).toHaveBeenCalledTimes(1);
    });

    it('swallows a director that cannot take the request', async () => {
        // This runs in the audience poll's own stack frame. A greeting that could not be asked for
        // must never cost the loop that noticed the listener.
        const { bus, announcer } = build({ throws: true });
        announcer.start();

        expect(() => bus.publish('audience.arrived', { count: 1 })).not.toThrow();
        await settle();

        expect(logger.warn).toHaveBeenCalled();
    });

    it('says nothing loud about an ordinary decline', async () => {
        // The ordinary decline is the cooldown, which happens every time somebody reconnects. A line
        // per reconnection is how a log stops being read.
        const { bus, announcer } = build({ result: { accepted: false, reason: 'the station already took a welcome recently' } });
        announcer.start();

        bus.publish('audience.arrived', { count: 1 });
        await settle();

        expect(logger.debug).toHaveBeenCalled();
    });
});
