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
    kind: 'host',
    label: 'Pirate captain',
    style: 'a pirate captain who runs a radio station',
    active: true,
    ...over,
});

function build(options: { setActive?: Persona | undefined; postFails?: boolean; roster?: Persona[]; ordersHost?: string } = {}) {
    const roster = options.roster ?? [persona()];
    const personas = {
        // Answers whatever `setActive` would, because the two are now asked in sequence: the service
        // reads the row first to find out whether it is a caller, so "no such persona" has to be the
        // same answer from both or a 404 case would half-pass.
        find: vi.fn(async () => ('setActive' in options ? options.setActive : persona())),
        setActive: vi.fn(async () => ('setActive' in options ? options.setActive : persona())),
        list: vi.fn(async () => roster),
        // The repository's own precedence, doubled: the order's host when it names one that exists,
        // and the station's own behind it. `PersonaRepository.presenting` is where the real one
        // lives, and `persona.repository.test.ts` is what holds it to that.
        presenting: vi.fn(
            async (id?: string) => (id === undefined ? undefined : roster.find(row => row.id === id)) ?? roster.find(row => row.active),
        ),
    };
    const director = {
        post: vi.fn(async () => {
            if (options.postFails) throw new Error('the director is not taking commands');
            return undefined;
        }),
        // What the broadcast on air says about its own host, which is the input to the whole
        // question below. Undefined is a running order that named nobody.
        order: vi.fn(() => (options.ordersHost === undefined ? undefined : { personaId: options.ordersHost })),
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
            // The stories shelf. Untouched by anything these cases are about — only the seed and the
            // restore reach it — so an empty double is the honest one.
            {} as never,
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

    it('refuses to put a caller on air, and never writes the row', async () => {
        // Somebody who phones IN cannot present the station. The database refuses it too, and this
        // is the half that answers the operator with a sentence rather than a constraint violation
        // — which also means `setActive` is never reached, so there is nothing to undo.
        const { service, personas, director, activity } = build({ setActive: persona({ kind: 'caller', active: false }) });

        await expect(service.setActive('p1')).rejects.toMatchObject({ statusCode: 400 });

        expect(personas.setActive).not.toHaveBeenCalled();
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

// The console read a boolean called `active` and printed "On air" over it, which is true on an
// ordinary station and false during any show that named its own host — the state this station was
// in when somebody noticed. The flag is who presents when the broadcast names nobody; this is the
// other question, answered per request so it cannot drift from what the director is doing.
describe('PersonasService answering who is presenting', () => {
    const stationsOwn = persona({ id: 'p1', key: 'videoage', active: true });
    const guest = persona({ id: 'p2', key: 'wisecrack', active: false });

    it('names the host the broadcast on air chose, and not the station\u2019s own', async () => {
        const { service } = build({ roster: [stationsOwn, guest], ordersHost: 'p2' });

        const list = await service.list();

        expect(list.personas.find(row => row.id === 'p2')?.presenting).toBe(true);
        // The half that was wrong on the page: the station's own host carries `active` and is not
        // the one speaking.
        expect(list.personas.find(row => row.id === 'p1')?.presenting).toBe(false);
        expect(list.personas.find(row => row.id === 'p1')?.active).toBe(true);
    });

    it('falls back to the station\u2019s own host when the broadcast named nobody', async () => {
        const { service } = build({ roster: [stationsOwn, guest] });

        const list = await service.list();

        expect(list.personas.find(row => row.id === 'p1')?.presenting).toBe(true);
        expect(list.personas.find(row => row.id === 'p2')?.presenting).toBe(false);
    });

    it('answers the question on every write, since each one returns the whole roster', async () => {
        const { service } = build({ roster: [stationsOwn, guest], ordersHost: 'p2', setActive: stationsOwn });

        const list = await service.setActive('p1');

        // Putting the station's own host on does not take the show off its own: the director keeps
        // the running order's answer, so the page has to keep showing the guest as the one speaking.
        expect(list.personas.find(row => row.id === 'p2')?.presenting).toBe(true);
    });
});
