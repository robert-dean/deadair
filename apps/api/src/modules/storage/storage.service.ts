import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ArtStore } from '#modules/art/art.store.js';
import { SegmentStore } from '#modules/render/segment.store.js';
import { VoiceSampleStore } from '#modules/render/voice.sample.store.js';
import { TrackStore } from '#modules/playout/audio/track.store.js';
import { DEFAULT_TRACK_CACHE_MAX_BYTES, TRACK_CACHE_MAX_BYTES_KEY, resolveTrackCacheMaxBytes } from '#modules/playout/audio/track.cache.limit.js';
import type { StoredFile } from '#modules/shared/content.store.js';
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
 * The whole of what this service needs from a store: where it is and what is in it.
 *
 * Structural rather than `ContentStore<Ext>`, because the four stores are each parameterised by
 * their own extensions and a common supertype would need a variance argument to buy nothing — this
 * reads a directory listing and never writes, so the two members it actually uses are the honest
 * dependency.
 */
interface Measurable {
    readonly root: string;
    list(): Promise<StoredFile[]>;
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
 * ## It reports and never repairs
 *
 * A file no row claims is left exactly where it is, and so is a row whose file has gone. That is the
 * rule `docs/todo/track-cache-eviction.md` set for the sweep and it applies twice as hard to a read:
 * a store that quietly deletes files it cannot account for is a bad thing to debug, and the numbers
 * have to exist before anything is allowed to act on them. The two disagreements mean different
 * things anyway — bytes with no row is a crash between writing a file and writing its row, a row
 * with no bytes is a directory somebody emptied — and the station already heals the second by
 * re-fetching.
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
        const present = new Set(files.flatMap(file => (file.checksum === undefined || file.ext === undefined ? [] : [fileName(file.checksum, file.ext)])));

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
