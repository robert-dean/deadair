import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';

import { BundledChangelog, type ChangelogEntry } from './station.changelog.js';
import { ReleaseWatch, type AvailableRelease } from './station.release.watch.js';
import type { StationRelease, StationReleases } from './types/station.types.js';

/**
 * What this build is, what changed in each release it contains, and what has come out since.
 *
 * The first two are read from the changelog the image was built with rather than asked of GitHub, so a
 * station with no route to the internet can still say what it is running. That file is also the only
 * honest answer to "which release is this" on a build that follows `main`: the image's version label is
 * stamped on a release run alone, while every build carries the changelog entry of the last release
 * merged before it.
 *
 * The third is whatever `ReleaseWatch` last heard. Reading it never asks GitHub anything: the request
 * belongs to the watch's own schedule, and a page that sent one per visit would be a page whose
 * visitors decided how often this station talks to the internet. `check` is the exception, and it is
 * an operator's action behind its own gate rather than a side effect of looking.
 */
@Injectable()
export class StationReleasesService {
    constructor(
        private readonly changelog: BundledChangelog,
        private readonly watch: ReleaseWatch,
    ) {}

    /**
     * Asks GitHub now, then answers what the station knows. The operator's Check now.
     *
     * The one path here that sends a request, and it does so only because somebody pressed the
     * button. The watch keeps its own rules: nothing while the switch is off, and nothing within a
     * minute of the last question.
     */
    async check(): Promise<StationReleases> {
        await this.watch.checkNow();
        return this.read();
    }

    async read(): Promise<StationReleases> {
        const current = this.changelog.current;
        const reading = this.watch.reading();
        return {
            ...(current === undefined ? {} : { current }),
            notes: this.changelog.entries.map(toRelease),
            checks: reading.enabled,
            ...(reading.checkedAt === undefined ? {} : { checkedAt: DateTime.fromMillis(reading.checkedAt, { zone: 'utc' }) }),
            available: reading.newer.map(toRelease),
        };
    }
}

function toRelease(entry: ChangelogEntry | AvailableRelease): StationRelease {
    return {
        version: entry.version,
        // In UTC, so the router writes back the same day it was read as whatever zone the process
        // runs in.
        ...(entry.date === undefined ? {} : { date: DateTime.fromISO(entry.date, { zone: 'utc' }) }),
        notes: entry.notes,
        ...('url' in entry ? { url: entry.url } : {}),
    };
}
