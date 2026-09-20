import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ArtStore } from '#modules/art/art.store.js';
import { SegmentStore } from '#modules/render/segment.store.js';
import { VoiceSampleStore } from '#modules/render/voice.sample.store.js';
import { TrackStore } from '#modules/playout/audio/track.store.js';
import { DEFAULT_TRACK_CACHE_MAX_BYTES, TRACK_CACHE_MAX_BYTES_KEY, resolveTrackCacheMaxBytes } from '#modules/playout/audio/track.cache.limit.js';
import type { StoredFile } from '#modules/shared/content.store.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import {
    DEFAULT_ORPHAN_GRACE_HOURS,
    DEFAULT_SWEEP_ORPHANS,
    ORPHAN_GRACE_HOURS_KEY,
    SWEEP_ORPHANS_KEY,
    resolveOrphanGraceHours,
    type StorageSweep,
} from './orphan.sweep.js';
import { StorageRepository, fileName, type StoredClaims } from './storage.repository.js';
import type { StorageReport, StorageStore, StorageStoreId } from './types/storage.types.js';

/**
 * How long one reading stands before the directories are walked again.
 *
 * A walk is real I/O — a station holding a library of records and a year of cover art has tens of
 * thousands of files — and this is a figure somebody may leave on screen. A minute is short enough
 * that an operator who just set a cap sees the sweep's effect on their second look, and long enough
 * that a page polling itself cannot turn a disk figure into disk load.
 *
 * The reading carries `readAt` so nothing has to guess whether it is live. That is the honest half
 * of caching a number: say when it was true.
 */
const FRESH_FOR_MS = 60 * 1000;

/**
 * The whole of what this service needs from a store: where it is, what is in it, and how to drop one.
 *
 * Structural rather than `ContentStore<Ext>`, because the four stores are each parameterised by
 * their own extensions and a common supertype would need a variance argument to buy nothing — the
 * three members it actually uses are the honest dependency.
 *
 * `remove` joined `list` when the sweep did. It is deliberately the store's own `remove` and not an
 * unlink, because that method resolves a checksum through `pathFor` and therefore can only ever
 * touch the store's own canonical `<root>/<first-2>/<checksum>.<ext>`. See {@link StorageService.sweep}
 * for the one place that matters most.
 */
interface Measurable {
    readonly root: string;
    list(): Promise<StoredFile[]>;
    remove(checksum: string, ext: string): Promise<boolean>;
}

/** A store as this service has to see it: a name, a place, and the bytes it is holding. */
interface Described {
    id: StorageStoreId;
    label: string;
    store: Measurable;
    /** What the database says about this store, or `undefined` for a store no table backs. */
    claims?: StoredClaims;
    capBytes?: number;
}

/**
 * What the station is using the disk for.
 *
 * ## Why this is its own module
 *
 * Because the question spans four subsystems and belongs to none of them. `art`, `render` and
 * `playout` each own a store and each is right not to know what the others are holding; a volume
 * filling up is a fact about the machine. So this reads all four rather than any of them growing a
 * method about disks in general.
 *
 * ## Reading never repairs, and repairing is its own thing that is off
 *
 * {@link readStorage} deletes nothing, ever. That half of the rule
 * [track-cache-eviction](https://github.com/robert-dean/deadair/discussions/46) set has not moved
 * and will not: a store that quietly deletes files while somebody is looking at a number is a bad
 * thing to debug.
 *
 * What HAS arrived is {@link sweep}, which is that discussion's own last open item rather than a
 * reversal of it. The condition it set was that the numbers have to exist before anything is allowed
 * to act on them, and it named the rule it was still missing — what a file with no row means when a
 * write was interrupted a second ago rather than a week ago. The numbers have existed since this
 * class shipped, `orphan.sweep.ts` is that rule, and the sweep is off until an operator turns it on.
 *
 * The two disagreements still mean different things — bytes with no row is a crash between writing a
 * file and writing its row, a row with no bytes is a directory somebody emptied — and only the first
 * is swept. The station already heals the second by re-fetching.
 */
@Injectable()
export class StorageService {
    /** The last reading and when it was taken. Shared by every caller inside {@link FRESH_FOR_MS}. */
    private cached?: { report: StorageReport; at: number };

    constructor(
        private readonly repository: StorageRepository,
        private readonly tracks: TrackStore,
        private readonly art: ArtStore,
        private readonly segments: SegmentStore,
        private readonly voices: VoiceSampleStore,
        private readonly config: AppConfig,
    ) {}

