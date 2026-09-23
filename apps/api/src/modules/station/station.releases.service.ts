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
 * visitors decided how often this station talks to the internet.
 */
@Injectable()
export class StationReleasesService {
    constructor(
        private readonly changelog: BundledChangelog,
        private readonly watch: ReleaseWatch,
    ) {}

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
        // A day rather than a moment, so it crosses as the ISO date it was read as. A Luxon value here
        // would be written by `JSON.stringify` as a UTC midnight, which is a timestamp and not a day.
        ...(entry.date === undefined ? {} : { date: entry.date }),
        notes: entry.notes,
        ...('url' in entry ? { url: entry.url } : {}),
    };
}
