import { z } from 'zod';

/**
 * Represents a pagination object
 * generated from [Pagination](../../../../data/contracts/shared/pagination.ck#L7)
 */
export const Pagination = z.strictObject({
    page: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .default(0)
        .describe('The page number'),
    pageSize: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(100))
        .default(25)
        .describe('The page size'),
    sort: z.enum(['asc', 'desc']).default('desc').describe('The sort order'),
    total: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('The total number of items'),
});
export type Pagination = z.infer<typeof Pagination>;

export const PaginationInput = z.strictObject({
    page: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .default(0)
        .describe('The page number'),
    pageSize: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(100))
        .default(25)
        .describe('The page size'),
    sort: z.enum(['asc', 'desc']).default('desc').describe('The sort order'),
});
export type PaginationInput = z.infer<typeof PaginationInput>;

/**
 * generated from [PaginationWithActive](../../../../data/contracts/shared/pagination.ck#L14)
 */
export const PaginationWithActive = Pagination.extend({
    active: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe('Optionally filter by whether the items are active'),
});
export type PaginationWithActive = z.infer<typeof PaginationWithActive>;

export const PaginationWithActiveInput = PaginationInput.extend({
    active: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe('Optionally filter by whether the items are active'),
});
export type PaginationWithActiveInput = z.infer<typeof PaginationWithActiveInput>;
