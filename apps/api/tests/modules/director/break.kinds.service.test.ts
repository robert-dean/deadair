import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import type { AfterCommit } from '../../../src/modules/data/after.commit.js';
import { BreakKindCatalog } from '../../../src/modules/director/break.kind.catalog.js';
import { BreakKindRepository } from '../../../src/modules/director/break.kind.repository.js';
import type { AuthoredKind, AuthoredKindDraft } from '../../../src/modules/director/break.kind.js';
import { BreakKindsService } from '../../../src/modules/director/break.kinds.service.js';
import { BreakWriter, type BreakWriteRequest, type WrittenBreak } from '../../../src/modules/director/break.writer.js';
import { BreakWriterRegistry } from '../../../src/modules/director/break.writer.registry.js';
import type { ClockBandRepository } from '../../../src/modules/director/clock.band.repository.js';
import type { ClockBandRecord } from '../../../src/modules/director/clock.bands.js';
import type { BreakKindInput } from '../../../src/modules/director/types/break.kinds.types.js';
import { settingsConfig } from '../../utils/settings.config.js';
import { stubContainer } from '../../utils/stub.container.js';

/**
 * The console's half of the kinds an operator writes (Ideas #24). What it guards is the air: a key
 * that would collide with something the station makes, a key that changes under a band, and a kind
 * deleted while a band still asks for it.
 */

class Listed extends BreakWriter {
    readonly name = 'stub';
    constructor(readonly kind: string) {
        super();
    }
    async write(_: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        return undefined;
    }
}

/** The repository, in memory. */
class MemoryKinds {
    readonly rows: AuthoredKind[] = [];
    private next = 1;

    async list(): Promise<AuthoredKind[]> {
        return [...this.rows].sort((left, right) => left.position - right.position);
    }
    async get(id: string): Promise<AuthoredKind | undefined> {
        return this.rows.find(row => row.id === id);
    }
    async create(draft: AuthoredKindDraft): Promise<AuthoredKind> {
        const row = { id: `kind-${this.next++}`, ...draft };
        this.rows.push(row);
        return row;
    }
    async update(id: string, draft: AuthoredKindDraft): Promise<AuthoredKind | undefined> {
        const index = this.rows.findIndex(row => row.id === id);
        if (index < 0) return undefined;
        this.rows[index] = { ...this.rows[index]!, ...draft, key: this.rows[index]!.key };
        return this.rows[index];
    }
    async remove(id: string): Promise<boolean> {
        const index = this.rows.findIndex(row => row.id === id);
        if (index < 0) return false;
        this.rows.splice(index, 1);
        return true;
    }
}

const input = (overrides: Partial<BreakKindInput> = {}): BreakKindInput => ({
    key: 'poem',
    name: 'A poem',
    brief: 'Write two unrhymed lines about this moment on the station.',
    rules: [],
    showsPrevious: true,
    showsPlayed: false,
    showsFacts: true,
    showsNotebook: true,
    enabled: false,
    position: 0,
    ...overrides,
});

function setup(bands: Partial<ClockBandRecord>[] = []) {
    const kinds = new MemoryKinds();
    const tasks: (() => Promise<void>)[] = [];
    const afterCommit = { add: vi.fn((task: () => Promise<void>) => tasks.push(task)) } as unknown as AfterCommit;
    const writers = new BreakWriterRegistry([new Listed('talkbreak'), new Listed('news')], { warn: vi.fn() } as unknown as Logger);
    const catalog = new BreakKindCatalog(stubContainer([[BreakKindRepository, kinds]]).container);
    const clock = { list: vi.fn(async () => bands as ClockBandRecord[]) } as unknown as ClockBandRepository;
    const service = new BreakKindsService(kinds as unknown as BreakKindRepository, clock, writers, catalog, afterCommit, settingsConfig().config);
    const commit = async () => {
        for (const task of tasks.splice(0)) await task();
    };
    return { service, kinds, catalog, commit, afterCommit };
}

/** What a refused call threw, with its status and its sentence. */
async function refusal(call: Promise<unknown>): Promise<{ status?: number; message?: string }> {
    const error = (await call.then(
        () => undefined,
        (caught: unknown) => caught,
    )) as { statusCode?: number; status?: number; details?: { message?: string } } | undefined;
    expect(error).toBeDefined();
    return { status: error?.statusCode ?? error?.status, message: error?.details?.message };
}

