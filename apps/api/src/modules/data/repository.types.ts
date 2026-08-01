export type RepositoryPagination = {
    limit: number;
    offset: number;
    sort: 'asc' | 'desc';
};

export type RepositoryPaginationWithActive = RepositoryPagination & {
    active?: boolean;
};
