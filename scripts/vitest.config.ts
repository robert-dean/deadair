import { defineConfig } from 'vitest/config';

// The release scripts are plain ESM run by Node, not a package, so they have no build and nothing to
// type-check. Their tests follow the tree's layout anyway: a top-level tests/ beside what they test.
export default defineConfig({
    test: {
        include: ['./tests/**/*.test.ts'],
    },
});
