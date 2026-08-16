import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * Which store, as a stable id the console can key off rather than a name it renders.
 * generated from [StorageStoreId](file://./../../../../data/contracts/storage/storage.types.ck#L8)
 */
export const StorageStoreId = z.enum(['tracks', 'art', 'segments', 'voices']);
export type StorageStoreId = z.infer<typeof StorageStoreId>;

/**
 * One content store: what is on disk, and what the database says should be.
 *
 * The two halves are deliberately separate numbers rather than one reconciled figure. They disagree
 * in two directions and each direction means something different — a file nothing claims is what a
 * crash between writing bytes and writing a row leaves behind, and a row whose file is gone is what
 * an operator emptying a directory leaves. Reporting one number would hide both.
 * generated from [StorageStore](file://./../../../../data/contracts/storage/storage.types.ck#L16)
 */
export const StorageStore = z.strictObject({
    id: StorageStoreId,
    label: z.string().min(1).max(100).describe('What to call it on a page'),
    path: z.string().min(1).max(1000).describe('Where it is, so `du` and this can be compared'),
    files: z.coerce.number().int().min(0).describe('Files actually there'),
    bytes: z.coerce.number().int().min(0).describe('What they weigh'),
    rows: z.coerce.number().int().min(0).optional().describe('Rows pointing at a file. Absent when no table backs this store'),
    accountedBytes: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe('What those rows say those files weigh. Absent where the table does not record a size'),
    capBytes: z.coerce.number().int().min(0).optional().describe('The limit an operator set, where the store has one. Absent means no limit'),
    orphanFiles: z.coerce.number().int().min(0).describe('Files no row claims. Reported and never cleaned up automatically'),
    orphanBytes: z.coerce.number().int().min(0),
    rowsWithNoFile: z.coerce.number().int().min(0).describe('Claims whose file is not there. The station re-fetches or re-renders these'),
});
export type StorageStore = z.infer<typeof StorageStore>;

export const StorageStoreInput = z.strictObject({});
export type StorageStoreInput = z.infer<typeof StorageStoreInput>;

/**
 * Every store, plus the number an operator actually wants first.
 *
 * `readAt` is not decoration: the figures come from walking directories, which is real I/O on a
 * station holding tens of thousands of files, so the answer is cached for a short while and this is
 * what stops a page mistaking it for live.
 * generated from [StorageReport](file://./../../../../data/contracts/storage/storage.types.ck#L35)
 */
export const StorageReport = z.strictObject({
    readAt: _ZodDatetime,
    totalFiles: z.coerce.number().int().min(0),
    totalBytes: z.coerce.number().int().min(0),
    stores: z.array(StorageStore),
});
export type StorageReport = z.infer<typeof StorageReport>;

export const StorageReportInput = z.strictObject({
    stores: z.array(StorageStoreInput),
});
export type StorageReportInput = z.infer<typeof StorageReportInput>;
