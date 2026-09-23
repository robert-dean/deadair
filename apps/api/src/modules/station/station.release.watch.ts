import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { settingIsOn } from '#modules/shared/setting.flags.js';
import { BuildRevision } from '#modules/shared/build.revision.js';
import { errorText } from '#modules/shared/error.text.js';
import { BundledChangelog, compareVersions, type ChangelogEntry } from './station.changelog.js';

export const RELEASE_KEYS = {
    checkForUpdates: 'station.checkForUpdates',
} as const;

/**
 * On, with a switch to turn it off. The request is anonymous and asks only for the repository's public
 * releases, and an operator who never hears that a fix exists is the station staying broken in a way
 * they already could have undone.
 */
export const CHECK_FOR_UPDATES_DEFAULT = true;

/**
 * The repository's newest releases, bodies included, in one request.
 *
 * The RELEASES rather than the tags, which is the opposite of the desktop app's choice and for the
 * same reason read from the other side. The desktop's releases are outnumbered by the station's
 * several to one, so a page of releases stops reaching them; the station's are the ones doing the
 * outnumbering, so the first page always holds its newest, and holds each one's notes, which the tags
 * would need a second request per release to fetch. The Stream Deck and listener releases on the same
 * page are told apart by their tag prefix.
 */
export const RELEASES_ENDPOINT = 'https://api.github.com/repos/robert-dean/deadair/releases?per_page=30';

/**
 * How long a successful answer is trusted before GitHub is asked again.
 *
 * Six hours, which is four requests a day against an unauthenticated allowance of sixty an HOUR per
 * address. Releases go out several a day at most, so an operator hears about one the same day, and
 * nothing about this is urgent enough to ask more often.
 */
export const CHECK_EVERY_MS = 6 * 60 * 60_000;

/**
 * How soon after the last question to GitHub an operator's Check now may ask again.
 *
 * A minute. The button skips the six-hour window, which is what it is for, but GitHub allows sixty
 * unauthenticated requests an hour for the whole ADDRESS, and a station behind a home router shares
 * that address with everything else on the network. A click inside the minute gets the answer the
 * last question got, which is at most a minute old.
 */
export const CHECK_NOW_FLOOR_MS = 60_000;

/** Long enough for a slow link, short enough that a hung connection does not hold a job worker. */
const CHECK_TIMEOUT_MS = 15_000;

/** The contract's ceiling on one release's notes. A body past it is cut rather than refused. */
const NOTES_MAX = 40_000;

const STATION_TAG = /^v(\d+\.\d+\.\d+)$/;

/** A release newer than this build, with the page that describes it. */
export interface AvailableRelease extends ChangelogEntry {
    url: string;
}

/** What the watch last learned, as the read path hands it on. */
export interface ReleaseReading {
    /** Whether the operator has the check switched on. */
    enabled: boolean;
    /** When GitHub last answered, in epoch milliseconds. Absent until it has. */
    checkedAt?: number;
    /** Every station release newer than this build, newest first. */
    newer: readonly AvailableRelease[];
}

/**
 * The station releases in a GitHub releases answer that are newer than `current`, newest first.
 *
 * Pure over the parsed body, so the shapes GitHub can hand back are tested without a network. Anything
 * that is not a published, final station release is skipped: a draft or a prerelease is not something
 * to tell an operator to go and install, and a `streamdeck-v` or `desktop-v` tag is another product.
 * An answer that is not a list at all is no releases rather than an error, because the caller treats
 * both the same way.
 */
