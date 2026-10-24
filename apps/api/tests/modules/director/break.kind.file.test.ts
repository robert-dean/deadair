import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import type { AfterCommit } from '../../../src/modules/data/after.commit.js';
import { BreakKindCatalog } from '../../../src/modules/director/break.kind.catalog.js';
import { BREAK_KIND_FILE_FORMAT, kindForFile, planImport } from '../../../src/modules/director/break.kind.file.js';
import { BreakKindFileService } from '../../../src/modules/director/break.kind.file.service.js';
import { BreakKindRepository } from '../../../src/modules/director/break.kind.repository.js';
import type { AuthoredKind, AuthoredKindDraft } from '../../../src/modules/director/break.kind.js';
import { BreakWriter, type BreakWriteRequest, type WrittenBreak } from '../../../src/modules/director/break.writer.js';
import { BreakWriterRegistry } from '../../../src/modules/director/break.writer.registry.js';
import type { BreakKindFile, BreakKindFileKind } from '../../../src/modules/director/types/break.kinds.types.js';
import type { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import { settingsConfig } from '../../utils/settings.config.js';
import { stubContainer } from '../../utils/stub.container.js';

/**
 * Kinds of break as a file (Ideas #24, phase 5). Two promises: what a preview says is what the import
 * does, because both run `planImport`; and nothing a file writes airs until it has been read back here,
 * because every kind it writes arrives switched off.
 */

const poem = (over: Partial<AuthoredKind> = {}): AuthoredKind => ({
    id: 'kind-1',
    key: 'poem',
    name: 'A poem about the moment',
    brief: 'Two unrhymed lines about this moment on the station.',
    rules: ['Two lines at most.'],
    showsPrevious: true,
    showsPlayed: false,
    showsFacts: true,
    showsNotebook: true,
    enabled: true,
    position: 0,
    ...over,
});

const inFile = (over: Partial<BreakKindFileKind> = {}): BreakKindFileKind => ({ ...kindForFile(poem()), ...over });

const file = (kinds: BreakKindFileKind[], over: Partial<BreakKindFile> = {}): BreakKindFile => ({
    format: BREAK_KIND_FILE_FORMAT,
    takenAt: '2026-10-24T12:00:00.000Z',
    station: 'elsewhere',
    kinds,
    ...over,
});

const ground = (held: AuthoredKind[] = [], replace: string[] = []) => ({ held, reserved: new Set(['talkbreak', 'news']), replace: new Set(replace) });

describe('planImport', () => {
    it('creates a kind nothing here holds', () => {
        const { plan } = planImport(file([inFile()]), ground());

        expect(plan.kinds).toEqual([{ key: 'poem', name: 'A poem about the moment', outcome: 'create', notices: [] }]);
        expect(plan.notices).toEqual([]);
    });

    it('skips a kind held here unless the operator named it, because a key match is not consent', () => {
        expect(planImport(file([inFile()]), ground([poem()])).plan.kinds[0]?.outcome).toBe('skip');
        expect(planImport(file([inFile()]), ground([poem()], ['poem'])).plan.kinds[0]?.outcome).toBe('update');
    });

    it('says a rewritten kind that is switched on here will be switched off', () => {
        const { plan } = planImport(file([inFile()]), ground([poem({ enabled: true })], ['poem']));

        expect(plan.kinds[0]?.notices.map(notice => notice.kind)).toEqual(['switched-off']);
    });

    it('refuses a key the station uses for a break of its own', () => {
        const { plan } = planImport(file([inFile({ key: 'talkbreak' })]), ground([], ['talkbreak']));

        expect(plan.kinds[0]).toMatchObject({ outcome: 'refuse', notices: [{ kind: 'refused' }] });
    });

    it('reads a key twice in one file once, and says so', () => {
        const { plan } = planImport(file([inFile(), inFile({ name: 'A second poem' })]), ground());

        expect(plan.kinds).toHaveLength(1);
        expect(plan.kinds[0]?.name).toBe('A poem about the moment');
        expect(plan.notices.map(notice => notice.kind)).toEqual(['duplicate']);
    });

    it('reads a file of another format and says what it was read as', () => {
        const { plan } = planImport(file([inFile()], { format: 'deadair.break-kinds/9' }), ground());

        expect(plan.format).toBe('deadair.break-kinds/9');
        expect(plan.notices.map(notice => notice.kind)).toEqual(['format']);
        expect(plan.kinds[0]?.outcome).toBe('create');
    });
});

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
}

class Listed extends BreakWriter {
    readonly name = 'stub';
    constructor(readonly kind: string) {
        super();
    }
    async write(_: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        return undefined;
    }
}

