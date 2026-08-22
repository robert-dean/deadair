import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tests live in a top-level tests/ folder mirroring src/, importing ../src/….
// Kept out of the build tsconfig so tsc only type-checks shippable src.
export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        include: ['./tests/**/*.test.{ts,tsx}'],
        // Above the 5s default, because this suite's unit of work is not a function call: a case
        // here mounts a provider stack into jsdom, settles a query client and drives real user
        // events, and fifty-odd files do it at once across every core this machine has. Under that
        // contention a case that takes 300ms alone can take seconds, and what it looks like when it
        // crosses the line is a TIMEOUT — a red suite that says nothing about the product and that
        // passes on the next run, which is the most expensive kind of failure to keep around.
        //
        // A ceiling rather than a target: nothing here should come close, and one that does is
        // worth looking at rather than accommodating.
        testTimeout: 20_000,
        hookTimeout: 20_000,
    },
});
