import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { AfterCommit } from '#modules/data/after.commit.js';
import { NARRATION_KIND } from '#modules/narrations/narration.kind.js';
import { SYNDICATED_KIND } from '#modules/podcasts/syndicated.kind.js';
import { productionKinds } from '#modules/productions/production.scheduler.js';
import { DEFAULT_KIND } from '#modules/render/segment.library.js';
import { BreakKindCatalog } from './break.kind.catalog.js';
import { BreakKindRepository } from './break.kind.repository.js';
import { BreakWriterRegistry } from './break.writer.registry.js';
import { ClockBandRepository } from './clock.band.repository.js';
import type { AuthoredKindDraft } from './break.kind.js';
import type { BreakKindInput, BreakKindList } from './types/break.kinds.types.js';

/**
 * The kinds of break an operator writes, as the console edits them. Ideas #24.
 *
 * The console's half of {@link BreakKindRepository}, and the one place that decides what a key may
 * be. Two refusals are the whole of its judgement, and both protect something already on the air:
 *
 * - **A key the station already uses is refused.** One a listed writer claims (`talkbreak`, `news`),
 *   one the station produces as an episode or carries from somebody else, or `ident`, which every
 *   recording without a kind of its own is filed under. The registry would ignore the claim anyway
 *   (`BreakKindClaimant`), so this is about the operator being told at the form rather than finding a
 *   kind that silently never airs.
 * - **A key cannot change, and a kind a clock band names cannot be deleted.** The key is what the band
 *   asks for and what every break it planted carries, so either would leave a band asking for a kind
 *   nothing writes. The band is the operator's to remove first, on purpose: that is the edit they can
 *   see the consequence of.
 *
 * Every write refreshes {@link BreakKindCatalog} once it has committed, never before: the catalog
 * reads on a connection of its own and would otherwise see the table as it stood before the write.
 *
 * ## Every answer is the whole list
 *
 * The call the clock and the topics make, for their reason.
 */
@Injectable()
export class BreakKindsService {
    constructor(
        private readonly kinds: BreakKindRepository,
        private readonly bands: ClockBandRepository,
        private readonly writers: BreakWriterRegistry,
        private readonly catalog: BreakKindCatalog,
        private readonly afterCommit: AfterCommit,
        private readonly config: AppConfig,
    ) {}

    async list(): Promise<BreakKindList> {
        return { kinds: await this.kinds.list() };
    }

    async create(input: BreakKindInput): Promise<BreakKindList> {
        const draft = draftOf(input);
        const taken = this.stationKinds();
        if (taken.has(draft.key)) {
            throw httpError(409).withDetails({ message: `"${draft.key}" is a kind of break the station already makes. Choose another key` });
        }
        if ((await this.kinds.list()).some(kind => kind.key === draft.key)) {
            throw httpError(409).withDetails({ message: `you have already written a kind of break called "${draft.key}"` });
        }

        await this.kinds.create(draft);
        this.refreshAfterCommit();
        return await this.list();
    }

    async update(id: string, input: BreakKindInput): Promise<BreakKindList> {
        const held = await this.kinds.get(id);
        if (held === undefined) throw httpError(404).withDetails({ message: `break kind "${id}" does not exist` });

        const draft = draftOf(input);
        if (draft.key !== held.key) {
            throw httpError(400).withDetails({
                message: `a kind's key cannot change, because the format clock and every break it planted name it as "${held.key}"`,
            });
        }

        await this.kinds.update(id, draft);
        this.refreshAfterCommit();
        return await this.list();
    }

    async remove(id: string): Promise<BreakKindList> {
        const held = await this.kinds.get(id);
        if (held === undefined) throw httpError(404).withDetails({ message: `break kind "${id}" does not exist` });

        const naming = (await this.bands.list()).filter(band => band.kind === held.key);
        if (naming.length > 0) {
            throw httpError(409).withDetails({
                message: `${naming.length === 1 ? 'a band' : `${naming.length} bands`} on the format clock still ${naming.length === 1 ? 'names' : 'name'} "${held.key}". Remove ${naming.length === 1 ? 'it' : 'them'} first`,
            });
        }

        await this.kinds.remove(id);
        this.refreshAfterCommit();
        return await this.list();
    }

    private stationKinds(): Set<string> {
        return stationMadeKinds(this.writers, this.config);
    }

    private refreshAfterCommit(): void {
        this.afterCommit.add(() => this.catalog.refresh());
    }
}

/**
 * Every kind the station makes on its own: what its listed writers claim, what it produces or
 * carries, and the kind every unlabelled recording is filed under. What no kind an operator writes,
 * or imports, may be called.
 */
export function stationMadeKinds(writers: BreakWriterRegistry, config: AppConfig): Set<string> {
    return new Set([...writers.listedKinds(), ...productionKinds(config), SYNDICATED_KIND, NARRATION_KIND, DEFAULT_KIND]);
}

/** A kind as the form sent it, trimmed, with blank rules dropped rather than kept as empty instructions. */
function draftOf(input: BreakKindInput): AuthoredKindDraft {
    return {
        key: input.key.trim(),
        name: input.name.trim(),
        brief: input.brief.trim(),
        rules: input.rules.map(rule => rule.trim()).filter(rule => rule.length > 0),
        showsPrevious: input.showsPrevious,
        showsPlayed: input.showsPlayed,
        showsFacts: input.showsFacts,
        showsNotebook: input.showsNotebook,
        enabled: input.enabled,
        position: input.position,
    };
}