function station(held: AuthoredKind[] = []) {
    const kinds = new MemoryKinds();
    kinds.rows.push(...held);
    const tasks: (() => Promise<void>)[] = [];
    const afterCommit = { add: vi.fn((task: () => Promise<void>) => tasks.push(task)) } as unknown as AfterCommit;
    const writers = new BreakWriterRegistry([new Listed('talkbreak')], { warn: vi.fn() } as unknown as Logger);
    const catalog = new BreakKindCatalog(stubContainer([[BreakKindRepository, kinds]]).container);
    const service = new BreakKindFileService(kinds as unknown as BreakKindRepository, writers, catalog, afterCommit, settingsConfig().config, {
        stationKey: 'main',
    } as StationIdentity);
    const commit = async () => {
        for (const task of tasks.splice(0)) await task();
    };
    return { service, kinds, catalog, commit, afterCommit };
}

describe('BreakKindFileService', () => {
    it('exports every kind as one file, with no id, place or switch, and names the download', async () => {
        const { service } = station([poem(), poem({ id: 'kind-2', key: 'taping', name: 'Taping', position: 1 })]);

        const { body, headers } = await service.exportAll();

        expect(body.format).toBe(BREAK_KIND_FILE_FORMAT);
        expect(body.station).toBe('main');
        expect(body.kinds.map(kind => kind.key)).toEqual(['poem', 'taping']);
        expect(body.kinds[0]).not.toHaveProperty('id');
        expect(body.kinds[0]).not.toHaveProperty('enabled');
        expect(body.kinds[0]).not.toHaveProperty('position');
        expect(headers.contentDisposition).toMatch(/^attachment; filename="break-kinds-\d{4}-\d{2}-\d{2}\.json"$/);
    });

    it('exports one kind under its own key, and answers 404 for one it does not have', async () => {
        const { service } = station([poem()]);

        expect((await service.exportOne('kind-1')).headers.contentDisposition).toContain('filename="poem-');
        const missing = await service.exportOne('nope').then(
            () => undefined,
            (error: { statusCode?: number }) => error,
        );
        expect(missing?.statusCode).toBe(404);
    });

    it('previews without writing anything', async () => {
        const { service, kinds, afterCommit } = station();

        const plan = await service.preview(file([inFile()]), {});

        expect(plan.kinds[0]?.outcome).toBe('create');
        expect(kinds.rows).toHaveLength(0);
        expect(afterCommit.add).not.toHaveBeenCalled();
    });

    it('carries one station’s kinds to another, switched off and after what is already there', async () => {
        const here = station([poem({ enabled: true })]);
        const exported = (await here.service.exportAll()).body;
        const there = station([poem({ id: 'theirs', key: 'taping', name: 'Taping', position: 4, enabled: true })]);

        const result = await there.service.import(exported, {});

        expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
        const arrived = there.kinds.rows.find(kind => kind.key === 'poem');
        expect(arrived).toMatchObject({ enabled: false, position: 5, brief: poem().brief, rules: ['Two lines at most.'] });
    });

    it('rewrites a kind it was told to replace, keeping its id and place, and switches it off', async () => {
        const { service, kinds } = station([poem({ enabled: true, position: 3, brief: 'The old brief.' })]);

        const result = await service.import(file([inFile({ brief: 'The new brief.' })]), { replace: ['poem'] });

        expect(result).toMatchObject({ created: 0, updated: 1 });
        expect(kinds.rows).toEqual([expect.objectContaining({ id: 'kind-1', key: 'poem', brief: 'The new brief.', enabled: false, position: 3 })]);
    });

    it('leaves alone a kind it was not told to replace, and refuses a station kind', async () => {
        const { service, kinds, afterCommit } = station([poem({ brief: 'Mine.' })]);

        const result = await service.import(file([inFile({ brief: 'Theirs.' }), inFile({ key: 'talkbreak', name: 'A talk break' })]), {});

        expect(result).toMatchObject({ created: 0, updated: 0, skipped: 2 });
        expect(kinds.rows).toEqual([expect.objectContaining({ brief: 'Mine.' })]);
        expect(afterCommit.add).not.toHaveBeenCalled();
    });

    it('reads the catalog again once the import has committed, and the new kinds stay off it', async () => {
        const { service, catalog, commit } = station([poem({ enabled: true })]);

        await service.import(file([inFile({ key: 'taping', name: 'Taping' })]), {});
        await commit();

        expect(catalog.keys()).toEqual(['poem']);
    });
});
