/**
 * Represents a pagination object
 * generated from [Pagination](../../../../../apps/api/data/contracts/shared/pagination.ck#L7)
 */
export interface Pagination {
    /** The page number */
    page?: number;
    /** The page size */
    pageSize?: number;
    /** The sort order */
    sort?: 'asc' | 'desc';
    /** The total number of items */
    total: number;
}

export interface PaginationInput {
    /** The page number */
    page?: number;
    /** The page size */
    pageSize?: number;
    /** The sort order */
    sort?: 'asc' | 'desc';
}

/**
 * generated from [PaginationWithActive](../../../../../apps/api/data/contracts/shared/pagination.ck#L14)
 */
export interface PaginationWithActive extends Pagination {
    /** Optionally filter by whether the items are active */
    active?: boolean;
}

export interface PaginationWithActiveInput extends PaginationInput {
    /** Optionally filter by whether the items are active */
    active?: boolean;
}