export function newerReleases(body: unknown, current: string): AvailableRelease[] {
    if (!Array.isArray(body)) return [];

    const found: AvailableRelease[] = [];
    for (const item of body as unknown[]) {
        if (typeof item !== 'object' || item === null) continue;
        const release = item as Record<string, unknown>;
        if (release['draft'] === true || release['prerelease'] === true) continue;

        const tag = typeof release['tag_name'] === 'string' ? release['tag_name'] : '';
        const match = STATION_TAG.exec(tag);
        if (match === null) continue;
        const version = match[1]!;
        if (compareVersions(version, current) <= 0) continue;

        const published = typeof release['published_at'] === 'string' ? release['published_at'].slice(0, 10) : '';
        const notes = typeof release['body'] === 'string' ? release['body'].trim().slice(0, NOTES_MAX) : '';

        found.push({
            version,
            ...(/^\d{4}-\d{2}-\d{2}$/.test(published) ? { date: published } : {}),
            notes,
            url: releasePage(release['html_url'], tag),
        });
    }

    return found.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * The release's own page, when GitHub named one on github.com, and the page its tag would have
 * otherwise. The link is drawn in the console, so a URL from the answer that is not a GitHub page is
 * not handed on.
 */
function releasePage(named: unknown, tag: string): string {
    if (typeof named === 'string' && named.startsWith('https://github.com/robert-dean/deadair/releases/')) return named;
    return `https://github.com/robert-dean/deadair/releases/tag/${encodeURIComponent(tag)}`;
}

/**
 * Whether a newer station release exists, asked of GitHub now and then and remembered in between.
 *
 * ## Which release this is
 *
 * Read off the changelog the build carries rather than off the image's version label. The label is
 * stamped on a release run alone, so a station following `latest` has none, while every build carries
 * the changelog entry of the last release merged before it: that heading is the newest release the
 * build CONTAINS, which is exactly the question "is there anything newer". The label is the fallback
 * for a build with no changelog; a build with neither has no answer, and asks nothing.
 *
 * ## What it sends, and when
 *
 * One anonymous GET for the repository's public releases, with no token, no station name, no version
 * and nothing about the listeners. Only when the operator's switch is on: off, it sends nothing and
 * the read path answers nothing, the moment the switch is saved rather than at the next check.
 *
 * ## Every failure is quiet
 *
 * An update notice is a convenience, and a GitHub that is down, rate-limiting or unreachable from a
 * station with no internet must never be something the station reports as a fault. A failure writes
 * one log line and keeps whatever the last good answer was, which is still true: a release that
 * existed an hour ago has not stopped existing. The next hourly run is the retry.
 *
 * In memory rather than in a table, because it is a cache of somebody else's answer and a restart
 * asks again anyway.
 */
export class ReleaseWatch {
    private newer: readonly AvailableRelease[] = [];
    private checkedAt?: number;
    /** When GitHub was last asked, answered or not. What the Check now floor is measured from. */
    private askedAt?: number;
    private inFlight?: Promise<void>;

    constructor(
        private readonly config: AppConfig,
        private readonly changelog: BundledChangelog,
        private readonly revision: BuildRevision,
        private readonly logger: Logger,
        private readonly fetcher: typeof fetch = fetch,
        private readonly now: () => number = Date.now,
    ) {}

    /** The last answer, or nothing when the switch is off. Never asks GitHub. */
    reading(): ReleaseReading {
        if (!this.enabled()) return { enabled: false, newer: [] };
        return { enabled: true, ...(this.checkedAt === undefined ? {} : { checkedAt: this.checkedAt }), newer: this.newer };
    }

    /**
     * Asks GitHub, if the switch is on and the last answer is old enough. Never throws.
     *
     * Two callers at once share one request: the boot check and the first hourly run can meet on a
     * station that booted near the top of the hour.
     */
    async check(): Promise<void> {
        if (!this.enabled()) {
            // Forget, so a switch turned back on later asks afresh rather than showing a stale answer.
            this.newer = [];
            this.checkedAt = undefined;
            return;
        }
        if (this.checkedAt !== undefined && this.now() - this.checkedAt < CHECK_EVERY_MS) return;

        await this.askOnce();
    }

    /**
     * Asks GitHub now, whatever the six-hour window says: the operator's Check now. Never throws.
     *
     * Still nothing while the switch is off, and nothing within {@link CHECK_NOW_FLOOR_MS} of the last
     * question, when it waits for that one if it is still running and otherwise leaves the answer as
     * it stands. A failure keeps the last good answer, as a scheduled check's does.
     */
    async checkNow(): Promise<void> {
        if (!this.enabled()) return;
        if (this.inFlight === undefined && this.askedAt !== undefined && this.now() - this.askedAt < CHECK_NOW_FLOOR_MS) return;

        await this.askOnce();
    }

    /** One request at a time: a second caller while one is running waits for that one. */
    private async askOnce(): Promise<void> {
        this.inFlight ??= this.ask().finally(() => {
            this.inFlight = undefined;
        });
        await this.inFlight;
    }

    private async ask(): Promise<void> {
        const current = this.changelog.current ?? this.revision.version;
        if (current === undefined) {
            this.logger.debug('releases: this build does not know which release it is, so nothing was asked');
            return;
        }

        this.askedAt = this.now();
        try {
            const response = await this.fetcher(RELEASES_ENDPOINT, {
                headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'deadair' },
                signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
            });
            if (!response.ok) {
                this.logger.info(`releases: GitHub answered ${response.status}, so the last answer stands`);
                return;
            }

            const newer = newerReleases(await response.json(), current);
            const first = newer[0];
            if (first !== undefined && first.version !== this.newer[0]?.version) {
                this.logger.info(`releases: deadair ${first.version} is available (this station contains ${current})`);
            }
            this.newer = newer;
            this.checkedAt = this.now();
        } catch (error) {
            this.logger.info(`releases: could not ask GitHub (${errorText(error)}), so the last answer stands`);
        }
    }

    private enabled(): boolean {
        return settingIsOn(this.config, RELEASE_KEYS.checkForUpdates, CHECK_FOR_UPDATES_DEFAULT);
    }
}
