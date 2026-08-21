// Putting a persona on air is the STATION's decision, and the show that is running may or may not be
// listening to it. These are about that seam and nothing else: the command reaches the director, it
// reaches it after the transaction rather than inside it, and a request that changed nothing sends
// nothing. What the director then does with it — whether the show named its own host, and which
// breaks get written again — is `DirectorService.recast` and is tested there.

import { describe, expect, it, vi } from 'vitest';

import { PersonasService } from '../../../src/modules/personas/personas.service.js';
import { AfterCommit } from '../../../src/modules/data/after.commit.js';
import type { Persona } from '../../../src/modules/personas/persona.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const persona = (over: Partial<Persona> = {}): Persona => ({
    id: 'p1',
    key: 'pirate',
    label: 'Pirate captain',
    style: 'a pirate captain who runs a radio station',
    active: true,
    ...over,
});

function build(options: { setActive?: Persona | undefined; postFails?: boolean } = {}) {
    const personas = {
        setActive: vi.fn(async () => ('setActive' in options ? options.setActive : persona())),
        list: vi.fn(async () => [persona()]),
    };
    const director = {
        post: vi.fn(async () => {
            if (options.postFails) throw new Error('the director is not taking commands');
            return undefined;
        }),
    };
    // Real rather than a double: it is a list of callbacks, and what these tests are about is that
    // the send is registered on it rather than awaited inline.
    const afterCommit = new AfterCommit();
    const activity = { record: vi.fn(async () => undefined) };
    const context = { actor: { kind: 'user', sessionToken: '', actorId: 'actor-1' } };

    return {
        personas,
        director,
        afterCommit,
        activity,
        service: new PersonasService(
            personas as never,
            {} as never,
            director as never,
            afterCommit,
            context as never,
            activity as never,
            { get: (_key: string, fallback: unknown) => fallback } as never,
            logger as never,
        ),
    };
}

describe('PersonasService putting a persona on air', () => {
    it('tells the show about it only once the write has committed', async () => {
        // The director reads the personas table on its own pooled connection: from inside this
        // transaction it would resolve the row as it stood before the write and conclude nothing
        // had changed.
        const { service, director, afterCommit } = build();

        await service.setActive('p1');
        expect(director.post).not.toHaveBeenCalled();

        await afterCommit.run();
        expect(director.post).toHaveBeenCalledWith({ kind: 'recast' });
    });

    it('names no host in the command, because the show may have named its own', async () => {
        // `presenting`'s precedence is not this surface's to reverse. The command says what
        // happened — the station changed character — and the director decides whether that reaches
        // the running order.
        const { service, director, afterCommit } = build();

        await service.setActive('p1');
        await afterCommit.run();

        expect(director.post).toHaveBeenCalledWith(expect.not.objectContaining({ bind: expect.anything() }));
    });

    it('records the change against the operator who made it', async () => {
        const { service, activity } = build();

        await service.setActive('p1');

        expect(activity.record).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'persona.active', detail: expect.stringContaining('Pirate captain'), actorId: 'actor-1' }),
        );
    });

    it('says nothing to the show about a persona the station does not have', async () => {
        const { service, director, afterCommit, activity } = build({ setActive: undefined });

        await expect(service.setActive('gone')).rejects.toMatchObject({ statusCode: 404 });
        await afterCommit.run();

        expect(director.post).not.toHaveBeenCalled();
        expect(activity.record).not.toHaveBeenCalled();
    });

    it('keeps the write when the director will not take the command', async () => {
        // Best-effort by design: the row is already durable, and a director that would not take a
        // command must not turn an operator's change of character into a failed request.
        const { service, afterCommit } = build({ postFails: true });

        await service.setActive('p1');

        await expect(afterCommit.run()).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });
});
