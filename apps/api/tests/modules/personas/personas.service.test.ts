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
    defaultHost: true,
    ...over,
});

function build(
    options: { setDefaultHost?: Persona | undefined; postFails?: boolean; roster?: Persona[]; ordersHost?: string; ties?: Map<string, string[]> } = {},
) {
    const roster = options.roster ?? [persona()];
    const personas = {
        // The ties a caller carries to the hosts it rings in to. Empty unless a case says otherwise,
        // which is every station before `deadair.caller_hosts` existed.
        callerHosts: vi.fn(async () => options.ties ?? new Map<string, string[]>()),
        setHosts: vi.fn(async () => undefined),
        untieHost: vi.fn(async () => undefined),
        create: vi.fn(async (draft: Persona) => ({ ...draft, id: 'new-id', defaultHost: false })),
        update: vi.fn(async (id: string, draft: Persona) => (roster.some(row => row.id === id) ? { ...draft, id, defaultHost: false } : undefined)),
        // Answers whatever `setDefaultHost` would, because the two are now asked in sequence: the service
        // reads the row first to find out whether it is a caller, so "no such persona" has to be the
        // same answer from both or a 404 case would half-pass.
        find: vi.fn(async () => ('setDefaultHost' in options ? options.setDefaultHost : persona())),
        setDefaultHost: vi.fn(async () => ('setDefaultHost' in options ? options.setDefaultHost : persona())),
        list: vi.fn(async () => roster),
        // The repository's own precedence, doubled: the order's host when it names one that exists,
        // and the station's own behind it. `PersonaRepository.presenting` is where the real one
        // lives, and `persona.repository.test.ts` is what holds it to that.
        presenting: vi.fn(
            async (id?: string) => (id === undefined ? undefined : roster.find(row => row.id === id)) ?? roster.find(row => row.defaultHost),
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

        await service.setDefaultHost('p1');
        expect(director.post).not.toHaveBeenCalled();

        await afterCommit.run();
        expect(director.post).toHaveBeenCalledWith({ kind: 'recast' });
    });

    it('names no host in the command, because the show may have named its own', async () => {
        // `presenting`'s precedence is not this surface's to reverse. The command says what
        // happened — the station changed character — and the director decides whether that reaches
        // the running order.
        const { service, director, afterCommit } = build();

        await service.setDefaultHost('p1');
        await afterCommit.run();

        expect(director.post).toHaveBeenCalledWith(expect.not.objectContaining({ bind: expect.anything() }));
    });

    it('records the change against the operator who made it', async () => {
        const { service, activity } = build();

        await service.setDefaultHost('p1');

        expect(activity.record).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'persona.active', detail: expect.stringContaining('Pirate captain'), actorId: 'actor-1' }),
        );
    });

    it('says nothing to the show about a persona the station does not have', async () => {
        const { service, director, afterCommit, activity } = build({ setDefaultHost: undefined });

        await expect(service.setDefaultHost('gone')).rejects.toMatchObject({ statusCode: 404 });
        await afterCommit.run();

        expect(director.post).not.toHaveBeenCalled();
        expect(activity.record).not.toHaveBeenCalled();
    });

    it('refuses to put a caller on air, and never writes the row', async () => {
        // Somebody who phones IN cannot present the station. The database refuses it too, and this
        // is the half that answers the operator with a sentence rather than a constraint violation
        // — which also means `setDefaultHost` is never reached, so there is nothing to undo.
        const { service, personas, director, activity } = build({ setDefaultHost: persona({ kind: 'caller', defaultHost: false }) });

        await expect(service.setDefaultHost('p1')).rejects.toMatchObject({ statusCode: 400 });

        expect(personas.setDefaultHost).not.toHaveBeenCalled();
        expect(director.post).not.toHaveBeenCalled();
        expect(activity.record).not.toHaveBeenCalled();
    });

    it('keeps the write when the director will not take the command', async () => {
        // Best-effort by design: the row is already durable, and a director that would not take a
        // command must not turn an operator's change of character into a failed request.
        const { service, afterCommit } = build({ postFails: true });

        await service.setDefaultHost('p1');

        await expect(afterCommit.run()).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });
});

