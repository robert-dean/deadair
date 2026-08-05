/**
 * Every query key in the app, in one place, so an invalidation and the query it means to invalidate
 * cannot drift apart. Keys are `as const` tuples: TanStack matches them structurally, and the
 * literal types let a typo fail the build rather than silently miss.
 */
export const queryKeys = {
    session: {
        /** The verdict on the refresh cookie. Deliberately not keyed on the session epoch; see `session.bootstrap`. */
        restore: () => ['session', 'restore'] as const,
    },
    onboarding: {
        requirements: () => ['onboarding', 'requirements'] as const,
    },
    plugins: {
        /** The catalogue. `kind` is the API's own filter; 'all' stands in for an unfiltered list. */
        list: (kind?: string) => ['plugins', 'list', kind ?? 'all'] as const,
        detail: (id: string) => ['plugins', 'detail', id] as const,
        /**
         * A tail of a plugin's buffered log. Keyed on the query too: a level or limit change is a
         * different page, not a stale one. Called with no `query` at all, this is deliberately a
         * strict prefix of every filtered form below it, so `invalidateQueries` with the id-only key
         * matches the unfiltered tail and every filtered one alike.
         */
        logs: (id: string, query?: { limit?: number; level?: string }) =>
            query === undefined ? (['plugins', 'logs', id] as const) : (['plugins', 'logs', id, query.limit ?? 'all', query.level ?? 'all'] as const),
    },
    playlists: {
        list: () => ['playlists', 'list'] as const,
        tracks: (pluginId: string, playlistId: string) => ['playlists', 'tracks', pluginId, playlistId] as const,
    },
} as const;
