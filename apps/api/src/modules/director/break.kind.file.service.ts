import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { AfterCommit } from '#modules/data/after.commit.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { BreakKindCatalog } from './break.kind.catalog.js';
import { BREAK_KIND_FILE_FORMAT, kindForFile, planImport } from './break.kind.file.js';
import { BreakKindRepository } from './break.kind.repository.js';
import { stationMadeKinds } from './break.kinds.service.js';
import { BreakWriterRegistry } from './break.writer.registry.js';
import type { AuthoredKind } from './break.kind.js';
import type { BreakKindFile, BreakKindImportPlan, BreakKindImportResult } from './types/break.kinds.types.js';

/** What the router hands over from the query. */
interface ReplaceQuery {
    replace?: string[];
}

/**
 * The kinds of break an operator writes, out to a file and in from one. See `break.kind.file.ts` for
 * what a file carries and leaves out.
 *
 * The import is all or nothing because it runs inside the request's transaction: a file that landed
 * half way would be the one outcome the preview never described. The catalog is read again only once
 * that transaction has committed, as every write to these rows does it.
 */
@Injectable()
export class BreakKindFileService {
    constructor(
        private readonly kinds: BreakKindRepository,
        private readonly writers: BreakWriterRegistry,
        private readonly catalog: BreakKindCatalog,
        private readonly afterCommit: AfterCommit,
        private readonly config: AppConfig,
        private readonly station: StationIdentity,
    ) {}

    async exportAll(): Promise<{ body: BreakKindFile; headers: { contentDisposition: string } }> {
        return this.answer(await this.kinds.list(), 'break-kinds');
    }

    async exportOne(id: string): Promise<{ body: BreakKindFile; headers: { contentDisposition: string } }> {
        const kind = await this.kinds.get(id);
        if (kind === undefined) throw httpError(404).withDetails({ message: `break kind "${id}" does not exist` });

        return this.answer([kind], kind.key);
    }

    async preview(file: BreakKindFile, query: ReplaceQuery): Promise<BreakKindImportPlan> {
        return (await this.plan(file, query)).plan;
    }

    async import(file: BreakKindFile, query: ReplaceQuery): Promise<BreakKindImportResult> {
        const { plan, kinds } = await this.plan(file, query);

        let created = 0;
        let updated = 0;
        // After the last one already here, in the file's own order.
        let position = Math.max(-1, ...(await this.kinds.list()).map(kind => kind.position)) + 1;
        for (const planned of kinds) {
            // Switched off whichever way it is written: see `break.kind.file.ts`.
            const draft = { ...planned.kind, enabled: false };

            if (planned.entry.outcome === 'create') {
                await this.kinds.create({ ...draft, position: position++ });
                created += 1;
            } else if (planned.entry.outcome === 'update' && planned.held !== undefined) {
                await this.kinds.update(planned.held.id, { ...draft, key: planned.held.key, position: planned.held.position });
                updated += 1;
            }
        }

        if (created + updated > 0) this.afterCommit.add(() => this.catalog.refresh());

        return { plan, created, updated, skipped: kinds.length - created - updated, kinds: await this.kinds.list() };
    }

    private async plan(file: BreakKindFile, query: ReplaceQuery) {
        return planImport(file, {
            held: await this.kinds.list(),
            reserved: stationMadeKinds(this.writers, this.config),
            replace: new Set((query.replace ?? []).map(key => key.trim())),
        });
    }

    private answer(kinds: readonly AuthoredKind[], name: string): { body: BreakKindFile; headers: { contentDisposition: string } } {
        const takenAt = DateTime.utc();

        return {
            body: { format: BREAK_KIND_FILE_FORMAT, takenAt: takenAt.toISO(), station: this.station.stationKey, kinds: kinds.map(kindForFile) },
            headers: { contentDisposition: `attachment; filename="${name}-${takenAt.toFormat('yyyy-LL-dd')}.json"` },
        };
    }
}
