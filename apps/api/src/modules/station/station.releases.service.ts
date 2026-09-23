import { Injectable } from 'injectkit';

import { BundledChangelog } from './station.changelog.js';
import type { StationReleases } from './types/station.types.js';

/**
 * What this build is, and what changed in each release it contains.
 *
 * Read from the changelog the image was built with rather than asked of GitHub, so a station with no
 * route to the internet can still say what it is running. That file is also the only honest answer to
 * "which release is this" on a build that follows `main`: the image's version label is stamped on a
 * release run alone, while every build carries the changelog entry of the last release merged before
 * it.
 */
@Injectable()
export class StationReleasesService {
    constructor(private readonly changelog: BundledChangelog) {}

    async read(): Promise<StationReleases> {
        const current = this.changelog.current;
        return {
            ...(current === undefined ? {} : { current }),
            notes: this.changelog.entries.map(entry => ({
                version: entry.version,
                // A day rather than a moment, so it crosses as the ISO date it was read as. A Luxon value
                // here would be written by `JSON.stringify` as a UTC midnight, which is a timestamp and
                // not a day, and the SDK's `yyyy-MM-dd` reader refuses it.
                ...(entry.date === undefined ? {} : { date: entry.date }),
                notes: entry.notes,
            })),
        };
    }
}
