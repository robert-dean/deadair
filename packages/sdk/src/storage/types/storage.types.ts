import { Decimal } from 'decimal.js';
import { DateTime } from 'luxon';

Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * Which store, as a stable id the console can key off rather than a name it renders.
 * generated from [StorageStoreId](../../../../../apps/api/data/contracts/storage/storage.types.ck#L8)
 */
export type StorageStoreId = 'tracks' | 'art' | 'segments' | 'voices';

/**
 * One content store: what is on disk, and what the database says should be.
 *
 * The two halves are deliberately separate numbers rather than one reconciled figure. They disagree
 * in two directions and each direction means something different — a file nothing claims is what a
 * crash between writing bytes and writing a row leaves behind, and a row whose file is gone is what
 * an operator emptying a directory leaves. Reporting one number would hide both.
 * generated from [StorageStore](../../../../../apps/api/data/contracts/storage/storage.types.ck#L16)
 */
export interface StorageStore {
    id: StorageStoreId;
    /** What to call it on a page */
    label: string;
    /** Where it is, so `du` and this can be compared */
    path: string;
    /** Files actually there */
    files: number;
    /** What they weigh */
    bytes: number;
    /** Rows pointing at a file. Absent when no table backs this store */
    rows?: number;
    /** What those rows say those files weigh. Absent where the table does not record a size */
    accountedBytes?: number;
    /** The limit an operator set, where the store has one. Absent means no limit */
    capBytes?: number;
    /** Files no row claims. Reported and never cleaned up automatically */
    orphanFiles: number;
    orphanBytes: number;
    /** Claims whose file is not there. The station re-fetches or re-renders these */
    rowsWithNoFile: number;
}

export interface StorageStoreInput {}

/**
 * Every store, plus the number an operator actually wants first.
 *
 * `readAt` is not decoration: the figures come from walking directories, which is real I/O on a
 * station holding tens of thousands of files, so the answer is cached for a short while and this is
 * what stops a page mistaking it for live.
 * generated from [StorageReport](../../../../../apps/api/data/contracts/storage/storage.types.ck#L35)
 */
export interface StorageReport {
    readAt: DateTime;
    totalFiles: number;
    totalBytes: number;
    stores: StorageStore[];
}

export interface StorageReportInput {
    stores: StorageStoreInput[];
}

/** Rehydrates every wire-encoded scalar in a StorageReport into its runtime type. Mutates and returns `raw`. */
export function reviveStorageReport(raw: StorageReport): StorageReport {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['readAt'] = __dt(__o0['readAt'], 'StorageReport.readAt');
    return raw;
}
