import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import type { ProfileTimeRange, ProviderArtist } from '@deadair/plugin-sdk';
import { Logger } from '@maroonedsoftware/logger';

import { asProfilePlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { pluginsWith } from '#modules/plugins/plugin.selection.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

/** Whether the station reads what the operator listens to elsewhere. */
export const LISTENING_PROFILE_KEY = 'llm.setListeningProfile';

/** ON: it costs two provider calls every few hours and only ever leans a model. */
export const LISTENING_PROFILE_DEFAULT = true;

/** How long an answer stands. A ranking over weeks does not move by the hour, and this account has spent its quota before. */
export const PROFILE_FRESH_MS = 6 * 60 * 60 * 1000;

/** How long after a failed read before asking again. Long enough that a refused read is not repeated every refill. */
export const PROFILE_RETRY_MS = 30 * 60 * 1000;

/** The windows read, nearest first, so what the account plays now outranks what it played all year. */
const WINDOWS: readonly ProfileTimeRange[] = ['short', 'medium'];

const ARTISTS_ASKED = 50;
const ARTISTS_KEPT = 30;
const GENRES_KEPT = 10;

/** Who the connected accounts listen to, most played first, and the styles those artists come under. */
export interface ListeningProfile {
    artists: string[];
    genres: string[];
}

/**
 * Folds rankings into one profile: first mention wins an artist's place, and a style ranks by how many
 * of the distinct artists carry it, ties by name so one answer always reads the same way.
 */
export function foldListening(rankings: readonly (readonly ProviderArtist[])[]): ListeningProfile {
    const seen = new Set<string>();
    const artists: string[] = [];
    const genreCounts = new Map<string, number>();

    for (const artist of rankings.flat()) {
        const key = artist.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        artists.push(artist.name);
        for (const genre of new Set(artist.genres ?? [])) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }

    const genres = [...genreCounts.entries()]
        .sort(([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName))
        .slice(0, GENRES_KEPT)
        .map(([genre]) => genre);
    return { artists: artists.slice(0, ARTISTS_KEPT), genres };
}

/**
 * What the operator listens to at their music providers, for a model to lean on.
 *
 * ## A singleton, and it remembers
 *
 * The other steers beside this one are read from the station's own database on every refill. This one
 * is a provider call, so it is kept in memory for {@link PROFILE_FRESH_MS}. Not stored: losing it to a
 * restart costs two calls, and nothing else ever needs it.
 *
 * ## It steers, and it never fails anybody
 *
 * {@link read} does not throw, and a read that fails keeps the last good answer. Dislikes are
 * `PickResolver`'s to enforce whatever this says. A refusal is `forbidden`, which the invoker does not
 * count against the plugin, so an account without the grant costs this steer and nothing about its
 * library.
 */
@Injectable()
export class ListeningProfileService {
    private kept?: ListeningProfile;
    private nextReadAt = 0;
    private reading?: Promise<void>;

    constructor(
        private readonly registry: PluginRegistry,
        private readonly invoker: PluginInvoker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** The profile, or `undefined` when it is switched off or there is nothing to say. */
    async read(): Promise<ListeningProfile | undefined> {
        if (!settingIsOn(this.config, LISTENING_PROFILE_KEY, LISTENING_PROFILE_DEFAULT)) return undefined;

        if (Date.now() >= this.nextReadAt) {
            // One read however many callers arrive during it.
            this.reading ??= this.refresh().finally(() => {
                this.reading = undefined;
            });
            await this.reading;
        }
        return this.kept;
    }

    private async refresh(): Promise<void> {
        const plugins = pluginsWith(this.registry.list(), asProfilePlugin);
        // Nobody to ask costs nothing, so a plugin enabled a minute from now is asked a minute from now.
        if (plugins.length === 0) {
            this.kept = undefined;
            return;
        }

        const asked = plugins.flatMap(plugin =>
            WINDOWS.map(window =>
                this.invoker.invoke(plugin.record.id, 'profile.getTopArtists', () =>
                    plugin.instance.getTopArtists!(window, { limit: ARTISTS_ASKED }),
                ),
            ),
        );
        const answers = await Promise.allSettled(asked);
        const rankings = answers.flatMap(answer => (answer.status === 'fulfilled' ? [answer.value] : []));

        if (rankings.length === 0) {
            const reason = answers.find(answer => answer.status === 'rejected')?.reason;
            this.logger.warn(`listening profile: no provider answered; keeping what was known (${errorText(reason)})`);
            this.nextReadAt = Date.now() + PROFILE_RETRY_MS;
            return;
        }

        const folded = foldListening(rankings);
        this.kept = folded.artists.length > 0 ? folded : undefined;
        this.nextReadAt = Date.now() + PROFILE_FRESH_MS;
    }
}
