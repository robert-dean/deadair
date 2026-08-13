import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { ProviderTrack } from '@deadair/plugin-sdk';
import { normalizeKey } from '#modules/catalog/catalog.keys.js';
import { asCatalogPlugin, type CatalogPlugin } from '#modules/plugins/plugin.capabilities.js';
import { pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * Finding a record at a provider when the catalog has never heard of it.
 *
 * The rung `docs/todo/director-and-lineups.md` scoped and deferred: the catalog is filled by walking
 * the connected account's PLAYLISTS, because that is the only enumeration a provider offers, so
 * everything outside those playlists is invisible to the library however well the provider knows it.
 * A model asked for heavy metal on a station whose playlists are ambient can name real, playable
 * records the catalog cannot match, and until this existed each one was dropped and the running
 * order quietly came up short.
 *
 * ## The model does not choose the copy
 *
 * A pick is a NAME, here as everywhere. The model never sees a provider id and never returns one,
 * so nothing it says can select a specific record: it names a title and an artist, and this asks the
 * providers what they have under that name. That keeps the whole ingest path out of reach of the
 * failure `set.prompt.ts` documents, where a real id in a prompt is echoed back as a choice.
 *
 * ## Strict, because the failure is silent
 *
 * A near-miss here does not produce an error, it airs the wrong record. Nobody watching the console
 * would know: the running order says what was asked for, and something else comes out of the
 * speakers. So both the title and the lead artist must match on `normalizeKey` — the same
 * normalization `deadair.tracks` is keyed by, so a match here means the same thing a catalog match
 * means — and everything else is refused. Duration only breaks a tie between candidates that already
 * matched, which is the one thing it is reliable for: a remaster and an album cut share a name, and
 * three seconds is the difference between them.
 *
 * A refusal costs one track from a batch that was oversampled for exactly this. A wrong match costs
 * the operator's trust in the running order.
 */

/**
 * How far two durations may differ and still be treated as equally good.
 *
 * Only ever a TIE-BREAK: everything being compared has already matched by name. Deliberately the
 * same figure `CatalogResolverRepository` uses for the same judgement, because "is this the same
 * recording" is one question and two answers to it would eventually disagree.
 */
const DURATION_TOLERANCE_MS = 3_000;

/** How many results to ask each provider for. Enough to get past a live version, not a listing. */
const PER_PROVIDER_LIMIT = 10;

/** A record found at a provider, and which plugin can serve it. */
export interface FoundCopy {
    pluginId: string;
    track: ProviderTrack;
}

@Injectable()
export class ProviderTrackLookup {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly logger: Logger,
    ) {}

    /**
     * Whether asking is worth anything at all right now.
     *
     * Cheap and synchronous, so a caller can skip the whole path on a station with no searchable
     * provider rather than discovering it one pick at a time.
     */
    canLookUp(): boolean {
        return this.searchable().length > 0;
    }

    /**
     * The best copy of one named record, or nothing.
     *
     * Providers are asked one at a time rather than concurrently, matching `CatalogSyncService`: the
     * upstreams are rate limited, this runs inside a background refill nobody is waiting on, and
     * fanning out would spend a plugin's whole budget on the first pick of a batch.
     *
     * @param preference - Plugin ids in the operator's order, used only to break a tie between two
     *   providers that both matched exactly.
     */
    async find(title: string, artist: string, preference: readonly string[] = []): Promise<FoundCopy | undefined> {
        const wantedTitle = normalizeKey(title);
        const wantedArtist = normalizeKey(artist);
        // A pick with no usable identity. `identify` would have failed on it too; refusing here
        // keeps a provider from being asked to search for an empty string.
        if (wantedTitle.length === 0 || wantedArtist.length === 0) return undefined;

        const matches: FoundCopy[] = [];
        for (const plugin of this.searchable()) {
            for (const track of await this.search(plugin, `${artist} ${title}`)) {
                // The LEAD artist, matching how every rotation key in this codebase is built and how
                // `PickResolver` keys the pick this is looking up. A credit line would match a
                // compilation's "Various Artists" against nothing useful.
                if (normalizeKey(track.title) !== wantedTitle) continue;
                if (normalizeKey(track.artists[0] ?? '') !== wantedArtist) continue;

                matches.push({ pluginId: plugin.record.id, track });
            }
        }

        if (matches.length === 0) {
            // Not a warning. A model naming a record no provider carries is a fact about the record,
            // and the caller treats a miss as one dropped pick out of an oversampled batch.
            this.logger.debug('director: no provider has a record that was chosen', { track: `${artist} — ${title}` });
            return undefined;
        }

        return this.best(matches, preference);
    }

    /**
     * The copy to take, out of the ones that matched by name.
     *
     * Two tie-breaks, in this order. The operator's provider preference first, because that is
     * somebody's decision about where the station's audio should come from and it beats anything
     * this could infer. Then the LONGEST duration among candidates that are not within tolerance of
     * each other, which picks the album version over a radio edit sharing its name — the fuller
     * record is the one somebody meant, and an edit that genuinely is the same recording falls
     * inside the tolerance and is decided by preference instead.
     */
    private best(matches: readonly FoundCopy[], preference: readonly string[]): FoundCopy {
        const rank = (match: FoundCopy): number => {
            const index = preference.indexOf(match.pluginId);
            return index < 0 ? preference.length : index;
        };

        return [...matches].sort((left, right) => {
            const byPreference = rank(left) - rank(right);
            if (byPreference !== 0) return byPreference;

            const leftMs = left.track.durationMs ?? 0;
            const rightMs = right.track.durationMs ?? 0;
            // Within tolerance is the same recording described twice, so leave the order alone and
            // let the earlier candidate win — stable rather than arbitrary between runs.
            if (Math.abs(leftMs - rightMs) <= DURATION_TOLERANCE_MS) return 0;
            return rightMs - leftMs;
        })[0]!;
    }

    /**
     * One provider's answer, with a failure flattened to none.
     *
     * A provider that is down costs its share of the candidates rather than the lookup, exactly as
     * in `CatalogSearchTool`: this runs inside a refill, and one dead upstream must not decide
     * whether a record the station could play from somewhere else gets found.
     */
    private async search(plugin: CatalogPlugin, query: string): Promise<ProviderTrack[]> {
        try {
            return await this.pluginInvoker.invoke(
                plugin.record.id,
                'director.lookupTrack',
                // Non-null because `searchable()` filtered on `searchesTracks`, which is the
                // declaration-and-implementation rule the rest of the host applies.
                async () => (await plugin.instance.searchTracks!(query, { limit: PER_PROVIDER_LIMIT })) ?? [],
            );
        } catch (error) {
            this.logger.info(`director: a provider could not be searched for a chosen record (${plugin.record.id}: ${errorText(error)})`);
            return [];
        }
    }

    /** Every plugin that can be asked for a track by name right now. */
    private searchable(): CatalogPlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asCatalogPlugin).filter(catalog => catalog.searchesTracks === true);
    }
}