describe('BreakKindsService.create', () => {
    it('writes a kind and answers the whole list', async () => {
        const { service } = setup();

        const list = await service.create(input());

        expect(list.kinds).toHaveLength(1);
        expect(list.kinds[0]).toMatchObject({ key: 'poem', name: 'A poem', enabled: false });
    });

    it('trims what the form sent and drops a blank rule rather than keeping an empty instruction', async () => {
        const { service } = setup();

        const list = await service.create(input({ key: ' poem ', name: ' A poem ', rules: ['  Two lines at most. ', '   ', ''] }));

        expect(list.kinds[0]).toMatchObject({ key: 'poem', name: 'A poem', rules: ['Two lines at most.'] });
    });

    it.each([
        ['talkbreak', 'a kind a listed writer claims'],
        ['news', 'another listed kind'],
        ['podcast', 'a kind the station produces as an episode'],
        ['syndicated', 'a kind the station carries'],
        ['narration', 'the other kind it carries'],
        ['ident', 'the kind every unlabelled recording is filed under'],
    ])('refuses "%s", %s', async key => {
        const { service, kinds } = setup();

        const { status, message } = await refusal(service.create(input({ key })));

        expect(status).toBe(409);
        expect(message).toContain(`"${key}"`);
        expect(kinds.rows).toHaveLength(0);
    });

    it('refuses a key the operator has already written', async () => {
        const { service } = setup();
        await service.create(input());

        const { status } = await refusal(service.create(input({ name: 'Another poem' })));

        expect(status).toBe(409);
    });

    it('reads the catalog again only once the write has committed', async () => {
        const { service, catalog, commit } = setup();
        await service.create(input({ enabled: true }));

        expect(catalog.keys()).toEqual([]);
        await commit();
        expect(catalog.keys()).toEqual(['poem']);
    });
});

describe('BreakKindsService.update', () => {
    it('rewrites everything but the key', async () => {
        const { service } = setup();
        const id = (await service.create(input())).kinds[0]!.id;

        const list = await service.update(id, input({ name: 'A short poem', enabled: true }));

        expect(list.kinds[0]).toMatchObject({ key: 'poem', name: 'A short poem', enabled: true });
    });

    it('refuses a new key, because the clock and every break it planted name the old one', async () => {
        const { service, kinds } = setup();
        const id = (await service.create(input())).kinds[0]!.id;

        const { status, message } = await refusal(service.update(id, input({ key: 'verse' })));

        expect(status).toBe(400);
        expect(message).toContain('"poem"');
        expect(kinds.rows[0]?.key).toBe('poem');
    });

    it('answers 404 for a kind the station does not have', async () => {
        const { service } = setup();

        expect((await refusal(service.update('nope', input()))).status).toBe(404);
    });

    it('takes a kind off the catalog once switching it off has committed', async () => {
        const { service, catalog, commit } = setup();
        const id = (await service.create(input({ enabled: true }))).kinds[0]!.id;
        await commit();

        await service.update(id, input({ enabled: false }));
        await commit();

        expect(catalog.keys()).toEqual([]);
    });
});

describe('BreakKindsService.remove', () => {
    it('removes a kind no band names', async () => {
        const { service } = setup([{ kind: 'talkbreak' }]);
        const id = (await service.create(input())).kinds[0]!.id;

        expect((await service.remove(id)).kinds).toEqual([]);
    });

    it('refuses while a band on the format clock still names it, and says how many', async () => {
        const { service, kinds } = setup([{ kind: 'poem' }, { kind: 'poem' }, { kind: 'news' }]);
        const id = (await service.create(input())).kinds[0]!.id;

        const { status, message } = await refusal(service.remove(id));

        expect(status).toBe(409);
        expect(message).toContain('2 bands');
        expect(kinds.rows).toHaveLength(1);
    });

    it('answers 404 for a kind the station does not have', async () => {
        const { service } = setup();

        expect((await refusal(service.remove('nope'))).status).toBe(404);
    });
});

describe('BreakKindCatalog', () => {
    it('holds only the kinds switched on, in the operator order', async () => {
        const { service, catalog, commit } = setup();
        await service.create(input({ key: 'verse', position: 2, enabled: true }));
        await service.create(input({ key: 'poem', position: 1, enabled: true }));
        await service.create(input({ key: 'draft', position: 0, enabled: false }));
        await commit();

        expect(catalog.keys()).toEqual(['poem', 'verse']);
        expect(catalog.kind('poem')?.brief).toContain('two unrhymed lines');
        expect(catalog.kind('draft')).toBeUndefined();
    });

    it('is empty before its first read', () => {
        const { catalog } = setup();

        expect(catalog.keys()).toEqual([]);
    });
});
