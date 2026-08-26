// A sheet field is threaded through THREE mappers — the operator's save, the read-back, and the
// generated draft — and the failure when it is threaded through fewer is silent: the editor draws a
// field, the operator fills it in, the save drops it, and the read-back shows it empty with nothing
// anywhere saying why. `storytelling` shipped broken exactly that way, threaded into the draft alone.
//
// So this is not a test of the soundboard feature. It is a test that `soundboard` survives a round
// trip, and that its one deliberate absence is deliberate.

import { describe, expect, it, vi } from 'vitest';

import { PersonasService } from '../../../src/modules/personas/personas.service.js';
import { AfterCommit } from '../../../src/modules/data/after.commit.js';
import type { Persona } from '../../../src/modules/personas/persona.js';
import type { PersonaInput } from '../../../src/modules/personas/types/personas.types.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const stored: Persona = {
    id: 'p1',
    key: 'wisecrack',
    kind: 'host',
    label: 'Wisecrack',
    style: 'a wisecracking late-night host',
    active: false,
    soundboard: 'wisecrack',
};

function build() {
    const written: unknown[] = [];
    const personas = {
        list: vi.fn(async () => [stored]),
        create: vi.fn(async (draft: unknown) => {
            written.push(draft);
            return stored;
        }),
    };

    const service = new PersonasService(
        personas as never,
        { list: vi.fn(async () => []) } as never,
        {} as never,
        { post: vi.fn(async () => undefined) } as never,
        new AfterCommit(),
        { actor: { kind: 'user', sessionToken: '', actorId: 'actor-1' } } as never,
        { record: vi.fn(async () => undefined) } as never,
        { get: vi.fn(() => undefined) } as never,
        logger as never,
    );

    return { service, personas, written };
}

const input = (over: Partial<PersonaInput> = {}): PersonaInput =>
    ({
        key: 'wisecrack',
        label: 'Wisecrack',
        style: 'a wisecracking late-night host',
        soundboard: 'wisecrack',
        ...over,
    }) as PersonaInput;

describe('a persona and its soundboard', () => {
    it('carries the board back out on the read', async () => {
        const { service } = build();

        const list = await service.list();

        expect(list.personas[0]?.soundboard).toBe('wisecrack');
    });

    it('keeps the board an operator saved rather than dropping it on the way in', async () => {
        const { service, written } = build();

        await service.create(input());

        // The whole point. A field the form sends and the write mapper does not read is a field that
        // works for seeds and for nothing else.
        expect(written[0]).toMatchObject({ soundboard: 'wisecrack' });
    });

    it('treats an empty board as no board rather than as a board called nothing', async () => {
        const { service, written } = build();

        await service.create(input({ soundboard: '' }));

        // `text()` is what turns a cleared form field into an absent one, so clearing the box hands
        // the presenter back their empty hands rather than pointing them at a rack named ''.
        expect(written[0]).not.toHaveProperty('soundboard');
    });
});