    async readStorage(): Promise<StorageReport> {
        if (this.cached !== undefined && Date.now() - this.cached.at < FRESH_FOR_MS) return this.cached.report;

        const report = await this.measure();
        this.cached = { report, at: Date.now() };

        return report;
    }

    /**
     * Delete every file no row claims and nothing is still writing.
     *
     * Off unless `storage.sweepOrphans` says otherwise, and a run with it off reads no directories
     * at all — the switch is checked before any I/O, so an install that never turns this on pays
     * nothing for its existence.
     *
     * ## Why deleting these is safe, stated once
     *
     * Every read of a content store starts from a row: the row holds the checksum and the checksum
     * IS the path. So a file whose row is gone cannot be reached by anything, ever, by any code
     * path — nothing is left that knows its name to ask for it. This is not eviction and there is no
     * judgement about worth involved. A file with a row is untouched however old it is.
     *
     * ## The four things that could go wrong, and what stops each
     *
     * **A write still in flight.** The bytes of a half-written file and the bytes of a real orphan
     * are identical, so only age separates them, and {@link resolveOrphanGraceHours} will not go
     * below an hour against a render that takes seconds.
     *
     * **A row written while this runs.** Files are listed BEFORE claims are read, which is the safe
     * order rather than the natural one: a row created between the two lands in the claims and
     * protects its file, where reading claims first would leave that same file looking unclaimed.
     * The grace period already covers this. The ordering costs nothing and means the guard does not
     * stand alone.
     *
     * **A file two rows share.** Content addressing makes identical audio one file — an ident at
     * three slots in an hour is one recording — which is the trap {@link ContentStore.remove} warns
     * about and refuses to solve itself. It is answered here by construction: `claims.names` is the
     * set of every name any row claims, so a file is an orphan only when NO row claims it.
     *
     * **The segment inbox, which lives inside the segment store's own root.** A recursive listing
     * sees it, and a file in it that happens to be named like a checksum would look unclaimed until
     * the next scan adopts it. It still cannot be deleted: `remove` resolves through `pathFor` and
     * so only ever unlinks `<root>/<first-2>/<checksum>.<ext>`, which is not where an inbox file
     * lives. That is why this goes through the store rather than unlinking what it listed, and it is
     * the ordering caveat `scripts/media.sweep.ts` has to ask an operator to honour by hand.
     *
     * The store with no claims at all is skipped outright. A voice preview is named after the
     * QUESTION it answers rather than by a row, so every file there is unclaimed by construction and
     * a sweep that treated it like the others would empty it on the first run.
     */
    async sweep(): Promise<StorageSweep> {
        if (!settingIsOn(this.config, SWEEP_ORPHANS_KEY, DEFAULT_SWEEP_ORPHANS)) return { ran: false, removed: 0, freedBytes: 0, heldBack: 0 };

        const graceHours = resolveOrphanGraceHours(this.config.get(ORPHAN_GRACE_HOURS_KEY, DEFAULT_ORPHAN_GRACE_HOURS));
        const cutoff = DateTime.now().minus({ hours: graceHours });

        let removed = 0;
        let freedBytes = 0;
        let heldBack = 0;

        for (const entry of this.sweepable()) {
            // Listed first, claimed second. See the ordering note above.
            const files = await entry.store.list();
            const claims = await entry.claims();

            // By name rather than by file, because one listing can show the same checksum twice —
            // the store's own copy and something under the inbox — and removing it is one act.
            const orphans = new Map<string, { checksum: string; ext: string; bytes: number }>();

            for (const file of files) {
                if (file.checksum === undefined || file.ext === undefined) continue;

                const named = fileName(file.checksum, file.ext);
                if (claims.names.has(named)) continue;

                if (file.modifiedAt > cutoff) {
                    heldBack += 1;
                    continue;
                }

                orphans.set(named, { checksum: file.checksum, ext: file.ext, bytes: file.bytes });
            }

            for (const orphan of orphans.values()) {
                // Counted on what actually went, not on what was chosen. `remove` answers false for
                // a file already gone and for one whose canonical path never held anything, and
                // neither is bytes this freed.
                if (!(await entry.store.remove(orphan.checksum, orphan.ext))) continue;

                removed += 1;
                freedBytes += orphan.bytes;
            }
        }

        // The reading on screen is now wrong by exactly what this did, and it is cached for a
        // minute. Drop it rather than letting an operator watch a stale orphan count.
        if (removed > 0) this.cached = undefined;

        return { ran: true, removed, freedBytes, heldBack };
    }

