import { Injectable } from 'injectkit';
import { CatalogResolverRepository } from '#modules/catalog/ingest/catalog.resolver.repository.js';
import type { NewPlaylistRow, PlaylistSnapshot } from './station.playlists.repository.js';
import type { PlaylistImportEntry, PlaylistImportPlan } from './types/station.playlists.types.js';

/**
 * The most records one import takes.
 *
 * Every entry costs up to three catalog reads inside the request, so this bounds how long an operator
 * waits on a preview. Beyond it the source is cut rather than refused, and the plan says so: a long
 * list is a real thing to want, and its first thousand records are still a playlist.
 */
export const MAX_IMPORT_ENTRIES = 1000;

/** One record a source names, before anything has asked the library about it. */
export interface PlaylistImportEntryInput extends PlaylistSnapshot {
    /** The provider's copy this record was read from, when the source was a provider's. */
    origin?: { pluginId: string; externalId: string };
}

/** A source read into the terms every source shares. */
export interface PlaylistImportEntrySource {
    name: string;
    prompt: string;
    entries: PlaylistImportEntryInput[];
    /** Lines of the source that named no record at all. */
    skipped: number;
    notices: string[];
    /** The plugin the whole source was cloned from, for the playlist's badge. */
    originPluginId?: string;
}

/** A plan, and the rows importing it would write, decided together so the two cannot disagree. */
export interface PlannedImport {
    plan: PlaylistImportPlan;
    rows: NewPlaylistRow[];
}

/**
 * Decides what a source would become here, for the preview and the import alike.
 *
 * One planner behind two verbs, on the persona import's rule: the preview is the decision rather than
 * a forecast of it, because the import runs this same code on the same source.
 *
 * It only ever LOOKS. The library is asked whether it holds each record, by the provider copy first
 * when the source names one (an exact answer to an exact question) and then by the resolver's own
 * keys, which are the ones `PickResolver` and the play history already agree on. Nothing is
 * searched for at a provider and nothing is ingested: a preview an operator is waiting on must not
 * cost a search per miss, and a record found here is one the station already has.
 */
@Injectable()
export class PlaylistImportPlanner {
    constructor(private readonly resolver: CatalogResolverRepository) {}

    async plan(source: PlaylistImportEntrySource, name?: string): Promise<PlannedImport> {
        const notices = [...source.notices];
        let entries = source.entries;
        if (entries.length > MAX_IMPORT_ENTRIES) {
            notices.push(`this source names ${entries.length} records, and an import takes the first ${MAX_IMPORT_ENTRIES}`);
            entries = entries.slice(0, MAX_IMPORT_ENTRIES);
        }

        const planned: PlaylistImportEntry[] = [];
        const rows: NewPlaylistRow[] = [];

        for (const [position, entry] of entries.entries()) {
            const trackId = await this.find(entry);
            const described = { position, title: entry.title, artists: entry.artists };

            if (trackId !== undefined) {
                planned.push({ ...described, outcome: 'matched', trackId });
                rows.push({ trackId });
                continue;
            }

            planned.push({ ...described, outcome: entry.origin === undefined ? 'toLookUp' : 'toAdd' });
            rows.push({ snapshot: snapshotOf(entry), ...(entry.origin === undefined ? {} : { origin: entry.origin }) });
        }

        if (entries.length === 0) notices.push('this source names no records, so the playlist would be empty');

        return {
            plan: {
                name: name ?? source.name,
                matched: planned.filter(entry => entry.outcome === 'matched').length,
                toAdd: planned.filter(entry => entry.outcome === 'toAdd').length,
                toLookUp: planned.filter(entry => entry.outcome === 'toLookUp').length,
                skipped: source.skipped,
                entries: planned,
                notices,
            },
            rows,
        };
    }

    private async find(entry: PlaylistImportEntryInput): Promise<string | undefined> {
        if (entry.origin !== undefined) {
            const bound = await this.resolver.findTrackSource(entry.origin.pluginId, entry.origin.externalId);
            if (bound !== undefined) return bound;
        }
        return this.resolver.findTrack(snapshotOf(entry));
    }
}

/** What a placeholder keeps of an entry: the description, and nothing about where it came from. */
function snapshotOf(entry: PlaylistImportEntryInput): PlaylistSnapshot {
    return {
        title: entry.title,
        artists: entry.artists,
        ...(entry.album === undefined ? {} : { album: entry.album }),
        ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
        ...(entry.isrc === undefined ? {} : { isrc: entry.isrc }),
    };
}
