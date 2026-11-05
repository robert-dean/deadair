import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import type { ProfileTimeRange, ProviderArtist, ProviderPlay } from '@deadair/plugin-sdk';
import { Logger } from '@maroonedsoftware/logger';
import { DateTime } from 'luxon';

import { normalizeKey } from '#modules/catalog/catalog.keys.js';
import { PlayHistoryRepository } from '#modules/director/play.history.repository.js';
import { songKey } from '#modules/director/rotation.keys.js';
import { asProfilePlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { pluginsWith } from '#modules/plugins/plugin.selection.js';
import { inScope } from '#modules/shared/scoped.work.js';
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

/** How long a read of recent plays stands. What was on this morning moves faster than a ranking, and this is one call. */
export const RECENT_FRESH_MS = 60 * 60 * 1000;

/** How long after a failed read of recent plays before asking again. A connection without the grant fails until it is renewed. */
export const RECENT_RETRY_MS = 30 * 60 * 1000;

/** How far back a play still counts as recent. Plays are a count and not a window, so a quiet month would otherwise read as this morning. */
export const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * How long before a play an airing of the same song still accounts for it. Past the longest ordinary
 * record, because a provider may stamp a play when it ended, and the station airs a record a while
 * after it fetches it.
 */
export const AIRING_BEFORE_PLAY_MS = 30 * 60 * 1000;

/** How long after a play an airing of the same song still accounts for it: a provider may stamp when a play started, and a fetch comes first. */
export const AIRING_AFTER_PLAY_MS = 5 * 60 * 1000;

const PLAYS_ASKED = 50;
const RECENT_ARTISTS_KEPT = 15;

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

/** One airing, as much of it as telling a play from an airing needs. */
export interface Airing {
    songKey: string;
    /** Epoch millis. */
    airedAtMs: number;
}

/**
 * The plays the station's own airings do not account for.
 *
 * A source can report what the station aired as if the operator had played it: a scrobbling service
 * because the station scrobbles there, and a provider whose fetches count as plays. Left in, the lean
 * would feed on the station's own choices. Matched by song and not by provider id, so it holds for a
 * source that has never heard of the copy the station aired. The same song played an hour from any
 * airing of it is the operator's own, and stays.
 */
export function withoutAirings(plays: readonly ProviderPlay[], airings: readonly Airing[]): ProviderPlay[] {
    const bySong = new Map<string, number[]>();
    for (const airing of airings) {
        const times = bySong.get(airing.songKey);
        if (times) times.push(airing.airedAtMs);
        else bySong.set(airing.songKey, [airing.airedAtMs]);
    }

    return plays.filter(play => {
        const aired = bySong.get(songKey(play.track.title, play.track.artists));
        if (!aired) return true;

        const playedAtMs = Date.parse(play.playedAt);
        return !aired.some(airedAtMs => airedAtMs >= playedAtMs - AIRING_BEFORE_PLAY_MS && airedAtMs <= playedAtMs + AIRING_AFTER_PLAY_MS);
    });
}

/**
 * The lead artists of the plays inside {@link RECENT_WINDOW_MS}, most played first, ties by whoever
 * was on latest. A play with no artist or an unreadable time says nothing.
 */
export function foldRecent(plays: readonly ProviderPlay[], nowMs: number): string[] {
    const artists = new Map<string, { name: string; plays: number; latestMs: number }>();

    for (const play of plays) {
        const name = play.track.artists[0];
        const playedAtMs = Date.parse(play.playedAt);
        if (!name || !(playedAtMs >= nowMs - RECENT_WINDOW_MS)) continue;

        const key = normalizeKey(name);
        const seen = artists.get(key);
        if (seen) {
            seen.plays += 1;
            seen.latestMs = Math.max(seen.latestMs, playedAtMs);
        } else {
            artists.set(key, { name, plays: 1, latestMs: playedAtMs });
        }
    }

    return [...artists.values()]
        .sort((left, right) => right.plays - left.plays || right.latestMs - left.latestMs || left.name.localeCompare(right.name))
        .slice(0, RECENT_ARTISTS_KEPT)
        .map(artist => artist.name);
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
 *
 * ## Recent plays are their own read
 *
 * {@link recent} runs on its own clock so that asking every hour does not ask for rankings every hour,
 * and fails on its own so that a connection granted before the scope existed still has its rankings.
 * When the airings cannot be read, it says nothing rather than something unfiltered: that costs a
 * lean, where the alternative is the station leaning on itself.
 */
@Injectable()
export class ListeningProfileService {
    private kept?: ListeningProfile;
    private nextReadAt = 0;
    private reading?: Promise<void>;
    private keptRecent: string[] = [];
    private nextRecentAt = 0;
    private readingRecent?: Promise<void>;

    constructor(
        private readonly registry: PluginRegistry,
        private readonly invoker: PluginInvoker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
        private readonly container: Container,
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

    /** The artists the operator played in the last few days, most played first, the station's own airings left out. Empty when there is nothing to say. */
    async recent(): Promise<string[]> {
        if (!settingIsOn(this.config, LISTENING_PROFILE_KEY, LISTENING_PROFILE_DEFAULT)) return [];

        if (Date.now() >= this.nextRecentAt) {
            this.readingRecent ??= this.refreshRecent().finally(() => {
                this.readingRecent = undefined;
            });
            await this.readingRecent;
        }
        return this.keptRecent;
    }

    private async refreshRecent(): Promise<void> {
        const plugins = pluginsWith(this.registry.list(), asProfilePlugin).filter(plugin => plugin.instance.getRecentPlays !== undefined);
        if (plugins.length === 0) {
            this.keptRecent = [];
            return;
        }

        const answers = await Promise.allSettled(
            plugins.map(plugin =>
                this.invoker.invoke(plugin.record.id, 'profile.getRecentPlays', () => plugin.instance.getRecentPlays!({ limit: PLAYS_ASKED })),
            ),
        );
        const answered = answers.flatMap(answer => (answer.status === 'fulfilled' ? [answer.value] : []));

        if (answered.length === 0) {
            const reason = answers.find(answer => answer.status === 'rejected')?.reason;
            this.logger.warn(`listening profile: no provider said what was played recently; keeping what was known (${errorText(reason)})`);
            this.nextRecentAt = Date.now() + RECENT_RETRY_MS;
            return;
        }

        try {
            const nowMs = Date.now();
            const since = DateTime.fromMillis(nowMs - RECENT_WINDOW_MS - AIRING_BEFORE_PLAY_MS);
            const airings = await inScope(this.container, scope => scope.get(PlayHistoryRepository).airingsSince(since));
            const aired = airings.map(airing => ({ songKey: airing.songKey, airedAtMs: airing.airedAt.toMillis() }));

            const plays = answered.flat();
            const kept = withoutAirings(plays, aired);
            this.keptRecent = foldRecent(kept, nowMs);
            this.nextRecentAt = nowMs + RECENT_FRESH_MS;

            // Once an hour, and the evidence for the window: what was taken out as the station's own
            // airing, by name, since those are records the station aired and not the operator's listening.
            const removed = plays.filter(play => !kept.includes(play));
            this.logger.info(
                `listening profile: ${plays.length} recent plays, ${removed.length} left out as the station's own airings, ${this.keptRecent.length} artists kept`,
                { removed: removed.map(play => `${play.track.artists[0] ?? '?'} - ${play.track.title} @ ${play.playedAt}`) },
            );
        } catch (error) {
            this.logger.warn(`listening profile: could not read what the station aired, so recent plays say nothing for now (${errorText(error)})`);
            this.keptRecent = [];
            this.nextRecentAt = Date.now() + RECENT_RETRY_MS;
        }
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
