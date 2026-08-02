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
} as const;