// The console read a boolean called `active` and printed "On air" over it, which is true on an
// ordinary station and false during any show that named its own host — the state this station was
// in when somebody noticed. The flag is who presents when the broadcast names nobody; this is the
// other question, answered per request so it cannot drift from what the director is doing.
describe('PersonasService answering who is presenting', () => {
    const stationsOwn = persona({ id: 'p1', key: 'videoage', defaultHost: true });
    const guest = persona({ id: 'p2', key: 'wisecrack', defaultHost: false });

    it('names the host the broadcast on air chose, and not the station\u2019s own', async () => {
        const { service } = build({ roster: [stationsOwn, guest], ordersHost: 'p2' });

        const list = await service.list();

        expect(list.personas.find(row => row.id === 'p2')?.presenting).toBe(true);
        // The half that was wrong on the page: the station's own host carries `defaultHost` and is
        // not the one speaking.
        expect(list.personas.find(row => row.id === 'p1')?.presenting).toBe(false);
        expect(list.personas.find(row => row.id === 'p1')?.defaultHost).toBe(true);
    });

    it('falls back to the station\u2019s own host when the broadcast named nobody', async () => {
        const { service } = build({ roster: [stationsOwn, guest] });

        const list = await service.list();

        expect(list.personas.find(row => row.id === 'p1')?.presenting).toBe(true);
        expect(list.personas.find(row => row.id === 'p2')?.presenting).toBe(false);
    });

    it('answers the question on every write, since each one returns the whole roster', async () => {
        const { service } = build({ roster: [stationsOwn, guest], ordersHost: 'p2', setDefaultHost: stationsOwn });

        const list = await service.setDefaultHost('p1');

        // Putting the station's own host on does not take the show off its own: the director keeps
        // the running order's answer, so the page has to keep showing the guest as the one speaking.
        expect(list.personas.find(row => row.id === 'p2')?.presenting).toBe(true);
    });
});

// A caller can be tied to the hosts it rings in to, and a tied caller is cast only into a phone-in
// one of them presents. What these hold is the operator's half: which ties can be written, that a
// refusal writes nothing at all, that absent means none rather than "leave them alone", and that the
// roster answers each caller's ties. Casting's half is `production.caster.test.ts`.
describe('PersonasService tying a caller to the hosts it rings', () => {
    const host = persona({ id: 'h1', key: 'conspiracy', label: 'Conspiracy host', defaultHost: true });
    const otherHost = persona({ id: 'h2', key: 'classic', label: 'Classic host', defaultHost: false });
    const skeptic = persona({ id: 'c1', key: 'skeptic', kind: 'caller', label: 'Caller who wants proof', defaultHost: false });
    const pedant = persona({ id: 'c2', key: 'pedant', kind: 'caller', label: 'Caller who knows better', defaultHost: false });
    const roster = [host, otherHost, skeptic, pedant];

    const input = (over: Record<string, unknown> = {}) =>
        ({ key: 'skeptic', kind: 'caller', label: 'Caller who wants proof', style: 'a listener who wants proof', ...over }) as never;

    // Looks the id up in the roster, which the shared double does not: these cases are about which
    // persona an id names.
    function tying(ties?: Map<string, string[]>) {
        const built = build({ roster, ...(ties === undefined ? {} : { ties }) });
        built.personas.find = vi.fn(async (id: string) => roster.find(row => row.id === id)) as never;
        return built;
    }

    it('writes the hosts a new caller rings in to', async () => {
        const { service, personas } = tying();

        await service.create(input({ hosts: ['h1', 'h2', 'h1'] }));

        // Deduplicated, because the primary key would otherwise refuse the second row as a 500.
        expect(personas.setHosts).toHaveBeenCalledWith('new-id', ['h1', 'h2']);
    });

    it('clears a caller\u2019s ties when a save sends none', async () => {
        // The console leaves an empty field out, so "absent" is what clearing the last host looks
        // like on the wire. Reading it as "leave them alone" would make a tie impossible to remove.
        const { service, personas } = tying();

        await service.update('c1', input());

        expect(personas.setHosts).toHaveBeenCalledWith('c1', []);
    });

    it('refuses hosts on a host, and writes nothing', async () => {
        const { service, personas } = tying();

        await expect(service.update('h2', input({ key: 'classic', kind: 'host', label: 'Classic host', hosts: ['h1'] }))).rejects.toMatchObject({
            statusCode: 400,
        });

        expect(personas.update).not.toHaveBeenCalled();
        expect(personas.setHosts).not.toHaveBeenCalled();
    });

    it('refuses a caller ringing in to another caller, and writes nothing', async () => {
        const { service, personas } = tying();

        await expect(service.update('c1', input({ hosts: ['c2'] }))).rejects.toMatchObject({ statusCode: 400 });

        expect(personas.update).not.toHaveBeenCalled();
        expect(personas.setHosts).not.toHaveBeenCalled();
    });

    it('refuses a host the station does not have, and writes nothing', async () => {
        const { service, personas } = tying();

        await expect(service.create(input({ hosts: ['gone'] }))).rejects.toMatchObject({ statusCode: 400 });

        expect(personas.create).not.toHaveBeenCalled();
    });

    it('unties the callers of a host rewritten as somebody who phones in', async () => {
        // Nobody can ring a character that never presents, so the ties naming it go rather than
        // leaving a caller tied to a host that will never be on.
        const { service, personas } = tying();

        await service.update('h2', input({ key: 'classic', label: 'Classic host' }));

        expect(personas.untieHost).toHaveBeenCalledWith('h2');
    });

    it('answers each caller\u2019s hosts on the roster, and none on a host', async () => {
        const { service } = tying(new Map([['c1', ['h1']]]));

        const list = await service.list();

        expect(list.personas.find(row => row.id === 'c1')?.hosts).toEqual(['h1']);
        expect(list.personas.find(row => row.id === 'c2')).not.toHaveProperty('hosts');
        expect(list.personas.find(row => row.id === 'h1')).not.toHaveProperty('hosts');
    });
});
