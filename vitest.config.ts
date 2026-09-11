import { defineConfig } from 'vitest/config';

// One vitest for the whole workspace, so the suite can be SPLIT rather than only run.
//
// Every package already owns its own vitest.config.ts and keeps it: this names them as projects
// rather than replacing them, so `pnpm --filter <pkg> test` is unchanged, `turbo run test` is
// unchanged, and web still gets its jsdom, its react plugin and its setup file. What this adds is
// a single command that can see every test file at once, which is the thing `--shard` needs.
//
// The reason to want that is measured rather than assumed. Running the suite through turbo means
// one vitest STARTUP per package, and the startups are the cost: locally, `apps/api` alone is 3736
// tests in 18 seconds, while the fourteen smaller packages are half as many tests in 55 seconds.
// Splitting the big suite would therefore have split the cheap half. Sharding across all of them
// at once splits what is actually expensive, and shares one transform cache and one worker pool
// while doing it.
//
// The list is the workspace's own globs, one level deep, matching pnpm-workspace.yaml — and it
// matches on the CONFIG rather than the directory, because a package with no vitest config is a
// package with no tests, and naming it here makes vitest report an empty project rather than say
// nothing. Adding a package with tests means adding a config, which this then finds on its own.
// `scripts/` is not a workspace member and is named by hand: the release scripts' tests live there.
export default defineConfig({
    test: {
        projects: ['apps/*/vitest.config.ts', 'packages/*/vitest.config.ts', 'plugins/*/vitest.config.ts', 'scripts/vitest.config.ts'],
    },
});
