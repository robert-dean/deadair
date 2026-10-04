import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { activeRules, blockedBy, compileRules, type CompiledRule } from './block.rules.js';
import { BlockRulesRepository } from './block.rules.repository.js';
import { CandidatesRepository } from './candidates.repository.js';
import { readClock } from './clock.bands.js';
import { stationZone } from './clock.words.js';
import type { StationMode } from './types/director.types.js';

/**
 * What a never-play rule is scoped against, beyond the clock: the broadcast a pick is for. A caller
 * that knows passes it; one that does not leaves a mode- or slot-scoped rule unjudged rather than
 * guessing, and every unscoped rule still holds.
 */
export interface PickBroadcast {
    mode?: StationMode;
    slotId?: string;
}

/**
 * Which records a never-play rule holding right now forbids, and which rule.
 *
 * One class so the two places that ask cannot disagree: `PickResolver`, which every pick from every
 * source passes through and which is the guarantee, and the model's music search, which narrows what
 * it shows so a model is not offered records the station will refuse. Ideas #22's rule that neither
 * is deletable because the other exists holds here as it does for a dislike.
 *
 * The rules are read and narrowed once per call and the tags only when some rule holds, so a station
 * with no rules pays one cheap read and nothing else. A record with no tags is forbidden by nothing.
 */
@Injectable()
export class NeverPlay {
    constructor(
        private readonly rules: BlockRulesRepository,
        private readonly candidates: CandidatesRepository,
        private readonly config: AppConfig,
    ) {}

    /** The rules holding right now for this broadcast. Empty is the ordinary answer: a station with no rules. */
    async holding(broadcast?: PickBroadcast): Promise<CompiledRule[]> {
        const now = Date.now();
        return activeRules(compileRules(await this.rules.list()), {
            clock: readClock(now, stationZone(this.config)),
            now,
            ...(broadcast?.mode === undefined ? {} : { mode: broadcast.mode }),
            ...(broadcast?.slotId === undefined ? {} : { slotId: broadcast.slotId }),
        });
    }

    /** Which of these tracks a rule holding now forbids, and which rule. */
    async blocked(trackIds: readonly string[], broadcast?: PickBroadcast): Promise<Map<string, CompiledRule>> {
        if (trackIds.length === 0) return new Map();
        return await this.blockedUnder(await this.holding(broadcast), trackIds);
    }

    /** {@link blocked} against rules a caller already narrowed, so it can decide what to fetch first. */
    async blockedUnder(rules: readonly CompiledRule[], trackIds: readonly string[]): Promise<Map<string, CompiledRule>> {
        const blocked = new Map<string, CompiledRule>();
        if (rules.length === 0 || trackIds.length === 0) return blocked;

        const tags = await this.candidates.tagsFor(trackIds);
        for (const trackId of trackIds) {
            const rule = blockedBy(rules, tags.get(trackId) ?? []);
            if (rule !== undefined) blocked.set(trackId, rule);
        }
        return blocked;
    }
}