    /**
     * The stores a sweep may touch, each with the claims to check it against.
     *
     * Claims are a thunk rather than a value so the ordering above stays possible: each store's
     * listing has to happen before its own claims are read, and resolving all three up front — which
     * is what {@link measure} does, correctly, for a report that deletes nothing — would put every
     * read on the wrong side of every listing.
     */
    private sweepable(): { store: Measurable; claims: () => Promise<StoredClaims> }[] {
        return [
            { store: this.tracks, claims: async () => await this.repository.trackClaims() },
            { store: this.art, claims: async () => await this.repository.artClaims() },
            { store: this.segments, claims: async () => await this.repository.segmentClaims() },
        ];
    }

    private async measure(): Promise<StorageReport> {
        const [trackClaims, artClaims, segmentClaims] = await Promise.all([
            this.repository.trackClaims(),
            this.repository.artClaims(),
            this.repository.segmentClaims(),
        ]);

        const described: Described[] = [
            {
                id: 'tracks',
                label: "The station's own copies of records",
                store: this.tracks,
                claims: trackClaims,
                capBytes: resolveTrackCacheMaxBytes(this.config.get(TRACK_CACHE_MAX_BYTES_KEY, DEFAULT_TRACK_CACHE_MAX_BYTES)),
            },
            { id: 'art', label: 'Cover art', store: this.art, claims: artClaims },
            { id: 'segments', label: 'What the station has said', store: this.segments, claims: segmentClaims },
            // No claims at all, and that is the store's design rather than a gap: a voice sample is
            // named after the QUESTION it answers, so a hit is the file being there and nothing has
            // to remember a mapping. Every file here is therefore unclaimed by construction, which is
            // why it must not be reported as an orphan.
            { id: 'voices', label: 'Voice previews', store: this.voices },
        ];

        const stores = await Promise.all(described.map(async entry => this.describe(entry)));

        return {
            readAt: DateTime.now(),
            totalFiles: stores.reduce((total, store) => total + store.files, 0),
            totalBytes: stores.reduce((total, store) => total + store.bytes, 0),
            stores,
        };
    }

    /** One store's figures, from one walk of its directory and one read of what claims it. */
    private async describe(entry: Described): Promise<StorageStore> {
        const files = await entry.store.list();
        const bytes = files.reduce((total, file) => total + file.bytes, 0);

        const base = {
            id: entry.id,
            label: entry.label,
            path: entry.store.root,
            files: files.length,
            bytes,
            // Zero is "no limit", which the wire says by leaving the field out rather than by
            // sending a number a reader would have to know to interpret.
            ...(entry.capBytes ? { capBytes: entry.capBytes } : {}),
        };

        if (entry.claims === undefined) return { ...base, orphanFiles: 0, orphanBytes: 0, rowsWithNoFile: 0 };

        const orphans = this.unclaimed(files, entry.claims);
        const present = new Set(
            files.flatMap(file => (file.checksum === undefined || file.ext === undefined ? [] : [fileName(file.checksum, file.ext)])),
        );

        return {
            ...base,
            rows: entry.claims.rows,
            ...(entry.claims.bytes === undefined ? {} : { accountedBytes: entry.claims.bytes }),
            orphanFiles: orphans.files,
            orphanBytes: orphans.bytes,
            rowsWithNoFile: [...entry.claims.names].filter(name => !present.has(name)).length,
        };
    }

    /**
     * Files nothing in the database points at.
     *
     * A file this store did not name — an interrupted write's `.tmp-`, something dropped in by hand —
     * is unclaimed by definition and counts, because that is precisely the sort of thing a report
     * exists to surface.
     */
    private unclaimed(files: readonly StoredFile[], claims: StoredClaims): { files: number; bytes: number } {
        return files.reduce<{ files: number; bytes: number }>(
            (total, file) => {
                const named = file.checksum !== undefined && file.ext !== undefined ? fileName(file.checksum, file.ext) : undefined;
                if (named !== undefined && claims.names.has(named)) return total;

                return { files: total.files + 1, bytes: total.bytes + file.bytes };
            },
            { files: 0, bytes: 0 },
        );
    }
}
